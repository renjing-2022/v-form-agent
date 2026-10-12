/**
 * generate 前指令级风险门禁（与 clarify 共用，避免 generator↔clarify 环依赖）。
 */
import type { FormJson } from '../schemas/refinePlan.js'
import {
  makeConfirmQuestion,
  withDerivedQuestions,
  type ClarificationPayload,
  type InteractionOutput,
  type PendingPlanView,
} from '../schemas/interactionOutput.js'
import { clarificationPayloadSchema, L2_CLARIFY_BEFORE_GENERATE } from '../schemas/clarification.js'
import {
  buildTypeAmbiguityClarificationQuestion,
  findAmbiguousSemanticAliasInText,
} from '../knowledge/createCapabilityPolicy.js'
import { computeFormFingerprint } from './formFingerprint.js'
import { assessInteractionRisk } from './interactionRiskPolicy.js'
import { createPendingPlan } from './pendingPlanStore.js'
import { rewriteClarificationPayload } from './clarificationOptionRewrite.js'

function parseConfirmedSlots(instruction: string): Record<string, unknown> {
  const m = instruction.match(/已确认槽位：(\{[\s\S]*?\})(?:\n|$)/)
  if (!m) return {}
  try {
    return JSON.parse(m[1]) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * 中文语义别名歧义 → Ask-before-act（create.type）。
 * 已确认槽位或 skip 时由调用方不调用本函数。
 */
export function buildTypeAmbiguityGate(params: {
  instruction: string
  formJson: FormJson
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  confirmedRiskCodes?: string[]
}):
  | { ok: true }
  | {
      ok: false
      kind: 'need_clarification'
      clarification: ClarificationPayload
      pendingPlan: PendingPlanView
      output: InteractionOutput
    } {
  const slots = parseConfirmedSlots(params.instruction)
  if (slots['create.type']) return { ok: true }

  const hit = findAmbiguousSemanticAliasInText(params.instruction)
  if (!hit) return { ok: true }

  const clarification = rewriteClarificationPayload(
    clarificationPayloadSchema.parse({
      protocol: 'structured-clarify-v1',
      questions: [
        buildTypeAmbiguityClarificationQuestion({
          alias: hit.alias,
          types: hit.types,
        }),
      ],
    }),
    params.formJson,
    params.instruction,
  )
  const fp = computeFormFingerprint(params.formJson)
  const pendingPlan = createPendingPlan({
    formFingerprint: fp,
    goal: params.instruction.slice(0, 200),
    ambiguities: [`语义别名「${hit.alias}」映射到 ${hit.types.join('/')}`],
    plannedStructure: { summary: '待确认组件 type 后创建', opKinds: ['createWidget'] },
    plannedHandlers: [],
    riskLevel: 'L1',
    riskFacts: [],
    nextStepsAfterAnswer: ['选择 type', '生成候选', '预览验证'],
    resume: {
      instruction: params.instruction,
      messages: params.messages,
      questionSnapshot: clarification.questions,
      slotValues: {},
      confirmedRiskCodes: [...(params.confirmedRiskCodes || [])],
    },
  })
  const output = withDerivedQuestions(
    {
      intent: 'need_clarification',
      summary: `「${hit.alias}」类型歧义，请先选择组件 type`,
      structure: [],
      handlers: [],
      scenarios: [],
      unsupported: [],
    },
    clarification,
  )
  return {
    ok: false,
    kind: 'need_clarification',
    clarification,
    pendingPlan,
    output,
  }
}

export function buildPreGenerateRiskGate(params: {
  instruction: string
  formJson: FormJson
  confirmedRiskCodes?: string[]
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}):
  | { ok: true; risk: ReturnType<typeof assessInteractionRisk> }
  | {
      ok: false
      kind: 'unsupported' | 'need_clarification'
      risk: ReturnType<typeof assessInteractionRisk>
      clarification?: ClarificationPayload
      pendingPlan?: PendingPlanView
      output: InteractionOutput
    } {
  const risk = assessInteractionRisk({
    instruction: params.instruction,
    formJson: params.formJson,
  })
  const confirmed = new Set(params.confirmedRiskCodes || [])

  if (risk.reject) {
    return {
      ok: false,
      kind: 'unsupported',
      risk,
      output: {
        intent: 'unsupported',
        summary: risk.riskFacts.find((f) => f.level === 'L3')?.message || '高风险动作已拒绝',
        structure: [],
        handlers: [],
        scenarios: [],
        unsupported: risk.riskFacts
          .filter((f) => f.level === 'L3')
          .map((f) => ({ text: f.code, reason: f.message })),
      },
    }
  }

  const need = risk.riskFacts.filter(
    (f) => f.level === 'L2' && L2_CLARIFY_BEFORE_GENERATE.has(f.code) && !confirmed.has(f.code),
  )
  if (!need.length) return { ok: true, risk }

  const clarification = rewriteClarificationPayload(
    clarificationPayloadSchema.parse({
      protocol: 'structured-clarify-v1',
      questions: need.map((f, i) =>
        makeConfirmQuestion({
          id: `q_risk_${f.code}_${i}`,
          prompt: `高风险动作需要确认：${f.message}`,
          riskNote: f.message,
          riskCode: f.code,
        }),
      ),
    }),
    params.formJson,
    params.instruction,
  )
  const fp = computeFormFingerprint(params.formJson)
  const pendingPlan = createPendingPlan({
    formFingerprint: fp,
    goal: params.instruction.slice(0, 200),
    ambiguities: need.map((f) => f.message),
    plannedStructure: { summary: '待确认高风险后规划', opKinds: [] },
    plannedHandlers: [],
    riskLevel: risk.riskLevel,
    riskFacts: risk.riskFacts,
    nextStepsAfterAnswer: ['确认风险', '生成候选', '预览验证'],
    resume: {
      instruction: params.instruction,
      messages: params.messages,
      questionSnapshot: clarification.questions,
      slotValues: {},
      confirmedRiskCodes: [...confirmed],
    },
  })
  const output = withDerivedQuestions(
    {
      intent: 'need_clarification',
      summary: '检测到高风险动作，请先确认',
      structure: [],
      handlers: [],
      scenarios: [],
      unsupported: [],
    },
    clarification,
  )
  return {
    ok: false,
    kind: 'need_clarification',
    risk,
    clarification,
    pendingPlan,
    output,
  }
}
