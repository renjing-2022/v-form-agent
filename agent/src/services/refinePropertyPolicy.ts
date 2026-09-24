import { valueMatchesConstraint, type OptionConstraint, type WidgetCatalog } from '../knowledge/widgetCatalog.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import {
  effectiveOptionValue,
  linkageConditionMet,
  LINKAGE_FILTERABLE_BLOCKED_WHEN,
  LINKAGE_MULTIPLE_DEFAULT_VALUE,
} from '../knowledge/catalogPolicy.js'

export type SanitizedPatch = {
  patch: Record<string, unknown>
  warnings: string[]
}

function applyLinkageBlocks(
  scope: string,
  patch: Record<string, unknown>,
  currentOptions: Record<string, unknown> | undefined,
  constraints: Record<string, OptionConstraint>,
): { patch: Record<string, unknown>; warnings: string[] } {
  if (!currentOptions) return { patch, warnings: [] }
  const warnings: string[] = []
  const next = { ...patch }
  for (const [key] of Object.entries(patch)) {
    const blockedWhen = constraints[key]?.linkageBlockedWhen
    if (!blockedWhen) continue
    const effective = { ...currentOptions, ...patch }
    if (linkageConditionMet(blockedWhen, effective)) {
      delete next[key]
      warnings.push(
        `${scope} 属性 ${key} 在 ${blockedWhen.key}=${JSON.stringify(effectiveOptionValue(blockedWhen.key, currentOptions, patch))} 时不可用（linkage），已忽略`,
      )
    }
  }
  return { patch: next, warnings }
}

function applyLinkageForces(
  scope: string,
  patch: Record<string, unknown>,
  currentOptions: Record<string, unknown> | undefined,
): { patch: Record<string, unknown>; warnings: string[] } {
  if (!currentOptions) return { patch, warnings: [] }
  const warnings: string[] = []
  const next = { ...patch }
  const effective = { ...currentOptions, ...patch }

  if (
    linkageConditionMet(LINKAGE_FILTERABLE_BLOCKED_WHEN, effective) &&
    patch.filterable === false
  ) {
    delete next.filterable
    warnings.push(`${scope} remote/allowCreate 启用时 filterable 必须为 true（linkage），已忽略 filterable=false`)
  }
  if (linkageConditionMet({ key: 'allowCreate', truthy: true }, effective) && patch.filterable === false) {
    delete next.filterable
    warnings.push(`${scope} allowCreate=true 时 filterable 必须为 true（linkage），已忽略 filterable=false`)
  }

  const { multipleKey, valueKey } = LINKAGE_MULTIPLE_DEFAULT_VALUE
  if (valueKey in patch) {
    const multiple = effective[multipleKey] === true
    const value = patch[valueKey]
    if (multiple && value !== null && value !== undefined && value !== '' && !Array.isArray(value)) {
      delete next[valueKey]
      warnings.push(`${scope} multiple=true 时 defaultValue 必须为数组（linkage），已忽略标量 defaultValue`)
    }
    if (!multiple && Array.isArray(value)) {
      delete next[valueKey]
      warnings.push(`${scope} multiple=false 时 defaultValue 不能为数组（linkage），已忽略数组 defaultValue`)
    }
  }

  return { patch: next, warnings }
}

const OPTION_VALUE_CHOICE_TYPES = new Set(['radio', 'select', 'checkbox'])

export function widgetSupportsOptionValueType(type: string): boolean {
  return OPTION_VALUE_CHOICE_TYPES.has(type)
}

/**
 * 对齐设计器 option-items-setting.handelValueTypeChange：
 * 写入 optionValueType 后转换 optionItems.value，并清空不兼容 defaultValue。
 */
export function reconcileOptionValueType(
  options: Record<string, unknown>,
  scope: string,
): string[] {
  const valueType = options.optionValueType
  if (valueType !== 'String' && valueType !== 'Number' && valueType !== 'Boolean') return []
  const items = options.optionItems
  if (!Array.isArray(items)) return []

  const warnings: string[] = []
  const multiple =
    options.multiple === true ||
    (typeof scope === 'string' && scope === 'checkbox')

  if (multiple) {
    options.defaultValue = []
  } else {
    options.defaultValue = ''
  }

  options.optionItems = items.map((raw, idx) => {
    if (!raw || typeof raw !== 'object') return raw
    const opt = { ...(raw as Record<string, unknown>) }
    const optValue = `${opt.value ?? ''}`
    if (valueType === 'String') {
      opt.value = optValue
    } else if (valueType === 'Number') {
      if (!Number.isNaN(Number(optValue)) && optValue.trim() !== '') {
        opt.value = Number(optValue)
      } else {
        opt.value = idx + 1
      }
    } else if (valueType === 'Boolean') {
      const lower = optValue.toLowerCase()
      opt.value = lower === 'true' || optValue === '1'
    }
    return opt
  })
  warnings.push(`${scope} 已按 optionValueType=${valueType} 转换 optionItems.value 并重置 defaultValue`)
  return warnings
}

/** merge 后修正 multiple/defaultValue 不兼容（模拟 propertyMixin.onMultipleSelected） */
export function reconcileMultipleDefaultValue(
  options: Record<string, unknown>,
  scope: string,
): string[] {
  const warnings: string[] = []
  const dv = options.defaultValue
  if (options.multiple === true) {
    if (dv !== undefined && dv !== null && dv !== '' && !Array.isArray(dv)) {
      options.defaultValue = []
      warnings.push(`${scope} multiple=true 已清空不兼容的标量 defaultValue（linkage）`)
    }
  } else if (Array.isArray(dv) && dv.length > 0) {
    options.defaultValue = dv[0]
    warnings.push(`${scope} multiple=false 已将数组 defaultValue 收敛为首项（linkage）`)
  } else if (Array.isArray(dv)) {
    options.defaultValue = ''
    warnings.push(`${scope} multiple=false 已清空数组 defaultValue（linkage）`)
  }
  if (linkageConditionMet(LINKAGE_FILTERABLE_BLOCKED_WHEN, options) && options.filterable === false) {
    options.filterable = true
    warnings.push(`${scope} remote=true 已强制 filterable=true（linkage）`)
  }
  if (linkageConditionMet({ key: 'allowCreate', truthy: true }, options) && options.filterable === false) {
    options.filterable = true
    warnings.push(`${scope} allowCreate=true 已强制 filterable=true（linkage）`)
  }
  return warnings
}

function sanitizeRecord(
  scope: string,
  patch: Record<string, unknown>,
  writableKeys: string[],
  applicableKeys: string[] | undefined,
  forbiddenKeys: string[],
  constraints: Record<string, OptionConstraint>,
  currentOptions?: Record<string, unknown>,
): SanitizedPatch {
  const linkage = applyLinkageBlocks(scope, patch, currentOptions, constraints)
  const forced = applyLinkageForces(scope, linkage.patch, currentOptions)
  const warnings: string[] = [...linkage.warnings, ...forced.warnings]
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(forced.patch)) {
    if (forbiddenKeys.includes(key)) {
      warnings.push(`${scope} 禁写键已忽略: ${key}`)
      continue
    }
    if (!writableKeys.includes(key)) {
      warnings.push(`${scope} 未知键已忽略: ${key}`)
      continue
    }
    if (applicableKeys && !applicableKeys.includes(key)) {
      warnings.push(`${scope} 属性 ${key} 对该 type 不可用（hasConfig），已忽略`)
      continue
    }
    if (!valueMatchesConstraint(constraints[key], value)) {
      warnings.push(`${scope} 类型或枚举不匹配已忽略: ${key}`)
      continue
    }
    next[key] = value
  }
  return { patch: next, warnings }
}

export function sanitizeWidgetPatch(
  type: string,
  patch: Record<string, unknown>,
  catalog: WidgetCatalog = getWidgetCatalog(),
  currentOptions?: Record<string, unknown>,
): SanitizedPatch {
  const entry = catalog.widgets.find((w) => w.type === type)
  if (!entry) {
    return { patch: {}, warnings: [`未知组件类型，已忽略属性 patch: ${type}`] }
  }
  return sanitizeRecord(
    type,
    patch,
    entry.writableKeys,
    entry.applicableKeys,
    entry.forbiddenKeys,
    entry.constraints,
    currentOptions,
  )
}

export function sanitizeFormPatch(
  patch: Record<string, unknown>,
  catalog: WidgetCatalog = getWidgetCatalog(),
): SanitizedPatch {
  return sanitizeRecord(
    'formConfig',
    patch,
    catalog.form.writableKeys,
    undefined,
    catalog.form.forbiddenKeys,
    catalog.form.constraints,
  )
}
