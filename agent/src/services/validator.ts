import {
  FIELD_WHITELIST,
  MAX_FIELDS,
  REFINE_CREATE_WHITELIST,
  WIDGET_WHITELIST,
} from '../knowledge/widgetWhitelist.js'

export type ValidationIssue = { path: string; message: string }

export type ValidateFormJsonOptions = {
  /** generate：仅允许 WIDGET_WHITELIST；refine：已有 id 可保留任意类型，新建必须在 REFINE_CREATE_WHITELIST */
  mode?: 'generate' | 'refine'
  /** refine 时传入优化前已存在的 widget id */
  existingIds?: Set<string>
}

type WidgetNode = Record<string, unknown>

function collectChildLists(widget: WidgetNode): Array<{ pathSuffix: string; list: unknown[] }> {
  const out: Array<{ pathSuffix: string; list: unknown[] }> = []
  if (Array.isArray(widget.widgetList)) {
    out.push({ pathSuffix: 'widgetList', list: widget.widgetList as unknown[] })
  }
  if (Array.isArray(widget.tabs)) {
    out.push({ pathSuffix: 'tabs', list: widget.tabs as unknown[] })
  }
  if (Array.isArray(widget.cols)) {
    const cols = widget.cols as WidgetNode[]
    cols.forEach((col, c) => {
      if (Array.isArray(col?.widgetList)) {
        out.push({ pathSuffix: `cols[${c}].widgetList`, list: col.widgetList as unknown[] })
      }
    })
  }
  if (Array.isArray(widget.rows)) {
    const rows = widget.rows as WidgetNode[]
    rows.forEach((row, r) => {
      const cells = (row?.cols || row?.cells || []) as WidgetNode[]
      if (Array.isArray(cells)) {
        cells.forEach((cell, c) => {
          if (Array.isArray(cell?.widgetList)) {
            out.push({
              pathSuffix: `rows[${r}].cols[${c}].widgetList`,
              list: cell.widgetList as unknown[],
            })
          }
        })
      }
    })
  }
  return out
}

function isAllowedType(
  type: string,
  id: string | undefined,
  mode: 'generate' | 'refine',
  existingIds?: Set<string>,
): boolean {
  if (mode === 'generate') {
    return WIDGET_WHITELIST.includes(type as (typeof WIDGET_WHITELIST)[number])
  }
  if (id && existingIds?.has(id)) {
    return true
  }
  return REFINE_CREATE_WHITELIST.includes(type as (typeof REFINE_CREATE_WHITELIST)[number])
}

function validateContainerShape(type: string, widget: WidgetNode, path: string, issues: ValidationIssue[]) {
  if (type === 'tab') {
    if (!Array.isArray(widget.tabs)) {
      issues.push({ path: `${path}.tabs`, message: 'tab requires tabs array' })
    } else {
      for (let i = 0; i < widget.tabs.length; i++) {
        const pane = (widget.tabs as WidgetNode[])[i]
        if (!pane || pane.type !== 'tab-pane') {
          issues.push({ path: `${path}.tabs[${i}].type`, message: 'tab.tabs items must be tab-pane' })
        }
        if (!Array.isArray(pane?.widgetList)) {
          issues.push({ path: `${path}.tabs[${i}].widgetList`, message: 'tab-pane requires widgetList' })
        }
      }
    }
  }
  if (type === 'grid' && !Array.isArray(widget.cols)) {
    issues.push({ path: `${path}.cols`, message: 'grid requires cols array' })
  }
  if (type === 'grid-col' && !Array.isArray(widget.widgetList)) {
    issues.push({ path: `${path}.widgetList`, message: 'grid-col requires widgetList' })
  }
}

function validateFormula(
  type: string,
  options: Record<string, unknown>,
  path: string,
  knownNames: Set<string>,
  issues: ValidationIssue[],
) {
  if (!options.formulaEnabled) return
  if (type !== 'number') {
    issues.push({ path: `${path}.options.formulaEnabled`, message: 'formula only supported on number fields' })
    return
  }
  const formula = typeof options.formula === 'string' ? options.formula.trim() : ''
  if (!formula) {
    issues.push({ path: `${path}.options.formula`, message: 'formulaEnabled requires non-empty formula' })
    return
  }
  // 平台公式引用：{{id.[label].field}}；也允许先写 name 占位，合入阶段会编译
  const refs = [...formula.matchAll(/\{\{(\w+)\./g)].map((m) => m[1])
  for (const refId of refs) {
    // id 引用在合入后校验较难；此处仅做形态检查
    if (!refId) {
      issues.push({ path: `${path}.options.formula`, message: 'invalid formula field ref' })
    }
  }
  void knownNames
  void FIELD_WHITELIST
}

export function validateFormJson(
  formJson: unknown,
  opts: ValidateFormJsonOptions = {},
): ValidationIssue[] {
  const mode = opts.mode || 'generate'
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
    if (depth > 8) {
      issues.push({ path, message: 'widget nesting too deep' })
      return
    }
    for (let i = 0; i < widgets.length; i++) {
      const w = widgets[i] as WidgetNode | null
      const p = `${path}[${i}]`
      if (!w || typeof w !== 'object') {
        issues.push({ path: p, message: 'invalid widget' })
        continue
      }
      const type = String(w.type || '')
      const id = typeof w.id === 'string' ? w.id : undefined
      if (!isAllowedType(type, id, mode, opts.existingIds)) {
        issues.push({
          path: `${p}.type`,
          message:
            mode === 'refine'
              ? `new type "${type}" is not in refine create whitelist`
              : `type "${type}" is not in whitelist`,
        })
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

      validateContainerShape(type, w, p, issues)
      validateFormula(type, options, p, names, issues)

      for (const child of collectChildLists(w)) {
        walk(child.list, `${p}.${child.pathSuffix}`, depth + 1)
      }
    }
  }

  if (Array.isArray(json.widgetList)) {
    walk(json.widgetList as unknown[], 'widgetList', 0)
  }

  return issues
}

export function collectWidgetIds(formJson: { widgetList?: unknown[] }): Set<string> {
  const ids = new Set<string>()
  const walk = (widgets: unknown[]) => {
    for (const item of widgets) {
      const w = item as WidgetNode
      if (!w || typeof w !== 'object') continue
      if (typeof w.id === 'string' && w.id) ids.add(w.id)
      for (const child of collectChildLists(w)) {
        walk(child.list)
      }
    }
  }
  if (Array.isArray(formJson.widgetList)) walk(formJson.widgetList)
  return ids
}
