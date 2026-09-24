import type { FormJson } from '../schemas/refinePlan.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import { MAX_FIELDS } from '../knowledge/widgetWhitelist.js'

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
  'labelAlign',
  'displayStyle',
  'columnWidth',
  'required',
  'hidden',
  'customClass',
  'size',
]

const ON_DEMAND_SNAPSHOT_KEYS = ['optionItems', 'defaultValue', 'validation', 'optionValueType']

const MAX_DEPTH = 8

export { MAX_FIELDS as FORM_SUMMARY_MAX_FIELDS }

function inferOnDemandSnapshotKeys(instruction?: string): string[] {
  if (!instruction) return []
  const keys: string[] = []
  if (/选项值类型|optionValueType|数值类型/.test(instruction)) keys.push('optionValueType')
  if (/选项|optionItems|分值|单选|多选/.test(instruction)) keys.push('optionItems')
  if (/默认|defaultValue|默认值/.test(instruction)) keys.push('defaultValue')
  if (/校验|validation/.test(instruction)) keys.push('validation')
  return keys
}

function parentHint(widget: WidgetNode | undefined): FormFieldSummary['parent'] {
  if (!widget) return undefined
  const options = widget.options || {}
  return {
    type: widget.type,
    name: typeof options.name === 'string' ? options.name : undefined,
    label: typeof options.label === 'string' ? options.label : undefined,
  }
}

function snapshotFor(
  type: string,
  options: Record<string, unknown>,
  instruction?: string,
): Record<string, unknown> {
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === type)
  const allowed = new Set(entry?.writableKeys || SNAPSHOT_KEYS)
  const keys = [...SNAPSHOT_KEYS, ...inferOnDemandSnapshotKeys(instruction).filter((k) => ON_DEMAND_SNAPSHOT_KEYS.includes(k))]
  const out: Record<string, unknown> = {}
  for (const key of keys) {
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
  instruction?: string,
) {
  if (depth > MAX_DEPTH || out.length >= MAX_FIELDS) return
  for (let i = 0; i < widgets.length; i++) {
    if (out.length >= MAX_FIELDS) return
    const w = widgets[i]
    if (!w || typeof w !== 'object') continue
    const path = `${pathPrefix}[${i}]`
    const options = w.options || {}
    const type = typeof w.type === 'string' ? w.type : undefined
    const snap = type ? snapshotFor(type, options, instruction) : {}
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
    if (Array.isArray(w.widgetList)) walk(w.widgetList, `${path}.widgetList`, childParent, out, depth + 1, instruction)
    if (Array.isArray(w.tabs)) walk(w.tabs, `${path}.tabs`, childParent, out, depth + 1, instruction)
    if (Array.isArray(w.cols)) {
      w.cols.forEach((col, c) => {
        if (Array.isArray(col?.widgetList)) {
          walk(col.widgetList, `${path}.cols[${c}].widgetList`, childParent, out, depth + 1, instruction)
        }
      })
    }
    if (Array.isArray(w.rows)) {
      w.rows.forEach((row, r) => {
        const cells = (row?.cols || row?.cells || []) as WidgetNode[]
        cells.forEach((cell, c) => {
          if (Array.isArray(cell?.widgetList)) {
            walk(cell.widgetList, `${path}.rows[${r}].cols[${c}].widgetList`, childParent, out, depth + 1, instruction)
          }
        })
      })
    }
  }
}

export function buildFormSummary(formJson: FormJson, instruction?: string): FormFieldSummary[] {
  const out: FormFieldSummary[] = []
  walk((formJson.widgetList || []) as WidgetNode[], 'widgetList', undefined, out, 0, instruction)
  return out
}

export function indexFormFields(formJson: FormJson): FormFieldSummary[] {
  return buildFormSummary(formJson)
}
