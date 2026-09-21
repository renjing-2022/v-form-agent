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

export const constraintSourceSchema = z.enum([
  'property-editor',
  'render-convention',
  'widgets-config',
  'policy',
])

/** DesignTruthGraph valueKind（与 property-editor / 渲染约定对齐） */
export const valueKindSchema = z.enum([
  'number',
  'string',
  'boolean',
  'enum',
  'cssText',
  'cssSize',
  'array',
  'object',
])

export const linkageBlockedWhenSchema = z.object({
  key: z.string().min(1),
  equals: z.unknown().optional(),
  truthy: z.boolean().optional(),
})

export const compositeItemFieldSchema = z.object({
  valueKind: valueKindSchema,
  required: z.boolean().optional(),
})

export const compositeSchemaSchema = z.object({
  id: z.string().min(1),
  requiredItemKeys: z.array(z.string().min(1)).optional(),
  itemFields: z.record(compositeItemFieldSchema).optional(),
  nestedKey: z.string().optional(),
  minItems: z.number().int().nonnegative().optional(),
  presets: z.array(z.string()).optional(),
})

export const optionConstraintRenderConventionSchema = z.object({
  id: z.string().min(1),
  component: z.literal('form-item-wrapper'),
  sourceRel: z.string().min(1),
  effect: z.string().min(1),
  inheritWhenEmpty: z.boolean().optional(),
  renderUnit: z.string().optional(),
  cssClass: z.string().optional(),
})

export const optionConstraintSchema = z.object({
  valueType: optionValueTypeSchema,
  nullable: z.boolean(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** 约束来源；缺省视为 widgets-config（v0.3 兼容） */
  source: constraintSourceSchema.optional(),
  /** 为 true 时拒绝类型漂移（如 number 键写入 "450px"） */
  strict: z.boolean().optional(),
  /** DesignTruthGraph：语义化值形态（enum/cssText 等） */
  valueKind: valueKindSchema.optional(),
  /** 空串/null 是否表示继承 formConfig（如 labelAlign=""） */
  inheritEmpty: z.boolean().optional(),
  /** 渲染单位说明（如 labelWidth 设计器渲染为 Npx） */
  unit: z.string().optional(),
  /** propertyRegister 映射的最终 editor 组件名 */
  editor: z.string().optional(),
  /** 当 when 条件成立时，本键 patch 应被忽略（rows-editor v-if="!autosize"） */
  linkageBlockedWhen: linkageBlockedWhenSchema.optional(),
  /** 复合值 item 形状（optionItems / treeData / 列定义等） */
  compositeSchema: compositeSchemaSchema.optional(),
  /** 属性作用域：field=表单项；container=容器壳层；form=表单级 */
  propertyScope: z.enum(['field', 'container', 'form']).optional(),
  /** 同键在 field/form 另一作用域的形态差异（双轨登记） */
  dualTrack: z
    .object({
      pairedScope: z.enum(['field', 'form']),
      pairedValueKind: valueKindSchema,
      pairedValueType: optionValueTypeSchema.optional(),
      pairedNullable: z.boolean().optional(),
      pairedInheritEmpty: z.boolean().optional(),
      pairedUnit: z.string().optional(),
      note: z.string().min(1),
    })
    .optional(),
  /** false=禁写但可见（事件/内部绑定等）；缺省视为 writableKeys 内可写 */
  writable: z.boolean().optional(),
  /** 禁写原因（须出现在 forbiddenKeys 且 constraints 可见） */
  forbiddenReason: z.enum(['event', 'internal-binding', 'runtime-data', 'policy']).optional(),
  /** identity 角色（options.name → field-name） */
  identityRole: z.enum(['field-name']).optional(),
  /** form-item-wrapper 等渲染约定 */
  renderConvention: optionConstraintRenderConventionSchema.optional(),
})

export const catalogIdentityRuleSchema = z.object({
  id: z.enum(['widget-id', 'field-name']),
  path: z.string().min(1),
  unique: z.literal(true),
  scope: z.literal('form-tree'),
  note: z.string().min(1),
})

export const catalogIdentitySchema = z.object({
  rules: z.array(catalogIdentityRuleSchema).min(1),
})

export const renderConventionRuleSchema = z.object({
  id: z.string().min(1),
  props: z.array(z.string().min(1)).min(1),
  effect: z.string().min(1),
  inheritWhenEmpty: z.boolean().optional(),
  renderUnit: z.string().optional(),
  cssClass: z.string().optional(),
})

export const catalogRenderConventionsSchema = z.object({
  component: z.literal('form-item-wrapper'),
  sourceRel: z.string().min(1),
  rules: z.array(renderConventionRuleSchema).min(1),
})

export const catalogExtensionRuntimeTypeSchema = z.object({
  type: z.string().min(1),
  category: z.enum(['container', 'custom']),
  registerVia: z.enum(['addContainerWidgetSchema', 'addCustomWidgetSchema']),
  sourceRel: z.string().min(1),
  note: z.string().min(1),
})

export const catalogExtensionPolicySchema = z.object({
  staticScope: z.object({
    sourceRel: z.string().min(1),
    compileFrom: z.array(z.string().min(1)).min(1),
    note: z.string().min(1),
  }),
  customFields: z.object({
    staticExportEmpty: z.literal(true),
    registerApi: z.literal('addCustomWidgetSchema'),
    note: z.string().min(1),
  }),
  runtimeRegister: z.object({
    sourceRel: z.string().min(1),
    loadEntry: z.literal('loadExtension'),
    registerApis: z.array(z.string().min(1)).min(1),
    knownRuntimeTypes: z.array(catalogExtensionRuntimeTypeSchema).min(1),
    staticCoverage: z.literal('NON_GOAL'),
    note: z.string().min(1),
  }),
  createNonGoal: z.object({
    reason: z.literal('extension-runtime'),
    staticTypes: z.array(z.string().min(1)).min(1),
    note: z.string().min(1),
  }),
})

export const widgetExtensionBoundaryNoteSchema = z.object({
  kind: z.literal('static-adjacent'),
  createNonGoal: z.literal('extension-runtime'),
  note: z.string().min(1),
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
  /** hasConfig 等价：canonical variant 模板 options 中存在的键 */
  applicableKeys: z.array(z.string().min(1)).optional(),
  /** 容器级属性键（category=container；非 form-item field） */
  containerLevelKeys: z.array(z.string().min(1)).optional(),
  constraints: z.record(optionConstraintSchema),
  notes: z
    .object({
      structureSurgery: z.enum(['supported', 'partial', 'unsupported']).optional(),
      /** 本条目是否满足高精度矩阵 enum 覆盖 */
      highPrecisionReady: z.boolean().optional(),
      /** 静态 Catalog 内 extension-adjacent 边界说明 */
      extensionBoundary: widgetExtensionBoundaryNoteSchema.optional(),
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
    /** 参与指纹的 property-editor 等附加真源（相对仓库路径） */
    propertyEditors: z.array(z.string().min(1)).optional(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  generatedAt: z.literal('source-derived'),
  identity: catalogIdentitySchema,
  renderConventions: catalogRenderConventionsSchema,
  extensionPolicy: catalogExtensionPolicySchema,
  widgets: z.array(widgetCatalogEntrySchema).min(1),
  form: formCatalogSchema,
})

export type OptionValueType = z.infer<typeof optionValueTypeSchema>
export type ValueKind = z.infer<typeof valueKindSchema>
export type LinkageBlockedWhen = z.infer<typeof linkageBlockedWhenSchema>
export type CompositeSchema = z.infer<typeof compositeSchemaSchema>
export type OptionConstraint = z.infer<typeof optionConstraintSchema>
export type WidgetCatalog = z.infer<typeof widgetCatalogSchema>
export type WidgetCatalogEntry = z.infer<typeof widgetCatalogEntrySchema>

function itemHasCompositeKeys(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => key in item)
}

function valueMatchesCompositeSchema(schema: CompositeSchema, value: unknown, nullable: boolean): boolean {
  if (value === null || value === undefined) {
    return nullable
  }
  if (schema.presets) {
    if (value === '') return true
    return typeof value === 'string'
  }
  if (value === '') {
    return nullable
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false
    if (!schema.requiredItemKeys?.length) return true
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      if (!itemHasCompositeKeys(item as Record<string, unknown>, schema.requiredItemKeys)) return false
    }
    return true
  }
  if (schema.requiredItemKeys && typeof value === 'object') {
    return itemHasCompositeKeys(value as Record<string, unknown>, schema.requiredItemKeys)
  }
  return true
}

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

  if (constraint.strict) {
    if (constraint.valueType === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) return false
    } else if (constraint.valueType === 'boolean') {
      if (typeof value !== 'boolean') return false
    } else if (constraint.valueType === 'string') {
      if (typeof value !== 'string') return false
    } else if (constraint.valueType === 'array') {
      if (!Array.isArray(value)) return false
    } else if (actual !== constraint.valueType) {
      return false
    }
    if (constraint.enum && (actual === 'string' || actual === 'number' || actual === 'boolean')) {
      return constraint.enum.includes(value as string | number | boolean)
    }
    if (constraint.compositeSchema && !valueMatchesCompositeSchema(constraint.compositeSchema, value, constraint.nullable)) {
      return false
    }
    return true
  }

  if (constraint.valueType === 'null' || constraint.valueType === 'undefined') {
    if (!(actual === 'string' || actual === 'number' || actual === 'boolean' || actual === 'null')) return false
    if (constraint.enum && (actual === 'string' || actual === 'number' || actual === 'boolean')) {
      return constraint.enum.includes(value as string | number | boolean)
    }
    return true
  }
  if (actual !== constraint.valueType) return false
  if (constraint.enum && (actual === 'string' || actual === 'number' || actual === 'boolean')) {
    return constraint.enum.includes(value as string | number | boolean)
  }
  if (constraint.compositeSchema && !valueMatchesCompositeSchema(constraint.compositeSchema, value, constraint.nullable)) {
    return false
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

export function calculateCatalogFingerprint(
  widgetsSource: string,
  formConfigSource: string,
  extraSources: Array<{ path: string; content: string }> = [],
): string {
  const hash = createHash('sha256')
    .update(widgetsSource.replace(/\r\n/g, '\n'))
    .update('\n---FORM_CONFIG---\n')
    .update(formConfigSource.replace(/\r\n/g, '\n'))
  for (const extra of extraSources) {
    hash.update(`\n---EDITOR:${extra.path}---\n`)
    hash.update(extra.content.replace(/\r\n/g, '\n'))
  }
  return hash.digest('hex')
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
