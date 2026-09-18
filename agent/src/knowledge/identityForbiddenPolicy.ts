import type { OptionConstraint, WidgetCatalog } from './widgetCatalog.js'
import { isEventKey } from './catalogPolicy.js'

export type ForbiddenReason = 'event' | 'internal-binding' | 'runtime-data' | 'policy'

export type CatalogIdentityRule = {
  id: 'widget-id' | 'field-name'
  path: string
  unique: true
  scope: 'form-tree'
  note: string
}

/** 整表 widget 树 identity 规则（name/id 唯一） */
export const CATALOG_IDENTITY_RULES: CatalogIdentityRule[] = [
  {
    id: 'widget-id',
    path: 'id',
    unique: true,
    scope: 'form-tree',
    note: 'widget.id 在整表 widget 树内唯一；用于 target 定位、公式 {{id}} 引用',
  },
  {
    id: 'field-name',
    path: 'options.name',
    unique: true,
    scope: 'form-tree',
    note: 'options.name 在整表 widget 树内唯一；用于按 name 定位与公式引用',
  },
]

const FORM_INTERNAL_BINDING = new Set([
  'modelName',
  'refName',
  'rulesName',
  'jsonVersion',
])

const FORM_RUNTIME_DATA = new Set(['functions', 'dataSources'])

const WIDGET_POLICY_FORBIDDEN = new Set(['customRule', 'dsEnabled', 'dsName', 'dataSetName', 'remote'])

export function forbiddenReasonFor(key: string, scope: 'widget' | 'form'): ForbiddenReason | undefined {
  if (isEventKey(key)) return 'event'
  if (scope === 'form') {
    if (FORM_RUNTIME_DATA.has(key)) return 'runtime-data'
    if (FORM_INTERNAL_BINDING.has(key)) return 'internal-binding'
    return undefined
  }
  if (WIDGET_POLICY_FORBIDDEN.has(key)) return 'policy'
  return undefined
}

function minimalForbiddenConstraint(key: string, reason: ForbiddenReason): OptionConstraint {
  return {
    valueType: 'string',
    nullable: false,
    valueKind: 'string',
    source: reason === 'event' ? 'property-editor' : 'widgets-config',
    writable: false,
    forbiddenReason: reason,
  }
}

export function applyIdentityForbiddenConstraints(
  scope: 'widget' | 'form',
  constraints: Record<string, OptionConstraint>,
  forbiddenKeys: readonly string[],
  writableKeys: readonly string[],
): Record<string, OptionConstraint> {
  const next: Record<string, OptionConstraint> = { ...constraints }

  for (const key of forbiddenKeys) {
    const reason = forbiddenReasonFor(key, scope)
    if (!reason) continue
    const existing = next[key]
    next[key] = {
      ...(existing || minimalForbiddenConstraint(key, reason)),
      writable: false,
      forbiddenReason: reason,
    }
  }

  for (const key of writableKeys) {
    if (forbiddenKeys.includes(key)) continue
    if (!next[key]) continue
    next[key] = {
      ...next[key],
      writable: true,
      ...(next[key].identityRole ? {} : {}),
    }
    if (scope === 'widget' && key === 'name') {
      next[key] = { ...next[key], identityRole: 'field-name', writable: true }
    }
  }

  return next
}

export function checkIdentityForbiddenParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []

  if (!catalog.identity?.rules?.length) {
    issues.push('catalog.identity.rules missing')
  } else {
    for (const expected of CATALOG_IDENTITY_RULES) {
      const actual = catalog.identity.rules.find((r) => r.id === expected.id)
      if (!actual) {
        issues.push(`catalog.identity missing rule: ${expected.id}`)
      } else if (!actual.unique || actual.scope !== 'form-tree') {
        issues.push(`catalog.identity rule invalid: ${expected.id}`)
      }
    }
  }

  for (const widget of catalog.widgets) {
    for (const key of widget.forbiddenKeys) {
      const reason = forbiddenReasonFor(key, 'widget')
      if (!reason) {
        issues.push(`${widget.type}.${key} forbidden without registered reason`)
        continue
      }
      const constraint = widget.constraints[key]
      if (!constraint) {
        issues.push(`${widget.type}.${key} forbidden but missing visible constraint`)
        continue
      }
      if (constraint.writable !== false) {
        issues.push(`${widget.type}.${key} forbidden constraint must set writable=false`)
      }
      if (constraint.forbiddenReason !== reason) {
        issues.push(`${widget.type}.${key} forbiddenReason expected ${reason} got ${constraint.forbiddenReason}`)
      }
    }
    if (widget.applicableKeys?.includes('name')) {
      const name = widget.constraints.name
      if (!name?.identityRole) {
        issues.push(`${widget.type}.name missing identityRole=field-name`)
      }
      if (name?.writable !== true) {
        issues.push(`${widget.type}.name must remain writable`)
      }
    }
    const eventKeys = widget.forbiddenKeys.filter((k) => isEventKey(k))
    if (widget.applicableKeys?.some((k) => isEventKey(k)) && eventKeys.length === 0) {
      issues.push(`${widget.type} has event keys in applicableKeys but none in forbiddenKeys`)
    }
  }

  for (const key of catalog.form.forbiddenKeys) {
    const reason = forbiddenReasonFor(key, 'form')
    if (!reason) {
      issues.push(`form.${key} forbidden without registered reason`)
      continue
    }
    const constraint = catalog.form.constraints[key]
    if (!constraint) {
      issues.push(`form.${key} forbidden but missing visible constraint`)
      continue
    }
    if (constraint.writable !== false) {
      issues.push(`form.${key} forbidden constraint must set writable=false`)
    }
    if (constraint.forbiddenReason !== reason) {
      issues.push(`form.${key} forbiddenReason expected ${reason} got ${constraint.forbiddenReason}`)
    }
  }

  const input = catalog.widgets.find((w) => w.type === 'input')
  if (!input?.constraints.onChange || input.constraints.onChange.writable !== false) {
    issues.push('input.onChange must be visible forbidden event key')
  }
  if (catalog.form.constraints.modelName?.forbiddenReason !== 'internal-binding') {
    issues.push('form.modelName must be internal-binding forbidden')
  }

  return issues
}
