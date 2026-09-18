/**
 * 设计真源优先级（冲突时）：
 * 1. property-editor 明示枚举
 * 2. 渲染 class / 表单约定
 * 3. widgetsConfig 默认值（存在性与出厂形态）
 * 4. catalogPolicy 手写策略（禁写、结构手术）
 *
 * 「源码级高精度」仅对 HIGH_PRECISION_MATRIX 中的键宣称；无 enum 的可写键不得计入该宣称。
 */

import type { OptionConstraint, ValueKind } from './widgetCatalog.js'
import type { DesignTruthGraph } from './designTruthGraph.js'

export const WIDGETS_CONFIG_REL = 'v-form/src/components/form-designer/widget-panel/widgetsConfig.js'
export const FORM_CONFIG_REL = 'v-form/src/utils/util.js'
export const PROPERTY_REGISTER_REL =
  'v-form/src/components/form-designer/setting-panel/propertyRegister.js'
export const PROPERTY_EDITOR_ROOT_REL =
  'v-form/src/components/form-designer/setting-panel/property-editor'
export const CATALOG_JSON_REL = 'agent/src/knowledge/generated/widget-catalog.json'
export const DESIGN_TRUTH_GRAPH_REL = 'agent/src/knowledge/generated/design-truth-graph.json'

export const PROPERTY_EDITOR_RELS = {
  labelAlign: 'v-form/src/components/form-designer/setting-panel/property-editor/labelAlign-editor.vue',
  displayStyle: 'v-form/src/components/form-designer/setting-panel/property-editor/displayStyle-editor.vue',
  labelWidth: 'v-form/src/components/form-designer/setting-panel/property-editor/labelWidth-editor.vue',
  size: 'v-form/src/components/form-designer/setting-panel/property-editor/size-editor.vue',
} as const

/** 控件 size：编辑器存 ''|large|small（UI 显示 default 对应 ''） */
export const WIDGET_SIZE_ENUM: Array<string | number | boolean> = ['', 'large', 'small']

/** 表单 size：与 form-setting.vue 一致 */
export const FORM_SIZE_ENUM: Array<string | number | boolean> = ['', 'large', 'small']

export type TruthValueKindOverride = {
  valueType: 'number' | 'string' | 'boolean' | 'array'
  nullable: boolean
  source: ConstraintSource
  strict: boolean
}

/** property-editor / 渲染约定覆盖出厂 null 指纹（高精度 + 常见 number 键） */
export const WIDGET_TRUTH_VALUE_KIND: Record<string, TruthValueKindOverride> = {
  labelWidth: { valueType: 'number', nullable: true, source: 'property-editor', strict: true },
  labelWrap: { valueType: 'boolean', nullable: false, source: 'property-editor', strict: true },
  labelHidden: { valueType: 'boolean', nullable: false, source: 'property-editor', strict: true },
  minLength: { valueType: 'number', nullable: true, source: 'property-editor', strict: true },
  maxLength: { valueType: 'number', nullable: true, source: 'property-editor', strict: true },
  rows: { valueType: 'number', nullable: false, source: 'property-editor', strict: true },
  gutter: { valueType: 'number', nullable: false, source: 'property-editor', strict: true },
  colHeight: { valueType: 'number', nullable: true, source: 'property-editor', strict: true },
  columnWidth: { valueType: 'string', nullable: false, source: 'widgets-config', strict: true },
  customClass: { valueType: 'string', nullable: false, source: 'widgets-config', strict: true },
}

export const FORM_TRUTH_VALUE_KIND: Record<string, TruthValueKindOverride> = {
  labelWidth: { valueType: 'number', nullable: false, source: 'render-convention', strict: true },
  customClass: { valueType: 'array', nullable: false, source: 'render-convention', strict: true },
}

/** 本版必须 100% 具备与设计器一致 enum 的高精度属性矩阵 */
export const HIGH_PRECISION_MATRIX = {
  widgetKeys: ['labelAlign', 'displayStyle', 'labelWidth', 'labelWrap', 'labelHidden', 'size'] as const,
  formKeys: ['labelAlign', 'labelPosition', 'labelWidth', 'size', 'layoutType'] as const,
}

/** 字段级 labelAlign：空串表示继承 formConfig（与 form-item-wrapper 一致） */
export const FIELD_LABEL_ALIGN_ENUM: Array<string | number | boolean> = [
  '',
  'label-left-align',
  'label-center-align',
  'label-right-align',
]

export const FORM_LABEL_ALIGN_ENUM: Array<string | number | boolean> = [
  'label-left-align',
  'label-center-align',
  'label-right-align',
]

export const DISPLAY_STYLE_ENUM: Array<string | number | boolean> = ['inline', 'block']

export const STRUCTURE_SURGERY_SUPPORTED = new Set(['tab', 'tab-pane', 'grid', 'grid-col'])

export const HEAVY_STRUCTURE_TYPES = new Set([
  'table',
  'sub-form',
  'grid-sub-form',
  'data-table',
  'tree',
  'button-group',
  'object-group',
  'vf-dialog',
  'vf-drawer',
])

const FORM_FORBIDDEN_KEYS = new Set([
  'modelName',
  'refName',
  'rulesName',
  'jsonVersion',
  'functions',
  'dataSources',
  'onFormCreated',
  'onFormMounted',
  'onFormDataChange',
  'onFormValidate',
])

const WIDGET_FORBIDDEN_KEYS = new Set([
  'customRule',
  'dsEnabled',
  'dsName',
  'dataSetName',
  'remote',
])

export type ConstraintSource = 'property-editor' | 'render-convention' | 'widgets-config' | 'policy'

export function isEventKey(key: string): boolean {
  return /^on[A-Z]/.test(key)
}

export function isForbiddenWidgetKey(key: string): boolean {
  return isEventKey(key) || WIDGET_FORBIDDEN_KEYS.has(key)
}

export function isForbiddenFormKey(key: string): boolean {
  return isEventKey(key) || FORM_FORBIDDEN_KEYS.has(key)
}

export function classifyKeys(keys: string[], kind: 'widget' | 'form'): { writable: string[]; forbidden: string[] } {
  const forbidden: string[] = []
  const writable: string[] = []
  const predicate = kind === 'form' ? isForbiddenFormKey : isForbiddenWidgetKey
  for (const key of [...keys].sort()) {
    if (predicate(key)) forbidden.push(key)
    else writable.push(key)
  }
  return { writable, forbidden }
}

export function enumFor(_type: string, _key: string): Array<string | number | boolean> | undefined {
  /** @deprecated 使用 catalogEnumPolicy.resolveCatalogEnumFromGraph；保留签名供旧引用迁移 */
  void _type
  void _key
  return undefined
}

export function formEnumFor(key: string): Array<string | number | boolean> | undefined {
  /** @deprecated 使用 catalogEnumPolicy.formPolicyEnumFor / resolveFormCatalogEnum */
  if (key === 'labelAlign') return FORM_LABEL_ALIGN_ENUM
  if (key === 'size') return FORM_SIZE_ENUM
  if (key === 'labelPosition') return ['left', 'right', 'top']
  if (key === 'layoutType') return ['PC', 'H5', 'Pad']
  return undefined
}

export function constraintSourceFor(kind: 'widget' | 'form', key: string): ConstraintSource {
  if (kind === 'form') {
    if (key === 'labelAlign') return 'property-editor'
    if (key === 'labelWidth') return 'render-convention'
    if (formEnumFor(key)) return 'policy'
    return 'widgets-config'
  }
  if (key === 'labelAlign' || key === 'displayStyle' || key === 'labelWidth' || key === 'size') {
    return 'property-editor'
  }
  if (WIDGET_TRUTH_VALUE_KIND[key]) return WIDGET_TRUTH_VALUE_KIND[key].source
  return 'widgets-config'
}

export function structureSurgeryFor(type: string): 'supported' | 'unsupported' {
  if (STRUCTURE_SURGERY_SUPPORTED.has(type)) return 'supported'
  if (HEAVY_STRUCTURE_TYPES.has(type)) return 'unsupported'
  return 'unsupported'
}

export function detectChildCollections(schema: Record<string, unknown>): Array<{
  key: string
  shape: 'list' | 'matrix'
  allowedTypes: string[]
}> {
  const collections: Array<{ key: string; shape: 'list' | 'matrix'; allowedTypes: string[] }> = []
  const type = String(schema.type || '')
  if (Array.isArray(schema.cols)) {
    collections.push({ key: 'cols', shape: 'list', allowedTypes: type === 'grid' ? ['grid-col'] : [] })
  }
  if (Array.isArray(schema.tabs)) {
    collections.push({ key: 'tabs', shape: 'list', allowedTypes: ['tab-pane'] })
  }
  if (Array.isArray(schema.rows)) {
    collections.push({ key: 'rows', shape: 'matrix', allowedTypes: type === 'table' ? ['table-cell'] : [] })
  }
  if (Array.isArray(schema.widgetList)) {
    collections.push({ key: 'widgetList', shape: 'list', allowedTypes: [] })
  }
  return collections
}

/** 从 size-editor 等 data() 中的 widgetSizes 提取 value 枚举 */
export function extractDataArrayEnumValues(vueSource: string, arrayName: string): string[] {
  const blockRe = new RegExp(`${arrayName}:\\s*\\[([\\s\\S]*?)\\]`)
  const block = vueSource.match(blockRe)
  if (!block) return []
  const values: string[] = []
  const valueRe = /value:\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = valueRe.exec(block[1]))) {
    values.push(m[1])
  }
  return values
}

/** 从 property-editor Vue SFC 提取 el-radio / el-option 的静态枚举字面量 */
export function extractEditorEnumLiterals(vueSource: string): string[] {
  const labels = new Set<string>()
  const radioRe = /<(?:el-radio-button|el-radio)\b[^>]*\blabel="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = radioRe.exec(vueSource))) {
    labels.add(m[1])
  }
  const boundOptionRe = /<el-option\b[^>]*(?::value|:label)="([^"]*)"/g
  while ((m = boundOptionRe.exec(vueSource))) {
    if (!m[1].includes('.')) labels.add(m[1])
  }
  const optionTagRe = /<el-option\b[^>]*>/g
  while ((m = optionTagRe.exec(vueSource))) {
    const tag = m[0]
    if (/:value=/.test(tag)) continue
    const valueMatch = tag.match(/\bvalue="([^"]*)"/)
    if (valueMatch) labels.add(valueMatch[1])
  }
  return [...labels]
}

export function enumsEqual(
  a: Array<string | number | boolean> | undefined,
  b: Array<string | number | boolean> | undefined,
): boolean {
  if (!a || !b) return a === b
  if (a.length !== b.length) return false
  const sa = [...a].map(String).sort()
  const sb = [...b].map(String).sort()
  return sa.every((v, i) => v === sb[i])
}

export type PropertyRegisterMaps = {
  common: Record<string, string>
  advanced: Record<string, string>
  event: Record<string, string>
}

function extractConstObjectBody(source: string, constName: string): string {
  const marker = `const ${constName} = {`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`${constName} not found in propertyRegister.js`)
  const braceStart = source.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(braceStart + 1, i)
    }
  }
  throw new Error(`${constName} object not closed in propertyRegister.js`)
}

function parseRegisterBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    out[m[1]] = m[2]
  }
  return out
}

/** 解析 propertyRegister.js 三组属性→editor 映射 */
export function parsePropertyRegister(source: string): PropertyRegisterMaps {
  return {
    common: parseRegisterBlock(extractConstObjectBody(source, 'COMMON_PROPERTIES')),
    advanced: parseRegisterBlock(extractConstObjectBody(source, 'ADVANCED_PROPERTIES')),
    event: parseRegisterBlock(extractConstObjectBody(source, 'EVENT_PROPERTIES')),
  }
}

export function propertyRegisterEditorFor(
  maps: PropertyRegisterMaps,
  prop: string,
): string | undefined {
  return maps.common[prop] || maps.advanced[prop] || maps.event[prop]
}

/** 字段级 inheritEmpty 语义（空串/null 继承 formConfig） */
export const FIELD_INHERIT_EMPTY_KEYS = new Set(['labelAlign', 'labelWidth'])

/** 渲染单位（非 JSON 存储形态） */
export const TRUTH_UNIT_BY_KEY: Record<string, string> = {
  labelWidth: 'px',
}

/** rows-editor.vue: v-if="!optionModel.autosize" */
export const LINKAGE_BLOCKED_WHEN_BY_KEY: Record<string, { key: string; equals?: unknown; truthy?: boolean }> = {
  rows: { key: 'autosize', equals: true },
}

/** propertyMixin.onRemoteChange / onAllowCreateChange：remote 或 allowCreate 为 true 时 filterable 必须为 true */
export const LINKAGE_FILTERABLE_BLOCKED_WHEN = { key: 'remote', truthy: true } as const

/** propertyMixin.onMultipleSelected：multiple 与 defaultValue 形状必须一致 */
export const LINKAGE_MULTIPLE_DEFAULT_VALUE = {
  multipleKey: 'multiple',
  valueKey: 'defaultValue',
} as const

export function deriveValueKind(
  key: string,
  constraint: Pick<OptionConstraint, 'valueType' | 'enum' | 'strict'>,
): ValueKind {
  if (constraint.enum?.length) return 'enum'
  if (key === 'columnWidth') return 'cssText'
  if (constraint.valueType === 'number') return 'number'
  if (constraint.valueType === 'boolean') return 'boolean'
  if (constraint.valueType === 'array') return 'array'
  if (constraint.valueType === 'object') return 'object'
  return 'string'
}

export function resolveEffectiveEditorName(
  widgetType: string | undefined,
  prop: string,
  register: PropertyRegisterMaps,
  graph: DesignTruthGraph,
): string | undefined {
  if (widgetType) {
    const overrideName = `${widgetType}-${prop}-editor`
    if (graph.editors[overrideName]) return overrideName
  }
  return propertyRegisterEditorFor(register, prop)
}

export function enrichDesignTruthConstraint(
  key: string,
  constraint: OptionConstraint,
  editorMap?: PropertyRegisterMaps,
  editorGraph?: DesignTruthGraph,
  widgetType?: string,
  scope: 'field' | 'form' | 'container' = widgetType ? 'field' : 'form',
): OptionConstraint {
  const editor =
    editorMap && editorGraph
      ? resolveEffectiveEditorName(widgetType, key, editorMap, editorGraph)
      : editorMap
        ? propertyRegisterEditorFor(editorMap, key)
        : undefined
  const editorMeta = editor ? editorGraph?.editors[editor] : undefined
  const linkageBlockedWhen =
    LINKAGE_BLOCKED_WHEN_BY_KEY[key] ?? editorMeta?.linkageHiddenWhen
  const inheritEmpty =
    scope === 'field' && FIELD_INHERIT_EMPTY_KEYS.has(key) ? true : undefined
  const unit = TRUTH_UNIT_BY_KEY[key]
  const valueKind = editorMeta?.valueKind ?? deriveValueKind(key, constraint)
  return {
    ...constraint,
    valueKind,
    ...(inheritEmpty ? { inheritEmpty } : {}),
    ...(unit ? { unit } : {}),
    ...(editor ? { editor } : {}),
    ...(linkageBlockedWhen ? { linkageBlockedWhen } : {}),
  }
}

export function linkageConditionMet(
  when: { key: string; equals?: unknown; truthy?: boolean },
  options: Record<string, unknown>,
): boolean {
  const value = options[when.key]
  if (when.truthy) return Boolean(value)
  if ('equals' in when) return value === when.equals
  return Boolean(value)
}

export function effectiveOptionValue(
  key: string,
  currentOptions: Record<string, unknown>,
  patch: Record<string, unknown>,
): unknown {
  if (key in patch) return patch[key]
  return currentOptions[key]
}
