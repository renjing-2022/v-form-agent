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
import { computeFormFingerprint } from './formFingerprint.js'
import { assessInteractionRisk } from './interactionRiskPolicy.js'
import { createPendingPlan } from './pendingPlanStore.js'
import { rewriteClarificationPayload } from './clarificationOptionRewrite.js'

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
