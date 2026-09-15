import { createHash } from 'node:crypto'
import { z } from 'zod'

export const optionValueTypeSchema = z.enum([
  'undefined',
  'null',
  'string',
  'number',
  'boolean',
  'array',
  'object',
])

export const optionConstraintSchema = z.object({
  valueType: optionValueTypeSchema,
  nullable: z.boolean(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
})

export const widgetStructureSchema = z.object({
  internal: z.boolean(),
  childCollections: z.array(
    z.object({
      key: z.string().min(1),
      shape: z.enum(['list', 'matrix']),
      allowedTypes: z.array(z.string().min(1)).default([]),
    }),
  ),
})

export const widgetCatalogVariantSchema = z.object({
  alias: z.string().nullable(),
  icon: z.string().nullable(),
  defaultOptions: z.record(z.unknown()),
  structure: widgetStructureSchema,
})

export const widgetCatalogEntrySchema = z.object({
  type: z.string().min(1),
  category: z.enum(['container', 'basic', 'advanced', 'custom', 'chart-container', 'chart-widget']),
  formItem: z.boolean(),
  variants: z.array(widgetCatalogVariantSchema).min(1),
  writableKeys: z.array(z.string().min(1)),
  forbiddenKeys: z.array(z.string().min(1)),
  constraints: z.record(optionConstraintSchema),
  notes: z
    .object({
      structureSurgery: z.enum(['supported', 'unsupported']).optional(),
    })
    .optional(),
})

export const formCatalogSchema = z.object({
  defaultConfig: z.record(z.unknown()),
  writableKeys: z.array(z.string().min(1)),
  forbiddenKeys: z.array(z.string().min(1)),
  constraints: z.record(optionConstraintSchema),
})

export const widgetCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    widgetsConfig: z.string().min(1),
    formConfig: z.string().min(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  generatedAt: z.literal('source-derived'),
  widgets: z.array(widgetCatalogEntrySchema).min(1),
  form: formCatalogSchema,
})

export type OptionValueType = z.infer<typeof optionValueTypeSchema>
export type OptionConstraint = z.infer<typeof optionConstraintSchema>
export type WidgetCatalog = z.infer<typeof widgetCatalogSchema>
export type WidgetCatalogEntry = z.infer<typeof widgetCatalogEntrySchema>

export function detectOptionValueType(value: unknown): OptionValueType {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

/**
 * Catalog 出厂默认常为 null/undefined，仅表示「初始为空」，不表示运行时只能为空。
 * 与 patch 消毒共用：允许常见标量；枚举仍按 constraint.enum 校验。
 */
export function valueMatchesConstraint(constraint: OptionConstraint | undefined, value: unknown): boolean {
  if (!constraint) return false
  if (value === null || value === undefined) {
    return constraint.nullable || constraint.valueType === 'null' || constraint.valueType === 'undefined'
  }
  const actual = detectOptionValueType(value)
  if (constraint.valueType === 'null' || constraint.valueType === 'undefined') {
    return actual === 'string' || actual === 'number' || actual === 'boolean' || actual === 'null'
  }
  if (actual !== constraint.valueType) return false
  if (constraint.enum && (actual === 'string' || actual === 'number' || actual === 'boolean')) {
    return constraint.enum.includes(value as string | number | boolean)
  }
  return true
}

export function buildOptionConstraints(options: Record<string, unknown>): Record<string, OptionConstraint> {
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      {
        valueType: detectOptionValueType(value),
        nullable: value === null || value === undefined,
      },
    ]),
  )
}

export function calculateCatalogFingerprint(widgetsSource: string, formConfigSource: string): string {
  return createHash('sha256')
    .update(widgetsSource.replace(/\r\n/g, '\n'))
    .update('\n---FORM_CONFIG---\n')
    .update(formConfigSource.replace(/\r\n/g, '\n'))
    .digest('hex')
}

export function parseWidgetCatalog(input: unknown): WidgetCatalog {
  return widgetCatalogSchema.parse(input)
}

export function diffWidgetCatalog(expected: WidgetCatalog, actual: WidgetCatalog): string[] {
  const diffs: string[] = []
  if (expected.source.fingerprint !== actual.source.fingerprint) {
    diffs.push(
      `fingerprint mismatch: expected ${expected.source.fingerprint} actual ${actual.source.fingerprint}`,
    )
  }
  const expectedTypes = new Set(expected.widgets.map((w) => w.type))
  const actualTypes = new Set(actual.widgets.map((w) => w.type))
  for (const type of expectedTypes) {
    if (!actualTypes.has(type)) diffs.push(`missing widget type: ${type}`)
  }
  for (const type of actualTypes) {
    if (!expectedTypes.has(type)) diffs.push(`unexpected widget type: ${type}`)
  }
  const actualByType = new Map(actual.widgets.map((w) => [w.type, w]))
  for (const widget of expected.widgets) {
    const other = actualByType.get(widget.type)
    if (!other) continue
    const missingWritable = widget.writableKeys.filter((k) => !other.writableKeys.includes(k))
    const extraWritable = other.writableKeys.filter((k) => !widget.writableKeys.includes(k))
    const missingForbidden = widget.forbiddenKeys.filter((k) => !other.forbiddenKeys.includes(k))
    const extraForbidden = other.forbiddenKeys.filter((k) => !widget.forbiddenKeys.includes(k))
    if (missingWritable.length) diffs.push(`${widget.type} missing writableKeys: ${missingWritable.join(', ')}`)
    if (extraWritable.length) diffs.push(`${widget.type} extra writableKeys: ${extraWritable.join(', ')}`)
    if (missingForbidden.length) diffs.push(`${widget.type} missing forbiddenKeys: ${missingForbidden.join(', ')}`)
    if (extraForbidden.length) diffs.push(`${widget.type} extra forbiddenKeys: ${extraForbidden.join(', ')}`)
  }
  const formMissingWritable = expected.form.writableKeys.filter((k) => !actual.form.writableKeys.includes(k))
  const formExtraWritable = actual.form.writableKeys.filter((k) => !expected.form.writableKeys.includes(k))
  const formMissingForbidden = expected.form.forbiddenKeys.filter((k) => !actual.form.forbiddenKeys.includes(k))
  const formExtraForbidden = actual.form.forbiddenKeys.filter((k) => !expected.form.forbiddenKeys.includes(k))
  if (formMissingWritable.length) diffs.push(`form missing writableKeys: ${formMissingWritable.join(', ')}`)
  if (formExtraWritable.length) diffs.push(`form extra writableKeys: ${formExtraWritable.join(', ')}`)
  if (formMissingForbidden.length) diffs.push(`form missing forbiddenKeys: ${formMissingForbidden.join(', ')}`)
  if (formExtraForbidden.length) diffs.push(`form extra forbiddenKeys: ${formExtraForbidden.join(', ')}`)
  return diffs
}
