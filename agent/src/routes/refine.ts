import type { FastifyInstance } from 'fastify'
import { refineRequestSchema, type FormJson, type RefinePlan } from '../schemas/refinePlan.js'
import { planRefine } from '../services/refinePlanner.js'
import { applyRefinePlan } from '../services/refineMerger.js'
import { enforceRefineTextPolicy } from '../services/refineTextPolicy.js'
import { collectWidgetIds, validateFormJson } from '../services/validator.js'
import { validatePlanTargets } from '../services/targetResolver.js'
import {
  buildHonestSummary,
  highPrecisionIntentUnfulfilled,
  instructionHasAlignIntent,
  instructionHasLabelWidthIntent,
  instructionHasSizeIntent,
  planPatchesAllIllegalForKey,
} from '../services/refineIntentGate.js'
import { enrichLayoutPlan, layoutIntentUnfulfilled } from '../services/refineLayoutPolicy.js'
import { normalizeRefinePlanSynonyms } from '../services/nlSynonymNormalize.js'

function preMergeIntentReject(
  instruction: string,
  plan: RefinePlan,
  formJson: FormJson,
): { reject: boolean; message?: string } {
  const checks: Array<{ intent: boolean; key: string; message: string }> = [
    {
      intent: instructionHasAlignIntent(instruction),
      key: 'labelAlign',
      message:
        '对齐诉求未落地：labelAlign 必须使用 label-left-align / label-center-align / label-right-align（字段级可用空字符串表示继承），禁止 right/left/center 等简称',
    },
    {
      intent: instructionHasLabelWidthIntent(instruction),
      key: 'labelWidth',
      message:
        '标签宽度诉求未落地：labelWidth 必须为数字（如 450），禁止 "450px" 等带单位字符串',
    },
    {
      intent: instructionHasSizeIntent(instruction),
      key: 'size',
      message: '控件大小诉求未落地：size 必须为 "" / large / small，禁止 "default" 字面量',
    },
  ]
  for (const check of checks) {
    if (check.intent && planPatchesAllIllegalForKey(plan, check.key, formJson)) {
      return { reject: true, message: check.message }
    }
  }
  return { reject: false }
}

export async function registerRefineRoutes(app: FastifyInstance) {
  app.post('/api/agent/v1/refine', async (request, reply) => {
    try {
      const parsed = refineRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          message: '请求参数无效',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        })
      }

      const { instruction, currentFormJson, messages } = parsed.data
      if (!Array.isArray(currentFormJson.widgetList) || currentFormJson.widgetList.length === 0) {
        return reply.code(400).send({
          message: '当前表单为空，请先生成或拖拽控件，或使用 /api/agent/v1/generate',
        })
      }

      const existingIds = collectWidgetIds(currentFormJson)
      const { plan: rawPlan, usedMock } = await planRefine({ instruction, currentFormJson, messages })
      const { plan: layoutPlan, warnings: layoutEnrichWarnings } = enrichLayoutPlan(
        instruction,
        rawPlan,
        currentFormJson,
      )
      const { plan: synonymPlan, warnings: synonymWarnings } = normalizeRefinePlanSynonyms(layoutPlan)
      const {
        plan,
        warnings: policyWarnings,
        reject,
        rejectMessage,
      } = enforceRefineTextPolicy(instruction, synonymPlan)
      if (reject) {
        return reply.code(422).send({
          message: rejectMessage || '样式类诉求无法通过修改文案规避',
          warnings: policyWarnings,
        })
      }
      const targetCheck = validatePlanTargets(currentFormJson, plan.operations)
      if (!targetCheck.ok) {
        return reply.code(422).send({
          message: targetCheck.rejectMessage || '规划目标存在歧义或无法唯一确定',
          warnings: [...policyWarnings, ...targetCheck.warnings],
        })
      }

      const preMerge = preMergeIntentReject(instruction, plan, currentFormJson)
      if (preMerge.reject) {
        return reply.code(422).send({
          message: preMerge.message || '诉求未落地',
          warnings: [...policyWarnings, '非法属性值已全部拦截'],
        })
      }

      const { formJson, warnings } = applyRefinePlan(currentFormJson, plan)
      const intentGate = highPrecisionIntentUnfulfilled(instruction, plan, warnings)
      if (intentGate.reject) {
        return reply.code(422).send({
          message: intentGate.message,
          warnings: [...policyWarnings, ...layoutEnrichWarnings, ...synonymWarnings, ...warnings],
        })
      }
      const layoutGate = layoutIntentUnfulfilled(
        instruction,
        plan,
        currentFormJson,
        formJson,
        warnings,
      )
      if (layoutGate.reject) {
        return reply.code(422).send({
          message: layoutGate.message,
          warnings: [...policyWarnings, ...layoutEnrichWarnings, ...synonymWarnings, ...warnings],
        })
      }
      const issues = validateFormJson(formJson, { mode: 'refine', existingIds })
      if (issues.length) {
        return reply.code(422).send({
          message: '优化结果未通过校验',
          issues,
          warnings,
        })
      }

      const honest = buildHonestSummary(plan, currentFormJson, formJson, warnings)
      if (honest.reject) {
        return reply.code(422).send({
          message: honest.message || '优化未落地',
          warnings: [...policyWarnings, ...warnings],
        })
      }

      const allWarnings = [...policyWarnings, ...layoutEnrichWarnings, ...synonymWarnings, ...warnings]
      if (usedMock && !allWarnings.some((w) => w.includes('mock'))) {
        allWarnings.push('当前使用 mock/本地规划（未配置 DeepSeek Key）')
      }

      return {
        summary: honest.summary,
        warnings: allWarnings,
        formJson,
        applied: honest.summary.includes('已更新：'),
      }
    } catch (err) {
      request.log.error(err)
      const zodIssues =
        err && typeof err === 'object' && 'issues' in err
          ? (err as { issues: Array<{ path: (string | number)[]; message: string }> }).issues
          : null
      if (zodIssues) {
        return reply.code(422).send({
          message: '模型优化计划未通过契约校验',
          issues: zodIssues.slice(0, 20).map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        })
      }
      return reply.code(500).send({
        message: err instanceof Error ? err.message : '优化失败',
      })
    }
  })
}
