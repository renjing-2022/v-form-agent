import { z } from 'zod'
import { chatTurnSchema, formJsonSchema, targetRefSchema } from './refinePlan.js'

export const interactionIntentSchema = z.enum([
  'interaction',
  'mixed',
  'structure_only',
  'unsupported',
  'need_clarification',
])

export const interactionHandlerSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  target: z.string().min(1).max(128),
  eventKey: z.string().min(1).max(64),
  code: z.string().max(20000),
  explain: z.string().max(2000).default(''),
})

const arrangeSchema = z
  .object({
    values: z.record(z.unknown()).optional(),
    activeTab: z.union([z.string(), z.number()]).optional(),
  })
  .default({})

const actSchema = z.union([
  z.object({ input: z.string(), value: z.unknown() }),
  z.object({ click: z.string() }),
  z.object({ switchTab: z.union([z.string(), z.number()]) }),
  z.object({ mount: z.literal(true) }),
  z.object({
    addSubFormRow: z.string(),
    values: z.record(z.unknown()).optional(),
  }),
  z.object({ submit: z.literal(true) }),
  z.object({ wait: z.number().int().positive().max(5000) }),
])

const assertSchema = z.union([
  z.object({ field: z.string(), value: z.unknown() }),
  z.object({ field: z.string(), hidden: z.boolean() }),
  z.object({ field: z.string(), disabled: z.boolean() }),
  z.object({ field: z.string(), required: z.boolean() }),
  z.object({ field: z.string(), label: z.string() }),
  z.object({ activeTab: z.union([z.string(), z.number()]) }),
  z.object({ focused: z.string() }),
  z.object({ valid: z.boolean() }),
  z.object({ dialogVisible: z.string(), value: z.boolean() }),
  z.object({ subFormRows: z.string(), count: z.number().int().nonnegative() }),
  z.object({ noNetwork: z.literal(true) }),
  z.object({ noError: z.literal(true) }),
])

export const interactionScenarioSchema = z.object({
  id: z.string().min(1).max(64),
  handlerRefs: z.array(z.string().min(1)).min(1),
  title: z.string().min(1).max(200),
  arrange: arrangeSchema,
  act: z.array(actSchema).default([]),
  assert: z.array(assertSchema).min(1),
})

export const addButtonOpSchema = z.object({
  op: z.literal('addButton'),
  label: z.string().min(1).max(100),
  name: z.string().min(1).max(64).optional(),
  /** 插入到指定容器（如 tab-pane name）；与 eachTabPane 二选一优先 eachTabPane */
  parent: targetRefSchema.optional(),
  eachTabPane: z.boolean().optional(),
  optionOverrides: z.record(z.unknown()).optional(),
})

/** 结构操作：addButton + 透传 refine 风格 op（合入阶段再严格校验） */
export const interactionStructureOpSchema = z.union([
  addButtonOpSchema,
  z
    .object({
      op: z.string().min(1),
    })
    .passthrough(),
])

export const interactionOutputSchema = z.object({
  intent: interactionIntentSchema,
  summary: z.string().max(4000).default(''),
  structure: z.array(interactionStructureOpSchema).default([]),
  handlers: z.array(interactionHandlerSchema).default([]),
  scenarios: z.array(interactionScenarioSchema).default([]),
  unsupported: z
    .array(
      z.object({
        text: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
  questions: z.array(z.string().min(1)).optional(),
  assumptions: z.array(z.string()).optional(),
})

export const interactionGenerateRequestSchema = z.object({
  action: z.literal('generate'),
  instruction: z.string().min(1).max(4000),
  currentFormJson: formJsonSchema,
  messages: z.array(chatTurnSchema).max(40).default([]),
})

export const interactionVerificationReportSchema = z.object({
  runner: z.enum(['designer-preview', 'playwright']),
  results: z.array(
    z.object({
      scenarioId: z.string(),
      ok: z.boolean(),
      actual: z.record(z.unknown()).optional(),
      error: z.string().optional(),
      unverifiable: z.boolean().optional(),
    }),
  ),
  pass: z.boolean(),
  networkHits: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
})

export const interactionRepairRequestSchema = z.object({
  action: z.literal('repair'),
  instruction: z.string().min(1).max(4000),
  currentFormJson: formJsonSchema,
  output: interactionOutputSchema,
  verificationReport: interactionVerificationReportSchema,
  round: z.number().int().positive().max(5),
  expectedScenarioFingerprint: z.string().min(1).optional(),
})

export const interactionApplyRequestSchema = z.object({
  action: z.literal('apply'),
  instruction: z.string().min(1).max(4000).optional(),
  currentFormJson: formJsonSchema,
  output: interactionOutputSchema,
  verificationReport: interactionVerificationReportSchema,
  userConfirmed: z.boolean(),
  confirmOverwrite: z.boolean().optional(),
})

export const interactionRequestSchema = z.discriminatedUnion('action', [
  interactionGenerateRequestSchema,
  interactionRepairRequestSchema,
  interactionApplyRequestSchema,
])

export type InteractionOutput = z.infer<typeof interactionOutputSchema>
export type InteractionHandler = z.infer<typeof interactionHandlerSchema>
export type InteractionScenario = z.infer<typeof interactionScenarioSchema>
export type InteractionStructureOp = z.infer<typeof interactionStructureOpSchema>
export type InteractionGenerateRequest = z.infer<typeof interactionGenerateRequestSchema>
