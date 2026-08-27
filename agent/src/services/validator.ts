import { WIDGET_WHITELIST, MAX_FIELDS } from '../knowledge/widgetWhitelist.js'

export type ValidationIssue = { path: string; message: string }

export function validateFormJson(formJson: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!formJson || typeof formJson !== 'object') {
    return [{ path: '', message: 'formJson must be an object' }]
  }

  const json = formJson as Record<string, unknown>
  if (!Array.isArray(json.widgetList)) {
    issues.push({ path: 'widgetList', message: 'widgetList must be an array' })
  }
  if (!json.formConfig || typeof json.formConfig !== 'object') {
    issues.push({ path: 'formConfig', message: 'formConfig must be an object' })
  }

  const names = new Set<string>()
  let fieldCount = 0

  const walk = (widgets: unknown[], path: string, depth: number) => {
    if (depth > 6) {
      issues.push({ path, message: 'widget nesting too deep' })
      return
    }
    for (let i = 0; i < widgets.length; i++) {
      const w = widgets[i] as Record<string, unknown> | null
      const p = `${path}[${i}]`
      if (!w || typeof w !== 'object') {
        issues.push({ path: p, message: 'invalid widget' })
        continue
      }
      const type = String(w.type || '')
      if (!WIDGET_WHITELIST.includes(type as (typeof WIDGET_WHITELIST)[number])) {
        issues.push({ path: `${p}.type`, message: `type "${type}" is not in whitelist` })
      }
      fieldCount += 1
      if (fieldCount > MAX_FIELDS) {
        issues.push({ path: p, message: `field count exceeds ${MAX_FIELDS}` })
        return
      }

      const options = (w.options || {}) as Record<string, unknown>
      const name = typeof options.name === 'string' ? options.name : ''
      if (name) {
        if (names.has(name)) {
          issues.push({ path: `${p}.options.name`, message: `duplicate name "${name}"` })
        }
        names.add(name)
      }

      if (type === 'radio' || type === 'select') {
        const items = options.optionItems
        if (!Array.isArray(items) || items.length === 0) {
          issues.push({ path: `${p}.options.optionItems`, message: `${type} requires optionItems` })
        }
      }

      if (Array.isArray(w.widgetList)) {
        walk(w.widgetList as unknown[], `${p}.widgetList`, depth + 1)
      }
      if (Array.isArray(w.cols)) {
        for (let c = 0; c < (w.cols as unknown[]).length; c++) {
          const col = (w.cols as Record<string, unknown>[])[c]
          if (Array.isArray(col?.widgetList)) {
            walk(col.widgetList as unknown[], `${p}.cols[${c}].widgetList`, depth + 1)
          }
        }
      }
    }
  }

  if (Array.isArray(json.widgetList)) {
    walk(json.widgetList as unknown[], 'widgetList', 0)
  }

  return issues
}
