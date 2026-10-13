import {
  planCriticInputSchema,
  type PlanCriticInput,
  type PlanCriticVerdict,
  type CriticFinding,
  type RepairRoute,
} from '../schemas/autonomyCritic.js'
import { isCreateAllowedType } from '../knowledge/createWhitelistPolicy.js'
import { hashPayload } from './attemptLedger.js'
import { collectFormNames, collectPlannedCreates } from './interactionValidate.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import type { FormJson } from '../schemas/refinePlan.js'
import { computeFormFingerprint } from './formFingerprint.js'

function pickRoute(findings: CriticFinding[]): RepairRoute {
  if (!findings.length) return 'repair_code'
  if (findings.some((f) => f.code.startsWith('policy_'))) return 'reject'
  if (findings.some((f) => f.code.startsWith('intent_'))) return 'clarify'
  if (findings.some((f) => f.code.startsWith('structure_'))) return 'replan'
  return 'replan'
}

/**
 * 独立 Plan Critic：只看意图摘要 + 结构/目标事实 + 静态问题，
 * 不接受 generator「已通过」标志。
 */
export function runPlanCritic(raw: PlanCriticInput): PlanCriticVerdict {
  const input = planCriticInputSchema.parse(raw)
  const findings: CriticFinding[] = []
  const known = new Set(input.knownTargets)
  const plannedNames = new Set<string>()

  for (const op of input.structureOps) {
    if (op.name) plannedNames.add(op.name)
    if (op.tempRef) plannedNames.add(op.tempRef)
    if (op.op === 'createWidget' && op.type && !isCreateAllowedType(op.type)) {
      findings.push({
        code: 'policy_create_type',
        message: `创建类型 ${op.type} 不在当前创建白名单`,
        path: `structure.${op.name || op.tempRef || op.type}`,
      })
    }
    if (op.parent && !known.has(op.parent) && !plannedNames.has(op.parent)) {
      findings.push({
        code: 'structure_parent_missing',
        message: `父节点 ${op.parent} 不存在于画布或本批计划`,
        path: `structure.parent`,
      })
    }
  }

  for (const h of input.handlerTargets) {
    if (h.target === 'form') continue
    if (!known.has(h.target) && !plannedNames.has(h.target)) {
      findings.push({
        code: 'structure_handler_target',
        message: `事件目标 ${h.target} 无法解析`,
        path: `handlers.${h.target}.${h.eventKey}`,
      })
    }
  }

  for (const issue of input.staticIssues) {
    const text = `${issue.path}:${issue.message}`
    if (/歧义|ambiguous|澄清|哪个/.test(text)) {
      findings.push({
        code: 'intent_ambiguous',
        message: issue.message,
        path: issue.path,
      })
    } else if (/network|禁网|unsupported|L3|不允许|forbidden|upload|remote/.test(text)) {
      findings.push({
        code: 'policy_static',
        message: issue.message,
        path: issue.path,
      })
    } else if (/target|parent|tempRef|create|structure|不存在|depth/.test(text)) {
      findings.push({
        code: 'structure_static',
        message: issue.message,
        path: issue.path,
      })
    }
  }

  if (!input.intentSummary.trim()) {
    findings.push({
      code: 'intent_empty',
      message: '缺少原始意图摘要，无法独立审核计划',
    })
  }

  const route = findings.length ? pickRoute(findings) : 'repair_code'
  return {
    critic: 'plan',
    pass: findings.length === 0,
    route: findings.length === 0 ? 'repair_code' : route,
    findings,
    fingerprint: hashPayload({
      critic: 'plan',
      intentSummary: input.intentSummary,
      formFingerprint: input.formFingerprint,
      structureOps: input.structureOps,
      handlerTargets: input.handlerTargets,
      findings,
    }),
  }
}

/** createWidget.parent 可能是 TargetRef 对象，归一为可审核的字符串键 */
function normalizeParentKey(parent: unknown): string | undefined {
  if (parent == null) return undefined
  if (typeof parent === 'string') return parent
  if (typeof parent !== 'object') return undefined
  const p = parent as {
    kind?: string
    name?: string
    id?: string
    tempRef?: string
  }
  if (p.kind === 'root') return 'root'
  if (p.kind === 'tempRef' && p.tempRef) return p.tempRef
  if (p.name) return p.name
  if (p.id) return p.id
  if (p.tempRef) return p.tempRef
  return undefined
}

/** 从交互候选构建 Plan Critic 输入（不含 generator 结论） */
export function buildPlanCriticInput(params: {
  instruction: string
  formJson: FormJson
  output: InteractionOutput
  staticIssues?: Array<{ path: string; message: string }>
}): PlanCriticInput {
  const { names, ids } = collectFormNames(params.formJson)
  const planned = collectPlannedCreates(params.output, params.formJson)
  return planCriticInputSchema.parse({
    intentSummary: params.instruction.trim().slice(0, 2000),
    formFingerprint: computeFormFingerprint(params.formJson),
    knownTargets: [...names, ...ids, ...planned.names, 'form', 'root'],
    structureOps: (params.output.structure || []).map((op) => {
      const anyOp = op as {
        op: string
        type?: string
        name?: string
        tempRef?: string
        parent?: unknown
        target?: { name?: string }
      }
      return {
        op: anyOp.op,
        type: anyOp.type,
        name: anyOp.name,
        tempRef: anyOp.tempRef,
        parent: normalizeParentKey(anyOp.parent) || anyOp.target?.name,
      }
    }),
    handlerTargets: (params.output.handlers || []).map((h) => ({
      target: h.target,
      eventKey: h.eventKey,
    })),
    staticIssues: params.staticIssues || [],
  })
}
