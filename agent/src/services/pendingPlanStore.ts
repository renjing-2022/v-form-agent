import type {
  ClarificationAnswer,
  ClarificationQuestion,
  PendingPlanView,
  RiskFact,
  RiskLevel,
} from '../schemas/clarification.js'
import { pendingPlanViewSchema } from '../schemas/clarification.js'

export type PendingPlanResume = {
  instruction: string
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  questionSnapshot: ClarificationQuestion[]
  slotValues: Record<string, unknown>
  modelHints?: unknown
  confirmedRiskCodes: string[]
}

export type PendingPlanRecord = {
  view: PendingPlanView
  resume: PendingPlanResume
}

const DEFAULT_TTL_MS = 30 * 60 * 1000

const store = new Map<string, PendingPlanRecord>()

export function clearPendingPlanStore(): void {
  store.clear()
}

export function createPendingPlan(params: {
  formFingerprint: string
  goal: string
  ambiguities: string[]
  assumed?: string[]
  plannedStructure: PendingPlanView['plannedStructure']
  plannedHandlers: PendingPlanView['plannedHandlers']
  plannedDeletes?: string[]
  riskLevel: RiskLevel
  riskFacts: RiskFact[]
  nextStepsAfterAnswer: string[]
  resume: PendingPlanResume
  ttlMs?: number
}): PendingPlanView {
  const now = Date.now()
  const ttl = params.ttlMs ?? DEFAULT_TTL_MS
  const id = `plan_${cryptoRandom()}`
  const view = pendingPlanViewSchema.parse({
    id,
    formFingerprint: params.formFingerprint,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    goal: params.goal,
    ambiguities: params.ambiguities,
    assumed: params.assumed,
    plannedStructure: params.plannedStructure,
    plannedHandlers: params.plannedHandlers,
    plannedDeletes: params.plannedDeletes,
    riskLevel: params.riskLevel,
    riskFacts: params.riskFacts,
    nextStepsAfterAnswer: params.nextStepsAfterAnswer,
  })
  store.set(id, { view, resume: params.resume })
  return view
}

function cryptoRandom(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function getPendingPlan(id: string): PendingPlanRecord | undefined {
  const rec = store.get(id)
  if (!rec) return undefined
  if (Date.parse(rec.view.expiresAt) < Date.now()) {
    store.delete(id)
    return undefined
  }
  return rec
}

export function deletePendingPlan(id: string): void {
  store.delete(id)
}

/** 重写澄清题后同步服务端快照（options 真源化） */
export function updatePendingPlanQuestions(
  id: string,
  questions: ClarificationQuestion[],
): PendingPlanRecord | undefined {
  const rec = getPendingPlan(id)
  if (!rec) return undefined
  rec.resume.questionSnapshot = questions
  store.set(id, rec)
  return rec
}

export function consumePendingPlan(id: string): PendingPlanRecord | undefined {
  const rec = getPendingPlan(id)
  if (!rec) return undefined
  store.delete(id)
  return rec
}

export function applyAnswersToSlots(
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[],
  prev: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...prev }
  const byId = new Map(answers.map((a) => [a.questionId, a]))
  for (const q of questions) {
    const a = byId.get(q.id)
    if (!a || !q.binds?.slot) continue
    const slot = q.binds.slot
    if (q.type === 'confirm') {
      const yes = a.confirmed === true || (a.optionIds || []).includes('yes')
      next[slot] = yes
      continue
    }
    if (a.text?.trim() && (q.type === 'text' || q.allowCustom)) {
      next[slot] = a.text.trim()
      continue
    }
    const opt = (q.options || []).find((o) => (a.optionIds || []).includes(o.id))
    if (opt) next[slot] = opt.value
  }
  return next
}
