/**
 * v0.11 Catalog 创建能力真源：createKind / allowedParents / eventKeys /
 * previewCapabilities / 中文语义别名，以及与 create op 声明的漂移检查。
 */
import { isEventKey } from './catalogPolicy.js'
import {
  CREATE_NON_GOAL,
  REFINE_CREATE_WHITELIST,
  isCreateAllowedType,
} from './createWhitelistPolicy.js'
import type { WidgetCatalog, WidgetCatalogEntry } from './widgetCatalog.js'

export type CreateKind = 'standalone' | 'internal' | 'composite' | 'extension'

export type PreviewAct =
  | 'input'
  | 'clear'
  | 'click'
  | 'select'
  | 'toggle'
  | 'rate'
  | 'slide'
  | 'pickDate'
  | 'pickTime'
  | 'switchTab'
  | 'mount'
  | 'observeText'

export type PreviewAssert =
  | 'value'
  | 'hidden'
  | 'disabled'
  | 'required'
  | 'label'
  | 'text'
  | 'activeTab'
  | 'valid'
  | 'noError'
  | 'noNetwork'

export type WidgetCreateCapability = {
  createKind: CreateKind
  allowedParents: string[]
  eventKeys: string[]
  previewCapabilities: {
    acts: PreviewAct[]
    asserts: PreviewAssert[]
  }
  /** 指向本 type 的中文/业务别名（不含歧义多映射项） */
  semanticAliases: string[]
}

/** 必须挂在固定父容器下的内部节点 */
export const INTERNAL_CREATE_TYPES = new Set(['grid-col', 'table-cell', 'tab-pane'])

/** 需要复杂子树 / 专用结构 op 的复合容器 */
export const COMPOSITE_CREATE_TYPES = new Set([
  'grid',
  'tab',
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

/** 扩展/插槽边界（静态 Catalog 内） */
export const EXTENSION_CREATE_TYPES = new Set(['slot'])

/** 普通字段默认可挂载的父级（含既有 refine addField 已开放的重型壳） */
const STANDALONE_PARENTS = ['root', 'tab-pane', 'grid-col', 'table-cell', 'sub-form', 'vf-dialog'] as const

const FIELD_PREVIEW: WidgetCreateCapability['previewCapabilities'] = {
  acts: ['input', 'clear', 'mount'],
  asserts: ['value', 'hidden', 'disabled', 'required', 'label', 'valid', 'noError', 'noNetwork'],
}

const OPTION_PREVIEW: WidgetCreateCapability['previewCapabilities'] = {
  acts: ['select', 'clear', 'mount'],
  asserts: ['value', 'hidden', 'disabled', 'required', 'label', 'valid', 'noError', 'noNetwork'],
}

const TEXT_PREVIEW: WidgetCreateCapability['previewCapabilities'] = {
  acts: ['observeText', 'mount'],
  asserts: ['text', 'hidden', 'label', 'noError', 'noNetwork'],
}

const BUTTON_PREVIEW: WidgetCreateCapability['previewCapabilities'] = {
  acts: ['click', 'mount'],
  asserts: ['hidden', 'disabled', 'label', 'noError', 'noNetwork'],
}

const CONTAINER_PREVIEW: WidgetCreateCapability['previewCapabilities'] = {
  acts: ['mount', 'switchTab'],
  asserts: ['hidden', 'activeTab', 'noError', 'noNetwork'],
}

const EMPTY_PREVIEW: WidgetCreateCapability['previewCapabilities'] = {
  acts: ['mount'],
  asserts: ['noError', 'noNetwork'],
}

/**
 * 中文语义别名 → Catalog type 列表。
 * 单 type 为直达；多 type 为歧义，须走 Ask-before-act。
 */
export const SEMANTIC_ALIAS_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  计数器: ['number'],
  数字输入: ['number'],
  数字: ['number'],
  单行输入: ['input'],
  输入框: ['input'],
  文本框: ['input', 'textarea'],
  多行输入: ['textarea'],
  多行文本: ['textarea'],
  单选题: ['radio'],
  单选: ['radio'],
  多选题: ['checkbox'],
  多选: ['checkbox'],
  下拉: ['select'],
  下拉选项: ['select'],
  下拉选择: ['select'],
  级联: ['cascader'],
  级联选择: ['cascader'],
  日期: ['date'],
  日期区间: ['date-range'],
  日期范围: ['date-range'],
  时间: ['time'],
  时间区间: ['time-range'],
  时间范围: ['time-range'],
  开关: ['switch'],
  星级评分: ['rate'],
  评分: ['rate'],
  颜色: ['color'],
  颜色选择器: ['color'],
  滑块: ['slider'],
  说明文字: ['static-text'],
  静态文字: ['static-text'],
  静态文本: ['static-text'],
  HTML: ['html-text'],
  富文本: ['rich-editor'],
  分隔线: ['divider'],
  分割线: ['divider'],
  按钮: ['button'],
  栅格: ['grid'],
  栅格列: ['grid-col'],
  标签页: ['tab'],
  选项卡: ['tab'],
  选项卡页: ['tab-pane'],
}

/** PRD FR-3 必须覆盖的别名 */
export const REQUIRED_SEMANTIC_ALIASES = [
  '计数器',
  '数字输入',
  '多选题',
  '星级评分',
  '日期区间',
  '说明文字',
] as const

/** 具备实际 NL create op 的 type（与白名单对齐；grid/grid-col 不得出现） */
export const CREATE_OP_SUPPORTED_TYPES = new Set<string>([
  ...REFINE_CREATE_WHITELIST,
])

export function resolveCreateKind(type: string, entry?: WidgetCatalogEntry): CreateKind {
  if (EXTENSION_CREATE_TYPES.has(type) || entry?.notes?.extensionBoundary) return 'extension'
  if (INTERNAL_CREATE_TYPES.has(type) || entry?.variants.some((v) => v.structure.internal)) {
    return 'internal'
  }
  if (COMPOSITE_CREATE_TYPES.has(type)) return 'composite'
  return 'standalone'
}

export function allowedParentsFor(type: string, createKind: CreateKind): string[] {
  switch (type) {
    case 'tab-pane':
      return ['tab']
    case 'grid-col':
      return ['grid']
    case 'table-cell':
      return ['table']
    case 'tab':
    case 'grid':
    case 'table':
    case 'sub-form':
    case 'grid-sub-form':
    case 'data-table':
    case 'tree':
    case 'button-group':
    case 'object-group':
    case 'vf-dialog':
    case 'vf-drawer':
    case 'slot':
      return ['root', 'tab-pane', 'grid-col']
    default:
      if (createKind === 'standalone') return [...STANDALONE_PARENTS]
      if (createKind === 'internal') return []
      return ['root', 'tab-pane', 'grid-col']
  }
}

export function previewCapabilitiesFor(type: string): WidgetCreateCapability['previewCapabilities'] {
  switch (type) {
    case 'input':
    case 'textarea':
    case 'number':
      return FIELD_PREVIEW
    case 'radio':
    case 'checkbox':
    case 'select':
    case 'cascader':
    case 'color':
      return OPTION_PREVIEW
    case 'date':
    case 'date-range':
      return {
        acts: ['pickDate', 'clear', 'mount'],
        asserts: FIELD_PREVIEW.asserts,
      }
    case 'time':
    case 'time-range':
      return {
        acts: ['pickTime', 'clear', 'mount'],
        asserts: FIELD_PREVIEW.asserts,
      }
    case 'switch':
      return {
        acts: ['toggle', 'mount'],
        asserts: FIELD_PREVIEW.asserts,
      }
    case 'rate':
      return {
        acts: ['rate', 'mount'],
        asserts: FIELD_PREVIEW.asserts,
      }
    case 'slider':
      return {
        acts: ['slide', 'clear', 'mount'],
        asserts: FIELD_PREVIEW.asserts,
      }
    case 'static-text':
    case 'html-text':
    case 'rich-editor':
    case 'divider':
      return TEXT_PREVIEW
    case 'button':
      return BUTTON_PREVIEW
    case 'tab':
    case 'tab-pane':
      return CONTAINER_PREVIEW
    default:
      return EMPTY_PREVIEW
  }
}

export function semanticAliasesFor(type: string): string[] {
  return Object.entries(SEMANTIC_ALIAS_REGISTRY)
    .filter(([, types]) => types.length === 1 && types[0] === type)
    .map(([alias]) => alias)
    .sort()
}

export type SemanticAliasResolve =
  | { kind: 'exact'; type: string }
  | { kind: 'ambiguous'; types: readonly string[] }
  | { kind: 'unknown' }

/** 精确匹配注册表中的别名；多 type 为歧义，须 Ask-before-act */
export function resolveSemanticAlias(alias: string): SemanticAliasResolve {
  const key = String(alias || '').trim()
  if (!key) return { kind: 'unknown' }
  const types = SEMANTIC_ALIAS_REGISTRY[key]
  if (!types?.length) return { kind: 'unknown' }
  if (types.length === 1) return { kind: 'exact', type: types[0] }
  return { kind: 'ambiguous', types }
}

/**
 * 在指令中查找最长的歧义别名命中（避免「文本」误伤「文本框」等）。
 * 已确认 create.type 槽位时调用方应跳过。
 */
export function findAmbiguousSemanticAliasInText(
  text: string,
): { alias: string; types: readonly string[] } | null {
  const src = String(text || '')
  if (!src.trim()) return null
  const ambiguous = Object.entries(SEMANTIC_ALIAS_REGISTRY)
    .filter(([, types]) => types.length > 1)
    .sort((a, b) => b[0].length - a[0].length)
  for (const [alias, types] of ambiguous) {
    if (src.includes(alias)) return { alias, types }
  }
  return null
}

/** 歧义别名 → 结构化单选澄清（binds.create.type） */
export function buildTypeAmbiguityClarificationQuestion(params: {
  alias: string
  types: readonly string[]
  id?: string
}) {
  const labels: Record<string, string> = {
    input: '单行输入（input）',
    textarea: '多行文本（textarea）',
  }
  return {
    id: params.id || 'q_create_type',
    type: 'single_choice' as const,
    prompt: `「${params.alias}」对应多种组件类型，请选择要创建的类型（不得猜错后静默降级）`,
    required: true,
    allowCustom: false,
    binds: { slot: 'create.type' as const },
    options: params.types.map((type) => ({
      id: `type_${type}`,
      label: labels[type] || type,
      value: type,
    })),
  }
}

export function eventKeysFor(entry: WidgetCatalogEntry): string[] {
  const keys = new Set<string>()
  for (const key of entry.forbiddenKeys) {
    if (isEventKey(key)) keys.add(key)
  }
  for (const key of entry.applicableKeys || []) {
    if (isEventKey(key)) keys.add(key)
  }
  for (const key of Object.keys(entry.constraints)) {
    if (isEventKey(key)) keys.add(key)
  }
  return [...keys].sort()
}

export function buildWidgetCreateCapability(entry: WidgetCatalogEntry): WidgetCreateCapability {
  const createKind = resolveCreateKind(entry.type, entry)
  return {
    createKind,
    allowedParents: allowedParentsFor(entry.type, createKind),
    eventKeys: eventKeysFor(entry),
    previewCapabilities: previewCapabilitiesFor(entry.type),
    semanticAliases: semanticAliasesFor(entry.type),
  }
}

export function applyCreateCapability(entry: WidgetCatalogEntry): WidgetCatalogEntry {
  return {
    ...entry,
    create: buildWidgetCreateCapability(entry),
  }
}

/** 别名注册表漂移：映射目标须在 Catalog；PRD 必选别名须存在 */
export function checkSemanticAliasRegistryParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const catalogTypes = new Set(catalog.widgets.map((w) => w.type))

  for (const [alias, types] of Object.entries(SEMANTIC_ALIAS_REGISTRY)) {
    if (!alias.trim()) {
      issues.push('semantic alias registry contains empty alias')
      continue
    }
    if (!types.length) {
      issues.push(`semantic alias "${alias}" maps to empty type list`)
      continue
    }
    for (const type of types) {
      if (!catalogTypes.has(type)) {
        issues.push(`semantic alias "${alias}" → unknown type "${type}"`)
      }
    }
  }

  for (const required of REQUIRED_SEMANTIC_ALIASES) {
    const mapped = SEMANTIC_ALIAS_REGISTRY[required]
    if (!mapped?.length) {
      issues.push(`required semantic alias "${required}" missing from registry`)
    }
  }

  for (const widget of catalog.widgets) {
    const expected = semanticAliasesFor(widget.type)
    const actual = [...(widget.create?.semanticAliases || [])].sort()
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      issues.push(`${widget.type} create.semanticAliases drift vs registry`)
    }
  }

  return issues
}

/** createKind / allowedParents / eventKeys / previewCapabilities 与策略一致 */
export function checkCreateCapabilityParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []

  for (const widget of catalog.widgets) {
    const expected = buildWidgetCreateCapability(widget)
    const actual = widget.create
    if (!actual) {
      issues.push(`${widget.type} missing create capability block`)
      continue
    }
    if (actual.createKind !== expected.createKind) {
      issues.push(`${widget.type} createKind expected ${expected.createKind} got ${actual.createKind}`)
    }
    if (JSON.stringify([...actual.allowedParents].sort()) !== JSON.stringify([...expected.allowedParents].sort())) {
      issues.push(`${widget.type} allowedParents drift`)
    }
    if (JSON.stringify(actual.eventKeys) !== JSON.stringify(expected.eventKeys)) {
      issues.push(`${widget.type} eventKeys drift`)
    }
    if (JSON.stringify(actual.previewCapabilities) !== JSON.stringify(expected.previewCapabilities)) {
      issues.push(`${widget.type} previewCapabilities drift`)
    }

    if (INTERNAL_CREATE_TYPES.has(widget.type) && actual.createKind !== 'internal') {
      issues.push(`${widget.type} must be createKind=internal`)
    }
    if (EXTENSION_CREATE_TYPES.has(widget.type) && actual.createKind !== 'extension') {
      issues.push(`${widget.type} must be createKind=extension`)
    }
    if (COMPOSITE_CREATE_TYPES.has(widget.type) && actual.createKind !== 'composite') {
      issues.push(`${widget.type} must be createKind=composite`)
    }
  }

  const kinds = new Set(catalog.widgets.map((w) => w.create?.createKind).filter(Boolean))
  for (const required of ['standalone', 'internal', 'composite', 'extension'] as const) {
    if (!kinds.has(required)) {
      issues.push(`catalog missing createKind=${required}`)
    }
  }

  return issues
}

/**
 * 白名单与实际 create op 漂移：
 * - 白名单 type 必须有 create op（字段 addField / tab wrapInTabs）
 * - grid/grid-col 不得再出现在白名单（无专用 create op）
 */
export function checkCreateOpWhitelistParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const catalogTypes = new Set(catalog.widgets.map((w) => w.type))

  for (const banned of ['grid', 'grid-col'] as const) {
    if (isCreateAllowedType(banned)) {
      issues.push(`${banned} is in REFINE_CREATE_WHITELIST but has no dedicated create op`)
    }
    if (CREATE_NON_GOAL[banned] == null && catalogTypes.has(banned)) {
      issues.push(`${banned} must be CREATE_NON_GOAL when not creatable`)
    }
  }

  for (const type of REFINE_CREATE_WHITELIST) {
    if (!CREATE_OP_SUPPORTED_TYPES.has(type)) {
      issues.push(`REFINE_CREATE_WHITELIST type "${type}" missing create-op support declaration`)
    }
  }

  if (CREATE_NON_GOAL.grid !== 'structure-no-create-op') {
    issues.push('grid CREATE_NON_GOAL must be structure-no-create-op')
  }
  if (CREATE_NON_GOAL['grid-col'] !== 'internal-container') {
    issues.push('grid-col CREATE_NON_GOAL must be internal-container')
  }

  return issues
}
