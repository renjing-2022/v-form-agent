import type { TargetRef } from '../schemas/refinePlan.js'

export type WidgetNode = Record<string, unknown> & {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: Array<{ cols?: WidgetNode[] }>
}

/**
 * 节点级 remove/reorder/duplicate 不支持的 widget type。
 * v0.6：sub-form 已放开（子字段 + 整块 remove）；data-table 仍拒绝节点级结构 op（走列级专用 op）。
 */
export const STRUCTURE_OP_NON_GOAL_TYPES = new Set([
  'table-cell',
  'table',
  'data-table',
  'grid-sub-form',
  'vf-dialog',
  'vf-drawer',
])

export type ReorderPosition =
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'before'; sibling: TargetRef }
  | { kind: 'after'; sibling: TargetRef }

export function structureOpNonGoalMessage(type: string): string | undefined {
  if (!STRUCTURE_OP_NON_GOAL_TYPES.has(type)) return undefined
  return `type "${type}" 不在本版 delete/reorder/duplicate 范围`
}

export function childLists(widget: WidgetNode): WidgetNode[][] {
  const lists: WidgetNode[][] = []
  if (Array.isArray(widget.widgetList)) lists.push(widget.widgetList)
  if (Array.isArray(widget.tabs)) lists.push(widget.tabs)
  if (Array.isArray(widget.cols)) lists.push(widget.cols)
  if (Array.isArray(widget.rows)) {
    for (const row of widget.rows) {
      if (Array.isArray(row.cols)) lists.push(row.cols)
    }
  }
  if (Array.isArray(widget.cols)) {
    for (const col of widget.cols) {
      if (Array.isArray(col.widgetList)) lists.push(col.widgetList)
    }
  }
  return lists
}

export function matchesTarget(widget: WidgetNode, target: TargetRef): boolean {
  if (target.containerType && widget.type !== target.containerType) return false
  if (target.id && widget.id === target.id) return true
  const options = widget.options || {}
  const name = typeof options.name === 'string' ? options.name : ''
  if (target.name && name === target.name) return true
  const label = typeof options.label === 'string' ? options.label : ''
  if (target.label && label === target.label) return true
  return false
}

export type WidgetLocation = {
  parentList: WidgetNode[]
  index: number
  widget: WidgetNode
}

export function findWidgetLocation(root: WidgetNode[], target: TargetRef): WidgetLocation | null {
  function walk(list: WidgetNode[]): WidgetLocation | null {
    for (let i = 0; i < list.length; i++) {
      const w = list[i]
      if (matchesTarget(w, target)) {
        return { parentList: list, index: i, widget: w }
      }
      for (const childList of childLists(w)) {
        const found = walk(childList)
        if (found) return found
      }
    }
    return null
  }
  return walk(root)
}

function collectAllIds(root: WidgetNode[], into = new Set<string>()) {
  for (const w of root) {
    if (typeof w.id === 'string' && w.id) into.add(w.id)
    for (const list of childLists(w)) collectAllIds(list, into)
  }
  return into
}

function collectAllNames(root: WidgetNode[], into = new Set<string>()) {
  for (const w of root) {
    const name = typeof w.options?.name === 'string' ? w.options.name : ''
    if (name) into.add(name)
    for (const list of childLists(w)) collectAllNames(list, into)
  }
  return into
}

function nextId(prefix: string, used: Set<string>) {
  let seq = used.size + 1
  let id = `${prefix}${seq}`
  while (used.has(id)) {
    seq += 1
    id = `${prefix}${seq}`
  }
  used.add(id)
  return id
}

function uniqueName(base: string, used: Set<string>) {
  let name = base
  let i = 1
  while (used.has(name)) name = `${base}_${i++}`
  used.add(name)
  return name
}

/** 对齐 designer.copyNewFieldWidget / copyNewContainerWidget：递归新 id/name */
export function regenerateWidgetIdentity(widget: WidgetNode, usedIds: Set<string>, usedNames: Set<string>): void {
  const type = String(widget.type || 'field')
  const idPrefix = type.replace(/-/g, '')
  widget.id = nextId(idPrefix, usedIds)

  widget.options = widget.options || {}
  const opts = widget.options
  if (opts.nameReadonly) {
    const label = typeof opts.label === 'string' ? opts.label : ''
    if (label.includes('.')) {
      opts.label = label.substring(label.indexOf('.') + 1)
    }
  } else {
    opts.name = widget.id
    if (!opts.label || typeof opts.label === 'string') {
      opts.label = typeof opts.label === 'string' && opts.label ? opts.label : type.toLowerCase()
    }
  }

  delete widget.displayName

  for (const list of childLists(widget)) {
    for (const child of list) {
      regenerateWidgetIdentity(child, usedIds, usedNames)
    }
  }
}

export function cloneWidgetWithNewIdentity(widget: WidgetNode, root: WidgetNode[]): WidgetNode {
  const clone = structuredClone(widget) as WidgetNode
  regenerateWidgetIdentity(clone, collectAllIds(root), collectAllNames(root))
  return clone
}

export function resolveInsertIndex(
  parentList: WidgetNode[],
  sourceIndex: number,
  position: ReorderPosition | undefined,
  root: WidgetNode[],
): number | null {
  if (!position) return sourceIndex + 1
  if (position.kind === 'first') return 0
  if (position.kind === 'last') return parentList.length - 1
  const siblingLoc = findWidgetLocation(root, position.sibling)
  if (!siblingLoc || siblingLoc.parentList !== parentList) return null
  if (position.kind === 'before') return siblingLoc.index
  return Math.min(siblingLoc.index + 1, parentList.length)
}

export function moveWithinSiblingList(
  parentList: WidgetNode[],
  fromIndex: number,
  toIndex: number,
): boolean {
  if (fromIndex === toIndex) return true
  if (fromIndex < 0 || fromIndex >= parentList.length) return false
  if (toIndex < 0 || toIndex >= parentList.length) return false
  const [item] = parentList.splice(fromIndex, 1)
  parentList.splice(toIndex, 0, item)
  return true
}

export function removeWidgetFromTree(root: WidgetNode[], target: TargetRef): WidgetNode | null {
  const loc = findWidgetLocation(root, target)
  if (!loc) return null
  const [removed] = loc.parentList.splice(loc.index, 1)
  return removed || null
}

export function countWidgets(root: WidgetNode[]): number {
  let n = 0
  for (const w of root) {
    n += 1
    for (const list of childLists(w)) n += countWidgets(list)
  }
  return n
}
