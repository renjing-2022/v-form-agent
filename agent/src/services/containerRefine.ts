import type { TargetRef } from '../schemas/refinePlan.js'
import {
  containerPropertyRefineNonGoal,
  isContainerRefineSupported,
  sanitizeContainerPropertyPatch,
} from '../knowledge/containerRefinePolicy.js'

type WidgetNode = Record<string, unknown> & {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
}

function childLists(widget: WidgetNode): WidgetNode[][] {
  const lists: WidgetNode[][] = []
  if (Array.isArray(widget.widgetList)) lists.push(widget.widgetList)
  if (Array.isArray(widget.tabs)) lists.push(widget.tabs)
  if (Array.isArray(widget.cols)) lists.push(widget.cols)
  if (Array.isArray(widget.cols)) {
    for (const col of widget.cols) {
      if (Array.isArray(col.widgetList)) lists.push(col.widgetList)
    }
  }
  return lists
}

export function matchesTargetWithContainerType(widget: WidgetNode, target: TargetRef): boolean {
  if (target.containerType && widget.type !== target.containerType) return false
  if (target.id && widget.id === target.id) return true
  const options = widget.options || {}
  const name = typeof options.name === 'string' ? options.name : ''
  if (target.name && name === target.name) return true
  const label = typeof options.label === 'string' ? options.label : ''
  if (target.label && label === target.label) return true
  return false
}

export function findWidgetByTarget(root: WidgetNode[], target: TargetRef): WidgetNode | null {
  for (const w of root) {
    if (matchesTargetWithContainerType(w, target)) return w
    for (const list of childLists(w)) {
      const found = findWidgetByTarget(list, target)
      if (found) return found
    }
  }
  return null
}

function findParentTab(root: WidgetNode[], pane: WidgetNode): WidgetNode | null {
  for (const w of root) {
    if (w.type === 'tab' && Array.isArray(w.tabs) && w.tabs.some((t) => t === pane || t.id === pane.id)) {
      return w
    }
    for (const list of childLists(w)) {
      const found = findParentTab(list, pane)
      if (found) return found
    }
  }
  return null
}

/** tab-pane active=true 时，同 tab 下其余 pane 置 false（对齐设计器单选行为） */
export function reconcileTabPaneActive(
  root: WidgetNode[],
  pane: WidgetNode,
  warnings: string[],
): void {
  if (pane.type !== 'tab-pane' || pane.options?.active !== true) return
  const parentTab = findParentTab(root, pane)
  if (!parentTab || !Array.isArray(parentTab.tabs)) return
  for (const sibling of parentTab.tabs) {
    if (sibling === pane || !sibling?.options) continue
    if (sibling.options.active === true) {
      sibling.options.active = false
      warnings.push(`tab-pane ${sibling.id || sibling.options.name || sibling.options.label} active 已关闭（linkage）`)
    }
  }
}

export function preSanitizeContainerPatch(
  type: string,
  patch: Record<string, unknown>,
): { patch: Record<string, unknown>; warnings: string[]; blocked: boolean } {
  if (!type || isContainerRefineSupported(type) || containerPropertyRefineNonGoal(type)) {
    const result = sanitizeContainerPropertyPatch(type, patch)
    return { patch: result.patch, warnings: result.warnings, blocked: result.rejected }
  }
  return { patch, warnings: [], blocked: false }
}
