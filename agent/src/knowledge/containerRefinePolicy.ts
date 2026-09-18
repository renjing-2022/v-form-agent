import type { WidgetCatalog } from './widgetCatalog.js'
import { STRUCTURE_SURGERY_SUPPORTED } from './catalogPolicy.js'

/** v0.4 允许 NL refine 容器属性的 type → 白名单键（Catalog writable 子集） */
export const CONTAINER_REFINE_PROPERTY_MATRIX: Record<string, readonly string[]> = {
  'tab-pane': ['label', 'active', 'hidden', 'disabled', 'name', 'customClass'],
  'grid-col': ['span', 'offset', 'push', 'pull', 'responsive', 'md', 'sm', 'xs', 'hidden', 'name', 'customClass'],
  tab: ['name', 'hidden', 'tabType', 'tabPosition', 'customClass'],
  grid: ['name', 'hidden', 'gutter', 'colHeight', 'customClass'],
}

export type ContainerPropertyRefineNonGoalReason =
  | 'heavy-structure'
  | 'dialog-shell'
  | 'internal-container'

export const CONTAINER_PROPERTY_REFINE_NON_GOAL: Record<
  string,
  { reason: ContainerPropertyRefineNonGoalReason; message: string }
> = {
  'button-group': {
    reason: 'heavy-structure',
    message: 'button-group 容器属性本版未开放 NL refine（仅 tab/grid 结构手术内）',
  },
  'data-table': {
    reason: 'heavy-structure',
    message: 'data-table 容器属性本版未开放 NL refine',
  },
  'grid-sub-form': {
    reason: 'heavy-structure',
    message: 'grid-sub-form 容器属性本版未开放 NL refine',
  },
  'object-group': {
    reason: 'heavy-structure',
    message: 'object-group 容器属性本版未开放 NL refine',
  },
  'sub-form': {
    reason: 'heavy-structure',
    message: 'sub-form 容器属性本版未开放 NL refine',
  },
  tree: {
    reason: 'heavy-structure',
    message: 'tree 容器属性本版未开放 NL refine',
  },
  table: {
    reason: 'internal-container',
    message: 'table 为表格内部结构，容器属性须由 table 结构生成',
  },
  'table-cell': {
    reason: 'internal-container',
    message: 'table-cell 为表格内部节点，不支持直接 refine 容器属性',
  },
  'vf-dialog': {
    reason: 'dialog-shell',
    message: 'vf-dialog 弹窗壳层属性本版未开放 NL refine',
  },
  'vf-drawer': {
    reason: 'dialog-shell',
    message: 'vf-drawer 抽屉壳层属性本版未开放 NL refine',
  },
}

export const CONTAINER_PROPERTY_REFINE_NON_GOAL_REASON_LABEL: Record<
  ContainerPropertyRefineNonGoalReason,
  string
> = {
  'heavy-structure': '重型容器，本版仅 tab/tab-pane/grid/grid-col 开放容器属性 refine',
  'dialog-shell': '弹窗/抽屉壳层，本版不开放容器属性 refine',
  'internal-container': '表格内部节点，不支持直接 refine 容器属性',
}

export function isContainerRefineSupported(type: string): boolean {
  return STRUCTURE_SURGERY_SUPPORTED.has(type) && type in CONTAINER_REFINE_PROPERTY_MATRIX
}

export function containerRefineAllowedKeys(type: string): readonly string[] | undefined {
  return CONTAINER_REFINE_PROPERTY_MATRIX[type]
}

export function containerPropertyRefineNonGoal(type: string): string | undefined {
  return CONTAINER_PROPERTY_REFINE_NON_GOAL[type]?.message
}

/** 对容器节点 patch：不支持 type 整包拒绝；支持 type 仅保留矩阵内键 */
export function sanitizeContainerPropertyPatch(
  type: string,
  patch: Record<string, unknown>,
): { patch: Record<string, unknown>; warnings: string[]; rejected: boolean } {
  const nonGoal = containerPropertyRefineNonGoal(type)
  if (nonGoal) {
    return {
      patch: {},
      warnings: [`${type} 容器属性 refine 未开放: ${nonGoal}`],
      rejected: true,
    }
  }
  if (!isContainerRefineSupported(type)) {
    return { patch, warnings: [], rejected: false }
  }
  const allowed = new Set(containerRefineAllowedKeys(type) || [])
  const warnings: string[] = []
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) {
      next[key] = value
    } else {
      warnings.push(`${type} 容器属性 ${key} 不在 v0.4 refine 白名单，已忽略`)
    }
  }
  return { patch: next, warnings, rejected: false }
}

/** Catalog 中所有 container 必须落在 supported 或 NON_GOAL */
export function checkContainerRefinePolicyParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const containers = catalog.widgets.filter((w) => w.category === 'container')
  for (const widget of containers) {
    if (isContainerRefineSupported(widget.type)) continue
    if (CONTAINER_PROPERTY_REFINE_NON_GOAL[widget.type]) continue
    issues.push(`container type "${widget.type}" missing CONTAINER_PROPERTY_REFINE_NON_GOAL`)
  }
  for (const type of Object.keys(CONTAINER_REFINE_PROPERTY_MATRIX)) {
    if (!catalog.widgets.some((w) => w.type === type)) {
      issues.push(`CONTAINER_REFINE_PROPERTY_MATRIX type missing from catalog: ${type}`)
    }
  }
  for (const type of Object.keys(CONTAINER_PROPERTY_REFINE_NON_GOAL)) {
    if (!catalog.widgets.some((w) => w.type === type)) {
      issues.push(`CONTAINER_PROPERTY_REFINE_NON_GOAL type missing from catalog: ${type}`)
    }
  }
  const supported = containers.filter((w) => isContainerRefineSupported(w.type)).length
  const nonGoal = containers.filter((w) => CONTAINER_PROPERTY_REFINE_NON_GOAL[w.type]).length
  if (supported + nonGoal !== containers.length) {
    issues.push(`container refine partition incomplete: supported=${supported} nonGoal=${nonGoal} total=${containers.length}`)
  }
  return issues
}

export function createContainerRefineRejectMessage(type: string): string {
  const nonGoal = CONTAINER_PROPERTY_REFINE_NON_GOAL[type]
  if (nonGoal) return nonGoal.message
  if (isContainerRefineSupported(type)) return ''
  return `容器 type "${type}" 未登记 refine 策略`
}
