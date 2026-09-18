import { z } from 'zod'
import { generateResponseSchema, widgetTypeSchema } from './fieldPlan.js'
import { normalizeTargetRef } from '../services/parentScopeParser.js'

export const chatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
})

export const formJsonSchema = z.object({
  widgetList: z.array(z.any()),
  formConfig: z.record(z.any()),
})

export const refineRequestSchema = z.object({
  instruction: z.string().min(1).max(4000),
  currentFormJson: formJsonSchema,
  messages: z.array(chatTurnSchema).max(40).default([]),
})

/** 模型常把 target 写成纯字符串（id/name/parentScope），此处归一化为对象 */
export const targetRefSchema = z.preprocess((val) => normalizeTargetRef(val), z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    /** parentScope 语法解析：容器 type 过滤（如 tab-pane） */
    containerType: z.string().min(1).optional(),
    /** parentScope path: 前缀，用于 scope 批量 */
    pathPrefix: z.string().min(1).optional(),
  })
  .refine((t) => Boolean(t.id || t.name || t.label || t.pathPrefix), {
    message: 'target requires id, name, label, or pathPrefix',
  }))

export const optionItemSchema = z.object({
  label: z.string().min(1),
  value: z.union([z.string(), z.number()]),
})

export const refineFieldDraftSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: widgetTypeSchema,
  required: z.boolean().optional(),
  options: z.array(optionItemSchema).optional(),
  textContent: z.string().optional(),
  formula: z.string().max(2000).optional(),
  formulaEnabled: z.boolean().optional(),
})

export const refineOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('updateField'),
    target: targetRefSchema,
    patch: z
      .record(z.unknown())
      .refine((p) => Object.keys(p).length > 0, { message: 'patch must not be empty' }),
  }),
  z.object({
    op: z.literal('updateFieldsInScope'),
    /** 容器语境：tab-pane / grid-col 等 id|name|label */
    parent: targetRefSchema,
    /** 可选：仅更新该 type 的字段（如 radio） */
    filterType: z.string().min(1).optional(),
    patch: z
      .record(z.unknown())
      .refine((p) => Object.keys(p).length > 0, { message: 'patch must not be empty' }),
  }),
  z.object({
    op: z.literal('setFormula'),
    target: targetRefSchema,
    formula: z.string().min(1).max(2000),
    formulaEnabled: z.boolean().default(true),
  }),
  z.object({
    op: z.literal('addField'),
    field: refineFieldDraftSchema,
    /** 可选：放入指定 tab-pane（id/name） */
    parent: targetRefSchema.optional(),
  }),
  z.object({
    op: z.literal('wrapInTabs'),
    tabName: z.string().min(1).max(64).optional(),
    panes: z
      .array(
        z.object({
          label: z.string().min(1).max(100),
          /** 空表示该 pane 接收尚未分配的顶层控件 */
          targets: z.array(targetRefSchema).default([]),
        }),
      )
      .min(1)
      .max(12),
  }),
  z.object({
    op: z.literal('patchFormConfig'),
    patch: z
      .record(z.unknown())
      .refine((p) => Object.keys(p).length > 0, { message: 'form patch must not be empty' }),
  }),
  z.object({
    op: z.literal('setCustomClass'),
    target: targetRefSchema,
    customClass: z.string().min(1).max(120),
  }),
  z.object({
    op: z.literal('setCssCode'),
    css: z.string().min(1).max(8000),
    mode: z.enum(['append', 'replace']).default('append'),
    target: targetRefSchema.optional(),
    customClass: z.string().min(1).max(120).optional(),
  }),
])

export const refinePlanSchema = z.object({
  summary: z.string().min(1).max(500),
  warnings: z.array(z.string()).default([]),
  operations: z.array(refineOperationSchema).min(1).max(40),
})

export const refineResponseSchema = generateResponseSchema

export type RefineRequest = z.infer<typeof refineRequestSchema>
export type RefinePlan = z.infer<typeof refinePlanSchema>
export type RefineOperation = z.infer<typeof refineOperationSchema>
export type TargetRef = z.infer<typeof targetRefSchema>
export type FormJson = z.infer<typeof formJsonSchema>
