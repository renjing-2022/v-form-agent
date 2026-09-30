/**
 * v0.10 clarify 动作：指纹门禁、答案校验、填槽后继续生成或取消。
 */
import type { FormJson } from '../schemas/refinePlan.js'
import {
  isConfirmRejected,
  makeConfirmQuestion,
  validateClarificationAnswers,
  withDerivedQuestions,
  type ClarificationAnswer,
  type ClarificationPayload,
  type InteractionOutput,
  type PendingPlanView,
  type RiskFact,
  type EventConflict,
} from '../schemas/interactionOutput.js'
import { clarificationPayloadSchema, L2_CLARIFY_BEFORE_GENERATE } from '../schemas/clarification.js'
import { computeFormFingerprint } from './formFingerprint.js'
import { assessInteractionRisk } from './interactionRiskPolicy.js'
import { generateInteraction } from './interactionGenerator.js'
import { buildInteractionCandidate } from './interactionApply.js'
import {
  applyAnswersToSlots,
  consumePendingPlan,
  createPendingPlan,
  deletePendingPlan,
  getPendingPlan,
} from './pendingPlanStore.js'

export type ClarifyResult = {
  status: 'generated' | 'need_clarification' | 'plan_expired' | 'unsupported' | 'cancelled' | 'error'
  httpStatus: 200 | 400 | 503
  summary: string
  applied: false
  formJson: FormJson
  formJsonCandidate?: FormJson
  output: InteractionOutput
  clarification?: ClarificationPayload
  pendingPlan?: PendingPlanView
  riskLevel?: string
  riskFacts?: RiskFact[]
  formFingerprint: string
  eventConflicts?: EventConflict[]
  questions?: string[]
  error?: string
  usedMock?: boolean
}

function emptyOutput(summary: string, intent: InteractionOutput['intent'] = 'need_clarification'): InteractionOutput {
  return {
    intent,
    summary,
    structure: [],
    handlers: [],
    scenarios: [],
    unsupported: [],
  }
}

function riskConfirmClarification(facts: RiskFact[]): ClarificationPayload {
  const need = facts.filter((f) => f.level === 'L2' && L2_CLARIFY_BEFORE_GENERATE.has(f.code))
  return clarificationPayloadSchema.parse({
    protocol: 'structured-clarify-v1',
    questions: need.map((f, i) =>
      makeConfirmQuestion({
        id: `q_risk_${f.code}_${i}`,
        prompt: `高风险动作需要确认：${f.message}`,
        riskNote: f.message,
        riskCode: f.code,
      }),
    ),
  })
}

export async function clarifyInteraction(params: {
  pendingPlanId: string
  formFingerprint: string
  currentFormJson: FormJson
  answers: ClarificationAnswer[]
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<ClarifyResult> {
  const fp = computeFormFingerprint(params.currentFormJson)
  const base = {
    applied: false as const,
    formJson: params.currentFormJson,
    formFingerprint: fp,
  }

  if (params.formFingerprint !== fp) {
    return {
      ...base,
      status: 'plan_expired',
      httpStatus: 200,
      summary: '画布已变化，待澄清计划已失效，请重新描述',
      output: emptyOutput('plan expired: fingerprint mismatch'),
    }
  }

  const rec = getPendingPlan(params.pendingPlanId)
  if (!rec) {
    return {
      ...base,
      status: 'plan_expired',
      httpStatus: 200,
      summary: '待澄清计划不存在或已过期，请重新描述',
      output: emptyOutput('plan expired: missing'),
    }
  }

  if (rec.view.formFingerprint !== fp) {
    deletePendingPlan(params.pendingPlanId)
    return {
      ...base,
      status: 'plan_expired',
      httpStatus: 200,
      summary: '画布与计划指纹不一致，请重新描述',
      output: emptyOutput('plan expired: stored fingerprint'),
    }
  }

  const questions = rec.resume.questionSnapshot
  const validated = validateClarificationAnswers(questions, params.answers)
  if (!validated.ok) {
    return {
      ...base,
      status: 'error',
      httpStatus: 400,
      summary: validated.message,
      output: emptyOutput(validated.message),
      error: validated.message,
    }
  }

  for (const q of questions) {
    const a = params.answers.find((x) => x.questionId === q.id)
    if (a && isConfirmRejected(a, q)) {
      deletePendingPlan(params.pendingPlanId)
      return {
        ...base,
        status: 'cancelled',
        httpStatus: 200,
        summary: '已取消，画布未变更',
        output: emptyOutput('cancelled by user', 'unsupported'),
      }
    }
  }

  const slotValues = applyAnswersToSlots(questions, params.answers, rec.resume.slotValues)
  const confirmedRiskCodes = [
    ...new Set([
      ...rec.resume.confirmedRiskCodes,
      ...questions
        .filter((q) => q.binds?.slot?.startsWith('risk.confirm:'))
        .filter((q) => {
          const a = params.answers.find((x) => x.questionId === q.id)
          if (!a) return false
          return a.confirmed === true || (a.optionIds || []).includes('yes')
        })
        .map((q) => q.binds!.slot.slice('risk.confirm:'.length)),
    ]),
  ]

  consumePendingPlan(params.pendingPlanId)

  const enrichedInstruction = [
    rec.resume.instruction,
    Object.keys(slotValues).length ? `已确认槽位：${JSON.stringify(slotValues)}` : '',
    confirmedRiskCodes.length ? `已确认风险：${confirmedRiskCodes.join(',')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const gen = await generateInteraction({
    instruction: enrichedInstruction,
    currentFormJson: params.currentFormJson,
    messages: params.messages || rec.resume.messages,
    skipRiskGate: true,
    confirmedRiskCodes,
  })

  if (gen.status === 'error') {
    return {
      ...base,
      status: 'error',
      httpStatus: gen.error?.includes('DEEPSEEK') ? 503 : 200,
      summary: gen.error || 'clarify generate failed',
      output: gen.output,
      error: gen.error,
      usedMock: gen.usedMock,
    }
  }

  if (gen.status === 'need_clarification' || gen.status === 'unsupported' || gen.status === 'route_refine') {
    return {
      ...base,
      status: gen.status === 'route_refine' ? 'generated' : gen.status,
      httpStatus: 200,
      summary: gen.output.summary || gen.status,
      output: gen.output,
      clarification: gen.clarification,
      pendingPlan: gen.pendingPlan,
      riskLevel: gen.riskLevel,
      riskFacts: gen.riskFacts,
      questions: gen.output.questions || gen.questions,
      formJsonCandidate: gen.formJsonCandidate,
      eventConflicts: gen.eventConflicts,
      usedMock: gen.usedMock,
    }
  }

  const risk = assessInteractionRisk({
    instruction: enrichedInstruction,
    formJson: params.currentFormJson,
    output: gen.output,
  })

  if (risk.reject) {
    return {
      ...base,
      status: 'unsupported',
      httpStatus: 200,
      summary: risk.riskFacts.find((f) => f.level === 'L3')?.message || '高风险动作已拒绝',
      output: {
        ...gen.output,
        intent: 'unsupported',
        unsupported: [
          ...(gen.output.unsupported || []),
          ...risk.riskFacts
            .filter((f) => f.level === 'L3')
            .map((f) => ({ text: f.code, reason: f.message })),
        ],
      },
      riskLevel: risk.riskLevel,
      riskFacts: risk.riskFacts,
      usedMock: gen.usedMock,
    }
  }

  const stillNeed = risk.riskFacts.filter(
    (f) =>
      f.level === 'L2' &&
      L2_CLARIFY_BEFORE_GENERATE.has(f.code) &&
      !confirmedRiskCodes.includes(f.code),
  )

  if (stillNeed.length) {
    const clarification = riskConfirmClarification(stillNeed)
    const pendingPlan = createPendingPlan({
      formFingerprint: fp,
      goal: rec.view.goal,
      ambiguities: stillNeed.map((f) => f.message),
      plannedStructure: rec.view.plannedStructure,
      plannedHandlers: rec.view.plannedHandlers,
      riskLevel: risk.riskLevel,
      riskFacts: risk.riskFacts,
      nextStepsAfterAnswer: ['确认后继续生成候选', '预览验证', '确认写入'],
      resume: {
        instruction: rec.resume.instruction,
        messages: params.messages || rec.resume.messages,
        questionSnapshot: clarification.questions,
        slotValues,
        confirmedRiskCodes,
      },
    })
    const output = withDerivedQuestions(
      {
        ...emptyOutput(gen.output.summary || '仍需确认高风险动作'),
        intent: 'need_clarification',
      },
      clarification,
    )
    return {
      ...base,
      status: 'need_clarification',
      httpStatus: 200,
      summary: output.summary,
      output,
      clarification,
      pendingPlan,
      riskLevel: risk.riskLevel,
      riskFacts: risk.riskFacts,
      questions: output.questions,
      usedMock: gen.usedMock,
    }
  }

  const preview = buildInteractionCandidate(params.currentFormJson, gen.output)
  return {
    ...base,
    status: 'generated',
    httpStatus: 200,
    summary: gen.output.summary || '已生成候选',
    output: gen.output,
    formJsonCandidate: preview.ok ? preview.formJsonCandidate : undefined,
    eventConflicts: preview.ok ? preview.eventConflicts : undefined,
    riskLevel: risk.riskLevel,
    riskFacts: risk.riskFacts,
    usedMock: gen.usedMock,
  }
}
