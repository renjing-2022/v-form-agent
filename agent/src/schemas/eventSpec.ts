import { z } from 'zod'
import { formJsonSchema, chatTurnSchema } from './refinePlan.js'

export const eventExampleSchema = z.object({
  given: z.record(z.any()),
  expect: z.record(z.any()),
  note: z.string().max(500).optional(),
})

export const eventTriggerSchema = z.object({
  widgetRef: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      label: z.string().optional(),
    })
    .optional(),
  eventKey: z.string().min(1),
})

export const eventSinkSchema = z.object({
  kind: z.enum(['widget-event', 'form-event', 'functions']),
  eventKey: z.string().min(1).optional(),
  functionName: z.string().min(1).optional(),
})

export const eventSpecSchema = z.object({
  trigger: eventTriggerSchema,
  sink: eventSinkSchema,
  overwritePolicy: z.enum(['reject-if-present', 'overwrite-if-confirmed']).default('reject-if-present'),
  examples: z.array(eventExampleSchema).min(1),
  notes: z.array(z.string()).default([]),
})

export const executionResultSchema = z.object({
  exampleIndex: z.number().int().nonnegative(),
  ok: z.boolean(),
  actual: z.record(z.any()).optional(),
  error: z.string().optional(),
})

export const executionReportSchema = z.object({
  runner: z.enum(['designer-preview', 'playwright']),
  results: z.array(executionResultSchema).min(1),
  pass: z.boolean(),
})

export const eventPatchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('widget-event'),
    widgetId: z.string().min(1),
    eventKey: z.string().min(1),
    code: z.string().min(1),
  }),
  z.object({
    kind: z.literal('form-event'),
    eventKey: z.string().min(1),
    code: z.string().min(1),
  }),
  z.object({
    kind: z.literal('functions'),
    code: z.string().min(1),
  }),
])

export const eventRequestSchema = z.object({
  instruction: z.string().min(1).max(4000),
  currentFormJson: formJsonSchema,
  messages: z.array(chatTurnSchema).max(40).default([]),
  action: z.enum(['clarify', 'generate', 'apply']).default('clarify'),
  eventSpec: eventSpecSchema.optional(),
  patches: z.array(eventPatchSchema).optional(),
  code: z.string().optional(),
  formJsonCandidate: formJsonSchema.optional(),
  executionReport: executionReportSchema.optional(),
  confirmOverwrite: z.boolean().optional(),
})

export const eventResponseSchema = z.object({
  status: z.enum(['need_clarification', 'spec_ready', 'code_preview', 'applied', 'draft']),
  summary: z.string(),
  warnings: z.array(z.string()).default([]),
  questions: z.array(z.string()).optional(),
  eventSpec: eventSpecSchema.optional(),
  code: z.string().optional(),
  patches: z.array(eventPatchSchema).optional(),
  formJsonCandidate: formJsonSchema.optional(),
  formJson: formJsonSchema,
  applied: z.boolean(),
  executionReport: executionReportSchema.optional(),
})

export type EventSpec = z.infer<typeof eventSpecSchema>
export type EventRequest = z.infer<typeof eventRequestSchema>
export type EventResponse = z.infer<typeof eventResponseSchema>
export type ExecutionReport = z.infer<typeof executionReportSchema>
