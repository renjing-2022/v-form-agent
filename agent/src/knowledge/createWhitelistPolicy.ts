import type { FieldType } from '../schemas/fieldPlan.js'
import type { WidgetCatalog } from './widgetCatalog.js'

/**
 * v0.11 普通字段创建白名单（Catalog 子集）。
 * 上传 / 重型容器 / 扩展仍为 NON_GOAL（见 CREATE_NON_GOAL）。
 */
export const FIELD_CREATE_WHITELIST = [
  'input',
  'textarea',
  'number',
  'radio',
  'checkbox',
  'select',
  'cascader',
  'date',
  'date-range',
  'time',
  'time-range',
  'switch',
  'rate',
  'color',
  'slider',
  'static-text',
  'html-text',
  'button',
  'divider',
  'rich-editor',
] as const satisfies readonly FieldType[]

/**
 * refine 可新建的结构容器（须有实际 create op）。
 * v0.11：移除 grid/grid-col——白名单曾声明可建但无专用 op（仅 wrapInTabs 覆盖 tab/tab-pane）。
 */
export const CONTAINER_CREATE_WHITELIST = ['tab', 'tab-pane'] as const

export type ContainerCreateType = (typeof CONTAINER_CREATE_WHITELIST)[number]

/** refine addField / wrapInTabs / createWidget 等新建节点允许的全集 */
export const REFINE_CREATE_WHITELIST = [
  ...FIELD_CREATE_WHITELIST,
  ...CONTAINER_CREATE_WHITELIST,
] as const

export type RefineCreateType = (typeof REFINE_CREATE_WHITELIST)[number]

/** generate 组装后 validate 允许的 widget type */
export const WIDGET_WHITELIST: Array<FieldType | ContainerCreateType> = [
  ...FIELD_CREATE_WHITELIST,
  ...CONTAINER_CREATE_WHITELIST,
]

/** @deprecated 使用 FIELD_CREATE_WHITELIST；保留别名避免大范围重命名 */
export const FIELD_WHITELIST: FieldType[] = [...FIELD_CREATE_WHITELIST]

export type CreateNonGoalReason =
  | 'heavy-structure'
  | 'advanced-field'
  | 'internal-container'
  | 'dialog-shell'
  | 'extension-runtime'
  | 'structure-no-create-op'

/**
 * Catalog 中存在、但 generate/refine **不得新建** 的 type 及原因。
 * 与 REFINE_CREATE_WHITELIST 互斥；Catalog 每个 type 必须落在二者之一。
 */
export const CREATE_NON_GOAL: Record<string, CreateNonGoalReason> = {
  'button-group': 'heavy-structure',
  'data-table': 'heavy-structure',
  'sub-form': 'heavy-structure',
  'grid-sub-form': 'heavy-structure',
  'object-group': 'heavy-structure',
  tree: 'heavy-structure',
  'vf-dialog': 'dialog-shell',
  'vf-drawer': 'dialog-shell',
  /** 栅格无专用 create op；既有节点仍可 updateField / structure surgery */
  grid: 'structure-no-create-op',
  table: 'internal-container',
  'table-cell': 'internal-container',
  'grid-col': 'internal-container',
  slot: 'extension-runtime',
  /** 上传与远程数据源延后至 v0.12 */
  'file-upload': 'advanced-field',
  'picture-upload': 'advanced-field',
}

export const CREATE_NON_GOAL_REASON_LABEL: Record<CreateNonGoalReason, string> = {
  'heavy-structure': '重型容器/结构，本版 refine 仅支持 tab 结构手术（wrapInTabs）',
  'advanced-field': '上传/远程类字段本版未开放 NL 新建（可 refine 既有控件属性）',
  'internal-container': '内部节点，须由父容器结构生成，不得独立 NL 新建',
  'dialog-shell': '弹窗/抽屉壳层，本版不开放 NL 新建',
  'extension-runtime': '扩展/插槽类，运行时注册不在静态 create 范围',
  'structure-no-create-op': '结构类型无专用 create op；可更新既有节点，不得 NL 新建',
}

/** REFINE_CREATE_WHITELIST ⊆ Catalog 且 Catalog \ whitelist = REGISTERED NON_GOAL */
export function checkCreateWhitelistCatalogParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const catalogTypes = new Set(catalog.widgets.map((w) => w.type))
  const allowed = new Set<string>(REFINE_CREATE_WHITELIST)

  for (const type of REFINE_CREATE_WHITELIST) {
    if (!catalogTypes.has(type)) {
      issues.push(`REFINE_CREATE_WHITELIST type "${type}" missing from Catalog`)
    }
  }

  for (const type of catalogTypes) {
    if (allowed.has(type)) continue
    if (!CREATE_NON_GOAL[type]) {
      issues.push(
        `Catalog type "${type}" must be in REFINE_CREATE_WHITELIST or CREATE_NON_GOAL (undeclared NON_GOAL)`,
      )
    }
  }

  for (const type of Object.keys(CREATE_NON_GOAL)) {
    if (!catalogTypes.has(type)) {
      issues.push(`CREATE_NON_GOAL declares "${type}" but type not in Catalog`)
    }
    if (allowed.has(type)) {
      issues.push(`CREATE_NON_GOAL "${type}" overlaps REFINE_CREATE_WHITELIST`)
    }
  }

  return issues
}

/** widgetsConfig 编译入口 unique types 必须与 Catalog.types 一一对应（不得静默缺 type） */
export function compareWidgetsConfigTypesWithCatalog(
  widgetsConfigTypes: string[],
  catalog: WidgetCatalog,
): string[] {
  const issues: string[] = []
  const wc = new Set(widgetsConfigTypes)
  const cat = new Set(catalog.widgets.map((w) => w.type))
  for (const t of wc) {
    if (!cat.has(t)) issues.push(`widgetsConfig unique type "${t}" missing from Catalog`)
  }
  for (const t of cat) {
    if (!wc.has(t)) issues.push(`Catalog type "${t}" missing from widgetsConfig unique types`)
  }
  return issues
}

export function isCreateAllowedType(type: string): type is RefineCreateType {
  return (REFINE_CREATE_WHITELIST as readonly string[]).includes(type)
}

export function createNonGoalReason(type: string): CreateNonGoalReason | undefined {
  return CREATE_NON_GOAL[type]
}

export function createRejectMessageForType(type: string): string {
  const reason = CREATE_NON_GOAL[type]
  if (reason) {
    return `type "${type}" 不在本版新建白名单：${CREATE_NON_GOAL_REASON_LABEL[reason]}`
  }
  return `type "${type}" 不在 refine create whitelist`
}
