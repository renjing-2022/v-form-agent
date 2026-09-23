import { HEAVY_STRUCTURE_TYPES, isEventKey } from '../knowledge/catalogPolicy.js'
import { isInterfaceEventKey, isAllowedEventWriteKey } from '../knowledge/eventAllowlist.js'
import { valueMatchesConstraint } from '../knowledge/widgetCatalog.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import { validateCssCode } from './cssGuard.js'
import type { ValidationIssue } from './validator.js'

export type CatalogValidateMode = 'strict' | 'event-apply'

export function validateWidgetOptionsAgainstCatalog(
  type: string,
  options: Record<string, unknown>,
  path: string,
  mode: CatalogValidateMode = 'strict',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === type)
  if (!entry) return issues

  for (const [key, value] of Object.entries(options)) {
    if (isEventKey(key)) {
      if (typeof value === 'string' && value.trim()) {
        if (mode === 'event-apply' && isAllowedEventWriteKey(key) && !isInterfaceEventKey(key)) {
          continue
        }
        issues.push({
          path: `${path}.options.${key}`,
          message: `forbidden option "${key}" must remain empty`,
        })
      }
      continue
    }
    if (entry.forbiddenKeys.includes(key)) {
      if (key === 'customRule' && typeof value === 'string' && value.trim()) {
        issues.push({ path: `${path}.options.${key}`, message: `forbidden option "${key}" must remain empty` })
      }
      continue
    }
    if (!entry.constraints[key]) continue
    if (!valueMatchesConstraint(entry.constraints[key], value)) {
      issues.push({
        path: `${path}.options.${key}`,
        message: `option "${key}" value does not match catalog constraint`,
      })
    }
  }
  return issues
}

export function validateFormConfigAgainstCatalog(
  formConfig: Record<string, unknown>,
  mode: CatalogValidateMode = 'strict',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const catalog = getWidgetCatalog()
  for (const [key, value] of Object.entries(formConfig)) {
    if (isEventKey(key) || key === 'functions') {
      if (typeof value === 'string' && value.trim()) {
        if (mode === 'event-apply' && isAllowedEventWriteKey(key) && !isInterfaceEventKey(key)) {
          continue
        }
        issues.push({ path: `formConfig.${key}`, message: `forbidden formConfig key "${key}" must remain empty` })
      }
      continue
    }
    if (key === 'cssCode' && typeof value === 'string' && value.trim()) {
      const guard = validateCssCode(value)
      if (!guard.ok) {
        issues.push({ path: 'formConfig.cssCode', message: guard.message || 'cssCode failed safety guard' })
      }
    }
    const constraint = catalog.form.constraints[key]
    if (constraint && catalog.form.writableKeys.includes(key) && !valueMatchesConstraint(constraint, value)) {
      issues.push({ path: `formConfig.${key}`, message: `formConfig "${key}" value does not match catalog constraint` })
    }
  }
  return issues
}

export function isHeavyStructureType(type: string): boolean {
  return HEAVY_STRUCTURE_TYPES.has(type)
}
