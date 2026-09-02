import type { FormJson } from '../schemas/refinePlan.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'

export type FormFieldSummary = {
  id?: string
  name?: string
  label?: string
  type?: string
  path: string
  parent?: { type?: string; name?: string; label?: string }
  writableSnapshot?: Record<string, unknown>
}

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: Array<WidgetNode & { cells?: WidgetNode[] }>
}

const SNAPSHOT_KEYS = [
  'placeholder',
  'labelWidth',
  'labelWrap',
  'labelHidden',
  'displayStyle',
  'columnWidth',
  'required',
  'hidden',
  'customClass',
  'size',
]

const MAX_FIELDS = 80
const MAX_DEPTH = 8

function parentHint(widget: WidgetNode | undefined): FormFieldSummary['parent'] {
  if (!widget) return undefined
  const options = widget.options || {}
  return {
    type: widget.type,
    name: typeof options.name === 'string' ? options.name : undefined,
    label: typeof options.label === 'string' ? options.label : undefined,
  }
}

function snapshotFor(type: string, options: Record<string, unknown>): Record<string, unknown> {
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === type)
  const allowed = new Set(entry?.writableKeys || SNAPSHOT_KEYS)
  const out: Record<string, unknown> = {}
  for (const key of SNAPSHOT_KEYS) {
    if (!allowed.has(key)) continue
    if (options[key] !== undefined) out[key] = options[key]
  }
  return out
}

function walk(
  widgets: WidgetNode[],
  pathPrefix: string,
  parent: WidgetNode | undefined,
  out: FormFieldSummary[],
  depth: number,
) {
  if (depth > MAX_DEPTH || out.length >= MAX_FIELDS) return
  for (let i = 0; i < widgets.length; i++) {
    if (out.length >= MAX_FIELDS) return
    const w = widgets[i]
    if (!w || typeof w !== 'object') continue
    const path = `${pathPrefix}[${i}]`
    const options = w.options || {}
    const type = typeof w.type === 'string' ? w.type : undefined
    const snap = type ? snapshotFor(type, options) : {}
    out.push({
      id: typeof w.id === 'string' ? w.id : undefined,
      name: typeof options.name === 'string' ? options.name : undefined,
      label: typeof options.label === 'string' ? options.label : undefined,
      type,
      path,
      parent: parentHint(parent),
      writableSnapshot: Object.keys(snap).length ? snap : undefined,
    })
    const childParent = w
    if (Array.isArray(w.widgetList)) walk(w.widgetList, `${path}.widgetList`, childParent, out, depth + 1)
    if (Array.isArray(w.tabs)) walk(w.tabs, `${path}.tabs`, childParent, out, depth + 1)
    if (Array.isArray(w.cols)) {
      w.cols.forEach((col, c) => {
        if (Array.isArray(col?.widgetList)) {
          walk(col.widgetList, `${path}.cols[${c}].widgetList`, childParent, out, depth + 1)
        }
      })
    }
    if (Array.isArray(w.rows)) {
      w.rows.forEach((row, r) => {
        const cells = (row?.cols || row?.cells || []) as WidgetNode[]
        cells.forEach((cell, c) => {
          if (Array.isArray(cell?.widgetList)) {
            walk(cell.widgetList, `${path}.rows[${r}].cols[${c}].widgetList`, childParent, out, depth + 1)
          }
        })
      })
    }
  }
}

export function buildFormSummary(formJson: FormJson): FormFieldSummary[] {
  const out: FormFieldSummary[] = []
  walk((formJson.widgetList || []) as WidgetNode[], 'widgetList', undefined, out, 0)
  return out
}

export function indexFormFields(formJson: FormJson): FormFieldSummary[] {
  return buildFormSummary(formJson)
}
