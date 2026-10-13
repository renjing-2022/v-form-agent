import type { FormJson } from '../schemas/refinePlan.js'
import {
  withDerivedQuestions,
  type ClarificationPayload,
  type InteractionOutput,
  type PendingPlanView,
} from '../schemas/interactionOutput.js'
import { clarificationPayloadSchema } from '../schemas/clarification.js'
import { computeFormFingerprint } from './formFingerprint.js'
import { createPendingPlan } from './pendingPlanStore.js'
import { rewriteClarificationPayload } from './clarificationOptionRewrite.js'
import { buildFormIndex, findAmbiguousTargetMentions } from './formIndex.js'

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
 * 大表目标歧义 → Ask-before-act（binds.target.widget）。
 */
export function buildTargetAmbiguityGate(params: {
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
  if (slots['target.widget']) return { ok: true }

  const index = buildFormIndex(params.formJson)
  const ambiguous = findAmbiguousTargetMentions(index, params.instruction)
  if (!ambiguous.length) return { ok: true }

  const first = ambiguous[0]
  const clarification = rewriteClarificationPayload(
    clarificationPayloadSchema.parse({
      protocol: 'structured-clarify-v1',
      questions: [
        {
          id: `q_target_${first.mention}`.slice(0, 64),
          type: 'single_choice',
          prompt: `「${first.mention}」匹配到多个控件，请选择目标`,
          required: true,
          options: first.matches.slice(0, 12).map((m, i) => ({
            id: `opt_${i}`,
            label: `${m.label || m.name || m.id || m.path} (${m.type || 'unknown'} @ ${m.path})`,
            value: m.name || m.id || m.path,
            recommended: i === 0,
          })),
          binds: { slot: 'target.widget' },
        },
      ],
    }),
    params.formJson,
    params.instruction,
  )

  const fp = computeFormFingerprint(params.formJson)
  const pendingPlan = createPendingPlan({
    formFingerprint: fp,
    goal: params.instruction.slice(0, 200),
    ambiguities: ambiguous.map((a) => `「${a.mention}」命中 ${a.matches.length} 个控件`),
    plannedStructure: { summary: '待确认目标控件', opKinds: [] },
    plannedHandlers: [],
    riskLevel: 'L1',
    riskFacts: [],
    nextStepsAfterAnswer: ['选择目标控件', '生成候选', '预览验证'],
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
      summary: `目标「${first.mention}」存在歧义，请先选择控件`,
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
