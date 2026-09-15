import { valueMatchesConstraint, type OptionConstraint, type WidgetCatalog } from '../knowledge/widgetCatalog.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'

export type SanitizedPatch = {
  patch: Record<string, unknown>
  warnings: string[]
}

function sanitizeRecord(
  scope: string,
  patch: Record<string, unknown>,
  writableKeys: string[],
  forbiddenKeys: string[],
  constraints: Record<string, OptionConstraint>,
): SanitizedPatch {
  const warnings: string[] = []
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (forbiddenKeys.includes(key)) {
      warnings.push(`${scope} 禁写键已忽略: ${key}`)
      continue
    }
    if (!writableKeys.includes(key)) {
      warnings.push(`${scope} 未知键已忽略: ${key}`)
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
): SanitizedPatch {
  const entry = catalog.widgets.find((w) => w.type === type)
  if (!entry) {
    return { patch: {}, warnings: [`未知组件类型，已忽略属性 patch: ${type}`] }
  }
  return sanitizeRecord(type, patch, entry.writableKeys, entry.forbiddenKeys, entry.constraints)
}

export function sanitizeFormPatch(
  patch: Record<string, unknown>,
  catalog: WidgetCatalog = getWidgetCatalog(),
): SanitizedPatch {
  return sanitizeRecord('formConfig', patch, catalog.form.writableKeys, catalog.form.forbiddenKeys, catalog.form.constraints)
}
