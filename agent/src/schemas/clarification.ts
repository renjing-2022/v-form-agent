import { z } from 'zod'
import { chatTurnSchema, formJsonSchema } from './refinePlan.js'

/** 与设计 §4.1 固定码表一致；parity 检查对照此常量 */
export const RISK_CODES = [
  'read_only',
  'local_reversible',
  'upload_config',
  'remote_datasource',
  'navigation',
  'browser_storage',
  'eval_like',
  'event_overwrite',
  'bulk_delete_rebuild',
  'credential_write',
  'network_js',
  'production_external_write',
  'irreversible',
] as const

export type RiskCode = (typeof RISK_CODES)[number]

export const riskLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3'])
export type RiskLevel = z.infer<typeof riskLevelSchema>

export const riskCodeSchema = z.enum(RISK_CODES)

export const riskFactSchema = z.object({
  level: riskLevelSchema,
  code: riskCodeSchema,
  message: z.string().min(1).max(2000),
  relatedTargets: z.array(z.string().min(1).max(128)).max(40).optional(),
})
export type RiskFact = z.infer<typeof riskFactSchema>

export const clarificationOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  recommended: z.boolean().optional(),
  riskLevel: riskLevelSchema.optional(),
  value: z.union([z.string(), z.boolean(), z.number(), z.record(z.unknown())]),
})
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>

const clarificationSlotSchema = z.union([
  z.literal('target.widget'),
  z.literal('target.eventKey'),
  z.string().regex(/^risk\.confirm:[a-z0-9_]+$/, 'binds.slot must be target.* or risk.confirm:<code>'),
])

export const clarificationQuestionSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(['single_choice', 'multiple_choice', 'text', 'confirm']),
    prompt: z.string().min(1).max(2000),
    options: z.array(clarificationOptionSchema).max(40).optional(),
    allowCustom: z.boolean().optional(),
    defaultOptionIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    recommendedOptionIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    required: z.boolean(),
    riskNote: z.string().max(1000).optional(),
    binds: z.object({ slot: clarificationSlotSchema }).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'confirm') {
      if (!q.options || q.options.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${q.type} requires options[]`,
          path: ['options'],
        })
      }
    }
    if (q.type === 'confirm' && q.options) {
      const ids = new Set(q.options.map((o) => o.id))
      if (!ids.has('yes') || !ids.has('no')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'confirm options must include yes and no',
          path: ['options'],
        })
      }
    }
    if (q.binds?.slot.startsWith('risk.confirm:')) {
      const code = q.binds.slot.slice('risk.confirm:'.length)
      if (!(RISK_CODES as readonly string[]).includes(code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown risk code in slot: ${code}`,
          path: ['binds', 'slot'],
        })
      }
    }
  })
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>

export const clarificationAnswerSchema = z.object({
  questionId: z.string().min(1).max(64),
  optionIds: z.array(z.string().min(1).max(64)).max(40).optional(),
  text: z.string().max(2000).optional(),
  confirmed: z.boolean().optional(),
})
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>

export const clarificationPayloadSchema = z.object({
  questions: z.array(clarificationQuestionSchema).min(1).max(20),
  protocol: z.literal('structured-clarify-v1'),
})
export type ClarificationPayload = z.infer<typeof clarificationPayloadSchema>

export const pendingPlanViewSchema = z.object({
  id: z.string().min(1).max(80),
  formFingerprint: z.string().min(1).max(128),
  createdAt: z.string().min(1).max(64),
  expiresAt: z.string().min(1).max(64),
  goal: z.string().min(1).max(2000),
  ambiguities: z.array(z.string().max(500)).max(40),
  assumed: z.array(z.string().max(500)).max(40).optional(),
  plannedStructure: z.object({
    summary: z.string().max(2000),
    opKinds: z.array(z.string().min(1).max(64)).max(40),
  }),
  plannedHandlers: z
    .array(
      z.object({
        target: z.string().min(1).max(128),
        eventKey: z.string().min(1).max(64),
        action: z.enum(['create', 'merge', 'overwrite']),
      }),
    )
    .max(40),
  plannedDeletes: z.array(z.string().min(1).max(128)).max(40).optional(),
  riskLevel: riskLevelSchema,
  riskFacts: z.array(riskFactSchema).max(40),
  nextStepsAfterAnswer: z.array(z.string().max(500)).max(20),
})
export type PendingPlanView = z.infer<typeof pendingPlanViewSchema>

export const eventMergeModeSchema = z.enum(['prepend', 'append', 'overwrite', 'cancel'])
export type EventMergeMode = z.infer<typeof eventMergeModeSchema>

export const eventResolutionSchema = z.object({
  target: z.string().min(1).max(128),
  eventKey: z.string().min(1).max(64),
  mode: eventMergeModeSchema,
})
export type EventResolution = z.infer<typeof eventResolutionSchema>

export const eventConflictSchema = z.object({
  target: z.string().min(1).max(128),
  eventKey: z.string().min(1).max(64),
  existingCode: z.string().max(20000),
  incomingCode: z.string().max(20000),
  mergeSafe: z.boolean(),
  suggestedModes: z.array(eventMergeModeSchema).min(1).max(4),
  diffPreview: z
    .object({
      old: z.string().max(20000),
      mergedPrepend: z.string().max(40000).optional(),
      mergedAppend: z.string().max(40000).optional(),
      incoming: z.string().max(20000),
    })
    .optional(),
})
export type EventConflict = z.infer<typeof eventConflictSchema>

export const interactionClarifyRequestSchema = z.object({
  action: z.literal('clarify'),
  pendingPlanId: z.string().min(1).max(80),
  formFingerprint: z.string().min(1).max(128),
  currentFormJson: formJsonSchema,
  answers: z.array(clarificationAnswerSchema).max(20),
  messages: z.array(chatTurnSchema).max(40).optional(),
})
export type InteractionClarifyRequest = z.infer<typeof interactionClarifyRequestSchema>

/** 由 structured prompts 派生旧版 questions[] */
export function deriveQuestionsFromClarification(
  clarification: ClarificationPayload | undefined,
): string[] | undefined {
  if (!clarification?.questions?.length) return undefined
  return clarification.questions.map((q) => q.prompt)
}

export const CONFIRM_YES_NO_OPTIONS: ClarificationOption[] = [
  { id: 'yes', label: '继续', value: true },
  { id: 'no', label: '取消', value: false },
]

export function makeConfirmQuestion(params: {
  id: string
  prompt: string
  riskNote?: string
  riskCode: RiskCode
  required?: boolean
}): ClarificationQuestion {
  return clarificationQuestionSchema.parse({
    id: params.id,
    type: 'confirm',
    prompt: params.prompt,
    options: CONFIRM_YES_NO_OPTIONS,
    required: params.required !== false,
    riskNote: params.riskNote,
    binds: { slot: `risk.confirm:${params.riskCode}` },
  })
}

export function isConfirmRejected(answer: ClarificationAnswer, question: ClarificationQuestion): boolean {
  if (question.type !== 'confirm') return false
  if (answer.confirmed === false) return true
  if (answer.confirmed === true) return false
  const ids = answer.optionIds || []
  if (ids.includes('no')) return true
  if (ids.includes('yes')) return false
  return false
}

export function validateClarificationAnswers(
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[],
): { ok: true } | { ok: false; message: string } {
  const byId = new Map(answers.map((a) => [a.questionId, a]))
  for (const q of questions) {
    const a = byId.get(q.id)
    if (!a) {
      if (q.required) return { ok: false, message: `missing answer for ${q.id}` }
      continue
    }
    const optionIds = a.optionIds || []
    const optionSet = new Set((q.options || []).map((o) => o.id))
    for (const id of optionIds) {
      if (!optionSet.has(id)) return { ok: false, message: `unknown option ${id} for ${q.id}` }
    }
    if (q.type === 'single_choice') {
      const customOk = q.allowCustom && Boolean(a.text?.trim())
      if (optionIds.length === 1) continue
      if (customOk && optionIds.length === 0) continue
      return { ok: false, message: `single_choice ${q.id} needs exactly one option or custom text` }
    }
    if (q.type === 'multiple_choice') {
      if (optionIds.length < 1 && !(q.allowCustom && a.text?.trim())) {
        return { ok: false, message: `multiple_choice ${q.id} needs options or custom text` }
      }
      continue
    }
    if (q.type === 'text') {
      if (q.required && !a.text?.trim()) return { ok: false, message: `text ${q.id} required` }
      continue
    }
    if (q.type === 'confirm') {
      const yes = a.confirmed === true || optionIds.includes('yes')
      const no = a.confirmed === false || optionIds.includes('no')
      if (!yes && !no) return { ok: false, message: `confirm ${q.id} needs yes or no` }
    }
  }
  return { ok: true }
}

export const RISK_LEVEL_RANK: Record<RiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
}

export function maxRiskLevel(facts: RiskFact[]): RiskLevel {
  let max: RiskLevel = 'L0'
  for (const f of facts) {
    if (RISK_LEVEL_RANK[f.level] > RISK_LEVEL_RANK[max]) max = f.level
  }
  return max
}

/** 须先 clarify 的 L2（不含 event_overwrite） */
export const L2_CLARIFY_BEFORE_GENERATE = new Set<RiskCode>([
  'upload_config',
  'remote_datasource',
  'navigation',
  'browser_storage',
  'eval_like',
  'bulk_delete_rebuild',
])
