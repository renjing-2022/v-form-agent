import type { TargetRef } from '../schemas/refinePlan.js'
import { COMPOSITE_SCHEMA_BY_PROP } from '../knowledge/compositeSchemaPolicy.js'
import { findWidgetLocation, type WidgetNode } from './structureRefine.js'

export type ColumnRef = {
  columnId?: number
  prop?: string
  label?: string
}

export type FlatColumnSpec = {
  prop: string
  label: string
  width?: string
  show?: boolean
  align?: string
  fixed?: string
  sortable?: boolean
}

export type ColumnPosition =
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'before'; sibling: ColumnRef }
  | { kind: 'after'; sibling: ColumnRef }

const FLAT_COLUMN_KEYS = new Set([
  'columnId',
  'prop',
  'label',
  'width',
  'show',
  'align',
  'fixed',
  'sortable',
])

export type TableColumn = Record<string, unknown> & {
  columnId?: number
  prop?: string
  label?: string
  children?: TableColumn[]
  headerFlag?: boolean
  render?: unknown
}

export function getTableColumns(widget: WidgetNode): TableColumn[] | null {
  const cols = widget.options?.tableColumns
  if (!Array.isArray(cols)) return null
  return cols as TableColumn[]
}

/** 任一项含非空 children 或 headerFlag===true → 本版拒绝全部列 op */
export function tableHasNestedHeader(columns: TableColumn[]): boolean {
  for (const col of columns) {
    if (col.headerFlag === true) return true
    if (Array.isArray(col.children) && col.children.length > 0) return true
  }
  return false
}

export function nextColumnId(columns: TableColumn[]): number {
  let max = 0
  for (const col of columns) {
    const id = typeof col.columnId === 'number' ? col.columnId : 0
    if (id > max) max = id
  }
  return max + 1
}

function findColumnIndexes(columns: TableColumn[], ref: ColumnRef): number[] {
  const matches: number[] = []
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    if (ref.columnId !== undefined) {
      if (col.columnId === ref.columnId) matches.push(i)
      continue
    }
    if (ref.prop !== undefined) {
      if (col.prop === ref.prop) matches.push(i)
      continue
    }
    if (ref.label !== undefined && col.label === ref.label) {
      matches.push(i)
    }
  }
  return matches
}

export function resolveColumnIndex(
  columns: TableColumn[],
  ref: ColumnRef,
): { index: number } | { error: string } {
  if (ref.columnId === undefined && !ref.prop && !ref.label) {
    return { error: 'column 定位需要 columnId / prop / label 之一' }
  }
  const prioritized: ColumnRef =
    ref.columnId !== undefined
      ? { columnId: ref.columnId }
      : ref.prop
        ? { prop: ref.prop }
        : { label: ref.label }
  const matches = findColumnIndexes(columns, prioritized)
  if (matches.length === 0) {
    return { error: `未找到列 ${ref.columnId ?? ref.prop ?? ref.label ?? ''}` }
  }
  if (matches.length > 1) {
    return { error: `列定位歧义：${ref.prop || ref.label} 匹配 ${matches.length} 列` }
  }
  return { index: matches[0] }
}

function sanitizeFlatColumn(
  input: Record<string, unknown>,
  requireIdentity: boolean,
): { column: FlatColumnSpec & { columnId?: number }; warnings: string[] } | { error: string } {
  const warnings: string[] = []
  if ('children' in input || 'headerFlag' in input || 'render' in input) {
    return { error: '扁平列禁止 children / headerFlag / render' }
  }
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!FLAT_COLUMN_KEYS.has(key)) {
      warnings.push(`列字段 ${key} 不在扁平列白名单，已忽略`)
      continue
    }
    next[key] = value
  }
  if (requireIdentity) {
    if (typeof next.prop !== 'string' || !String(next.prop).trim()) {
      return { error: '新增列必须提供非空 prop' }
    }
    if (typeof next.label !== 'string' || !String(next.label).trim()) {
      return { error: '新增列必须提供非空 label' }
    }
  }
  const schema = COMPOSITE_SCHEMA_BY_PROP.tableColumns
  if (schema?.requiredItemKeys && requireIdentity) {
    for (const key of schema.requiredItemKeys) {
      if (key === 'columnId') continue
      if (!(key in next)) return { error: `列缺少必填键 ${key}` }
    }
  }
  return {
    column: next as FlatColumnSpec & { columnId?: number },
    warnings,
  }
}

export type TableColumnOpResult = { ok: true; warnings: string[] } | { ok: false; warnings: string[] }

function locateDataTable(
  root: WidgetNode[],
  table: TargetRef,
): { widget: WidgetNode; columns: TableColumn[] } | { error: string } {
  const loc = findWidgetLocation(root, table)
  if (!loc) {
    return { error: `未找到 data-table ${table.id || table.name || table.label || ''}` }
  }
  if (loc.widget.type !== 'data-table') {
    return { error: `目标不是 data-table（实际 type=${loc.widget.type || ''}）` }
  }
  const columns = getTableColumns(loc.widget)
  if (!columns) {
    return { error: 'data-table 缺少 options.tableColumns 数组' }
  }
  if (tableHasNestedHeader(columns)) {
    return { error: '含多级表头（children/headerFlag），本版不支持列手术' }
  }
  return { widget: loc.widget, columns }
}

export function resolveColumnInsertIndex(
  columns: TableColumn[],
  position: ColumnPosition | undefined,
): number | { error: string } {
  if (!position || position.kind === 'last') return columns.length
  if (position.kind === 'first') return 0
  const resolved = resolveColumnIndex(columns, position.sibling)
  if ('error' in resolved) return { error: resolved.error }
  if (position.kind === 'before') return resolved.index
  return resolved.index + 1
}

export function applyAddTableColumn(
  root: WidgetNode[],
  table: TargetRef,
  columnInput: Record<string, unknown>,
  position: ColumnPosition | undefined,
): TableColumnOpResult {
  const located = locateDataTable(root, table)
  if ('error' in located) {
    return { ok: false, warnings: [`addTableColumn ${located.error}`] }
  }
  const sanitized = sanitizeFlatColumn(columnInput, true)
  if ('error' in sanitized) {
    return { ok: false, warnings: [`addTableColumn ${sanitized.error}`] }
  }
  const insertAt = resolveColumnInsertIndex(located.columns, position)
  if (typeof insertAt !== 'number') {
    return { ok: false, warnings: [`addTableColumn ${insertAt.error}`] }
  }
  const warnings = [...sanitized.warnings]
  const columnId = nextColumnId(located.columns)
  const newCol: TableColumn = {
    ...sanitized.column,
    columnId,
    show: sanitized.column.show ?? true,
  }
  located.columns.splice(insertAt, 0, newCol)
  warnings.push(`addTableColumn 已新增列 columnId=${columnId} prop=${newCol.prop}`)
  return { ok: true, warnings }
}

export function applyRemoveTableColumn(
  root: WidgetNode[],
  table: TargetRef,
  column: ColumnRef,
): TableColumnOpResult {
  const located = locateDataTable(root, table)
  if ('error' in located) {
    return { ok: false, warnings: [`removeTableColumn ${located.error}`] }
  }
  const resolved = resolveColumnIndex(located.columns, column)
  if ('error' in resolved) {
    return { ok: false, warnings: [`removeTableColumn ${resolved.error}`] }
  }
  const [removed] = located.columns.splice(resolved.index, 1)
  return {
    ok: true,
    warnings: [`removeTableColumn 已删除列 columnId=${removed?.columnId} prop=${removed?.prop}`],
  }
}

export function applyReorderTableColumn(
  root: WidgetNode[],
  table: TargetRef,
  column: ColumnRef,
  position: ColumnPosition,
): TableColumnOpResult {
  const located = locateDataTable(root, table)
  if ('error' in located) {
    return { ok: false, warnings: [`reorderTableColumn ${located.error}`] }
  }
  const resolved = resolveColumnIndex(located.columns, column)
  if ('error' in resolved) {
    return { ok: false, warnings: [`reorderTableColumn ${resolved.error}`] }
  }
  const insertAt = resolveColumnInsertIndex(located.columns, position)
  if (typeof insertAt !== 'number') {
    return { ok: false, warnings: [`reorderTableColumn ${insertAt.error}`] }
  }
  const from = resolved.index
  let dest = insertAt
  if (dest > from) dest -= 1
  if (dest < 0 || dest >= located.columns.length) {
    return { ok: false, warnings: ['reorderTableColumn 目标位置越界'] }
  }
  if (dest === from) {
    return { ok: true, warnings: ['reorderTableColumn 顺序未变化'] }
  }
  const [item] = located.columns.splice(from, 1)
  located.columns.splice(dest, 0, item)
  return { ok: true, warnings: [`reorderTableColumn 已调整列顺序 prop=${item.prop}`] }
}

export function applyUpdateTableColumn(
  root: WidgetNode[],
  table: TargetRef,
  column: ColumnRef,
  patch: Record<string, unknown>,
): TableColumnOpResult {
  const located = locateDataTable(root, table)
  if ('error' in located) {
    return { ok: false, warnings: [`updateTableColumn ${located.error}`] }
  }
  const resolved = resolveColumnIndex(located.columns, column)
  if ('error' in resolved) {
    return { ok: false, warnings: [`updateTableColumn ${resolved.error}`] }
  }
  const sanitized = sanitizeFlatColumn(patch, false)
  if ('error' in sanitized) {
    return { ok: false, warnings: [`updateTableColumn ${sanitized.error}`] }
  }
  const warnings = [...sanitized.warnings]
  const entries = Object.entries(sanitized.column).filter(([k]) => k !== 'columnId')
  if (entries.length === 0) {
    return { ok: false, warnings: ['updateTableColumn 无可应用列字段'] }
  }
  const target = located.columns[resolved.index]
  for (const [key, value] of entries) {
    target[key] = value
  }
  warnings.push(`updateTableColumn 已更新列 prop=${target.prop}`)
  return { ok: true, warnings }
}

/** updateField 不得整段替换 tableColumns */
export function stripTableColumnsFromPatch(
  type: string,
  patch: Record<string, unknown>,
): { patch: Record<string, unknown>; warnings: string[] } {
  if (type !== 'data-table' || !('tableColumns' in patch)) {
    return { patch, warnings: [] }
  }
  const next = { ...patch }
  delete next.tableColumns
  return {
    patch: next,
    warnings: ['data-table.tableColumns 禁止经 updateField 整段替换；请使用列级专用 op'],
  }
}
