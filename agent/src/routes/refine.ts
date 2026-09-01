import type { FastifyInstance } from 'fastify'
import { refineRequestSchema } from '../schemas/refinePlan.js'
import { planRefine } from '../services/refinePlanner.js'
import { applyRefinePlan } from '../services/refineMerger.js'
import { collectWidgetIds, validateFormJson } from '../services/validator.js'

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
      const { plan, usedMock } = await planRefine({ instruction, currentFormJson, messages })
      const { formJson, warnings } = applyRefinePlan(currentFormJson, plan)
      const issues = validateFormJson(formJson, { mode: 'refine', existingIds })
      if (issues.length) {
        return reply.code(422).send({
          message: '优化结果未通过校验',
          issues,
          warnings,
        })
      }

      const allWarnings = [...warnings]
      if (usedMock && !allWarnings.some((w) => w.includes('mock'))) {
        allWarnings.push('当前使用 mock/本地规划（未配置 DeepSeek Key）')
      }

      return {
        summary: plan.summary,
        warnings: allWarnings,
        formJson,
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
