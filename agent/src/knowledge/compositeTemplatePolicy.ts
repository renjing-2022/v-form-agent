/**
 * v0.12 复合/内部/运行时扩展：版本化最小模板与 childSlots/requiredChildren 约束。
 * createKind=extension 对应任务中的 runtime-extension 分类。
 */
import type { WidgetCatalog } from './widgetCatalog.js'

/** extension ≡ 任务文档中的 runtime-extension */
export type CreateKind = 'standalone' | 'internal' | 'composite' | 'extension'

export const COMPOSITE_TEMPLATE_VERSION = 'v0.12.0'

/** 必须挂在固定父容器下的内部节点 */
export const INTERNAL_CREATE_TYPES = new Set(['grid-col', 'table-cell', 'tab-pane'])

/** 需要复杂子树 / 专用结构 op 的复合容器 */
export const COMPOSITE_CREATE_TYPES = new Set([
  'grid',
  'tab',
  'table',
  'sub-form',
  'grid-sub-form',
  'data-table',
  'tree',
  'button-group',
  'object-group',
  'vf-dialog',
  'vf-drawer',
])

/** 扩展/插槽边界（静态 Catalog 内；runtime-extension） */
export const EXTENSION_CREATE_TYPES = new Set(['slot'])

/** v0.12 任务组 2：已开放 create op 的重型/复合容器（含内部节点） */
export const HEAVY_CREATE_TYPES = [
  'sub-form',
  'grid-sub-form',
  'data-table',
  'tree',
  'button-group',
  'object-group',
  'vf-dialog',
  'vf-drawer',
  'table',
  'table-cell',
] as const

export type ChildSlotDef = {
  key: string
  allowedTypes: string[]
  minCount: number
  maxCount?: number
}

export type TemplateChildSpec = {
  type: string
  /** 写入父节点的哪个集合（cols/tabs/widgetList） */
  slot: string
  label?: string
  optionOverrides?: Record<string, unknown>
  children?: TemplateChildSpec[]
}

export type MatrixPreset = {
  rows: number
  cols: number
}

export type CompositeTemplate = {
  type: string
  templateVersion: string
  createKind: CreateKind
  requiredChildren: string[]
  childSlots: ChildSlotDef[]
  /** 单独 create 该 type 时展开的最小合法子树；internal 通常为空 */
  minPreset: TemplateChildSpec[]
  /** 覆盖 Catalog 出厂 options 的最小合法配置（列/树/按钮等） */
  optionPreset?: Record<string, unknown>
  /** table 矩阵最小模板：rows × cols 的 table-cell */
  matrixPreset?: MatrixPreset
}

const ROOTISH_PARENTS = ['root', 'tab-pane', 'grid-col'] as const

const MIN_DATA_TABLE_COLUMNS = [
  {
    columnId: 1,
    prop: 'col1',
    label: '列1',
    width: '120',
    show: true,
    align: 'left',
  },
  {
    columnId: 2,
    prop: 'col2',
    label: '列2',
    width: '120',
    show: true,
    align: 'left',
  },
]

const MIN_TREE_DATA = [
  {
    label: '节点1',
    children: [{ label: '节点1-1' }],
  },
]

const MIN_BUTTON_GROUP = [
  { name: 'btn_primary', label: '确定', icon: '', type: 'primary', round: false, hidden: false, disabled: false },
  { name: 'btn_cancel', label: '取消', icon: '', type: '', round: false, hidden: false, disabled: false },
]

/** 复合/内部/扩展创建模板真源（版本化） */
export const COMPOSITE_TEMPLATES: Readonly<Record<string, CompositeTemplate>> = {
  grid: {
    type: 'grid',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: ['grid-col'],
    childSlots: [{ key: 'cols', allowedTypes: ['grid-col'], minCount: 1, maxCount: 24 }],
    minPreset: [
      {
        type: 'grid-col',
        slot: 'cols',
        label: '列1',
        optionOverrides: { span: 12 },
      },
      {
        type: 'grid-col',
        slot: 'cols',
        label: '列2',
        optionOverrides: { span: 12 },
      },
    ],
  },
  'grid-col': {
    type: 'grid-col',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'internal',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
  },
  tab: {
    type: 'tab',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: ['tab-pane'],
    childSlots: [{ key: 'tabs', allowedTypes: ['tab-pane'], minCount: 1 }],
    minPreset: [
      {
        type: 'tab-pane',
        slot: 'tabs',
        label: '标签页1',
        optionOverrides: { active: true },
      },
    ],
  },
  'tab-pane': {
    type: 'tab-pane',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'internal',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
  },
  table: {
    type: 'table',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: ['table-cell'],
    childSlots: [{ key: 'rows', allowedTypes: ['table-cell'], minCount: 1 }],
    minPreset: [],
    matrixPreset: { rows: 2, cols: 2 },
  },
  'table-cell': {
    type: 'table-cell',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'internal',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
  },
  'sub-form': {
    type: 'sub-form',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [
      {
        type: 'input',
        slot: 'widgetList',
        label: '字段1',
      },
    ],
  },
  'grid-sub-form': {
    type: 'grid-sub-form',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [
      {
        type: 'input',
        slot: 'widgetList',
        label: '字段1',
      },
    ],
  },
  'data-table': {
    type: 'data-table',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
    optionPreset: {
      tableColumns: MIN_DATA_TABLE_COLUMNS,
      showPagination: true,
      pagination: {
        currentPage: 1,
        pageSize: 10,
        pageSizes: [10, 20, 50],
        total: 0,
      },
    },
  },
  tree: {
    type: 'tree',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
    optionPreset: {
      treeData: MIN_TREE_DATA,
      dsEnabled: false,
    },
  },
  'button-group': {
    type: 'button-group',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
    optionPreset: {
      buttons: MIN_BUTTON_GROUP,
    },
  },
  'object-group': {
    type: 'object-group',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
  },
  'vf-dialog': {
    type: 'vf-dialog',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
    optionPreset: {
      title: '对话框',
    },
  },
  'vf-drawer': {
    type: 'vf-drawer',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'composite',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
    optionPreset: {
      title: '抽屉',
    },
  },
  slot: {
    type: 'slot',
    templateVersion: COMPOSITE_TEMPLATE_VERSION,
    createKind: 'extension',
    requiredChildren: [],
    childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
    minPreset: [],
  },
}

export function getCompositeTemplate(type: string): CompositeTemplate | undefined {
  return COMPOSITE_TEMPLATES[type]
}

export function requiredChildrenFor(type: string): string[] {
  return [...(COMPOSITE_TEMPLATES[type]?.requiredChildren || [])]
}

export function childSlotsFor(type: string): ChildSlotDef[] {
  const tmpl = COMPOSITE_TEMPLATES[type]
  if (tmpl) return tmpl.childSlots.map((s) => ({ ...s, allowedTypes: [...s.allowedTypes] }))
  return []
}

/** 子节点应插入父节点的哪个集合 */
export function resolveChildSlotKey(parentType: string, childType: string): string | null {
  if (parentType === 'root') return 'widgetList'
  const slots = COMPOSITE_TEMPLATES[parentType]?.childSlots || []
  const exact = slots.find((s) => s.allowedTypes.includes(childType))
  if (exact) return exact.key
  const open = slots.find((s) => s.allowedTypes.length === 0 && s.key === 'widgetList')
  if (open) return open.key
  // Catalog structure 回退
  if (childType === 'grid-col' && parentType === 'grid') return 'cols'
  if (childType === 'tab-pane' && parentType === 'tab') return 'tabs'
  if (childType === 'table-cell' && parentType === 'table') return 'rows'
  if (slots.some((s) => s.key === 'widgetList')) return 'widgetList'
  return null
}

export function checkCompositeTemplateParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const catalogTypes = new Set(catalog.widgets.map((w) => w.type))

  for (const type of COMPOSITE_CREATE_TYPES) {
    if (!catalogTypes.has(type)) {
      issues.push(`COMPOSITE_CREATE_TYPES "${type}" missing from Catalog`)
      continue
    }
    const tmpl = COMPOSITE_TEMPLATES[type]
    if (!tmpl) {
      issues.push(`composite type "${type}" missing COMPOSITE_TEMPLATES entry`)
      continue
    }
    if (tmpl.templateVersion !== COMPOSITE_TEMPLATE_VERSION) {
      issues.push(`${type} templateVersion expected ${COMPOSITE_TEMPLATE_VERSION}`)
    }
    if (tmpl.createKind !== 'composite') {
      issues.push(`${type} template createKind must be composite`)
    }
  }

  for (const type of INTERNAL_CREATE_TYPES) {
    const tmpl = COMPOSITE_TEMPLATES[type]
    if (!tmpl) {
      issues.push(`internal type "${type}" missing COMPOSITE_TEMPLATES entry`)
      continue
    }
    if (tmpl.createKind !== 'internal') {
      issues.push(`${type} template createKind must be internal`)
    }
    if (tmpl.minPreset.length > 0) {
      issues.push(`${type} internal template must not expand minPreset on its own`)
    }
    if (tmpl.matrixPreset || tmpl.optionPreset) {
      issues.push(`${type} internal template must not declare matrix/option preset`)
    }
  }

  for (const type of EXTENSION_CREATE_TYPES) {
    const tmpl = COMPOSITE_TEMPLATES[type]
    if (!tmpl) {
      issues.push(`extension type "${type}" missing COMPOSITE_TEMPLATES entry`)
      continue
    }
    if (tmpl.createKind !== 'extension') {
      issues.push(`${type} template createKind must be extension (runtime-extension)`)
    }
  }

  for (const [type, tmpl] of Object.entries(COMPOSITE_TEMPLATES)) {
    if (!catalogTypes.has(type)) {
      issues.push(`COMPOSITE_TEMPLATES declares "${type}" not in Catalog`)
    }
    for (const child of tmpl.requiredChildren) {
      if (!catalogTypes.has(child)) {
        issues.push(`${type} requiredChildren unknown type "${child}"`)
      }
    }
    for (const slot of tmpl.childSlots) {
      if (!slot.key) issues.push(`${type} childSlot missing key`)
      if (slot.minCount < 0) issues.push(`${type} childSlot ${slot.key} minCount < 0`)
      for (const allowed of slot.allowedTypes) {
        if (!catalogTypes.has(allowed)) {
          issues.push(`${type} childSlot ${slot.key} unknown allowedType "${allowed}"`)
        }
      }
    }
    for (const preset of tmpl.minPreset) {
      if (!tmpl.childSlots.some((s) => s.key === preset.slot)) {
        issues.push(`${type} minPreset slot "${preset.slot}" not in childSlots`)
      }
      if (
        tmpl.childSlots.find((s) => s.key === preset.slot)?.allowedTypes.length &&
        !tmpl.childSlots.find((s) => s.key === preset.slot)!.allowedTypes.includes(preset.type)
      ) {
        issues.push(`${type} minPreset type "${preset.type}" not allowed in slot "${preset.slot}"`)
      }
    }
    if (tmpl.minPreset.length > 0) {
      for (const required of tmpl.requiredChildren) {
        if (!tmpl.minPreset.some((p) => p.type === required) && !tmpl.matrixPreset) {
          issues.push(`${type} minPreset missing requiredChild "${required}"`)
        }
      }
      for (const slot of tmpl.childSlots) {
        if (slot.key === 'rows' && tmpl.matrixPreset) continue
        const count = tmpl.minPreset.filter((p) => p.slot === slot.key).length
        if (count < slot.minCount && count > 0) {
          // open widgetList minCount=0；有预设时校验
        } else if (slot.minCount > 0 && count < slot.minCount && !tmpl.matrixPreset) {
          issues.push(`${type} minPreset slot "${slot.key}" count ${count} < minCount ${slot.minCount}`)
        }
      }
    }
    if (tmpl.matrixPreset) {
      if (tmpl.matrixPreset.rows < 1 || tmpl.matrixPreset.cols < 1) {
        issues.push(`${type} matrixPreset rows/cols must be >= 1`)
      }
      if (!tmpl.requiredChildren.includes('table-cell')) {
        issues.push(`${type} matrixPreset requires requiredChildren to include table-cell`)
      }
    }
  }

  // 关键重型 create 均须有模板
  for (const type of HEAVY_CREATE_TYPES) {
    if (!COMPOSITE_TEMPLATES[type]) {
      issues.push(`HEAVY_CREATE_TYPES "${type}" missing COMPOSITE_TEMPLATES`)
    }
  }

  // grid / table 最小模板必须可独立创建
  const grid = COMPOSITE_TEMPLATES.grid
  if (!grid || grid.minPreset.length < 1) {
    issues.push('grid minPreset must include at least one grid-col')
  }
  const table = COMPOSITE_TEMPLATES.table
  if (!table?.matrixPreset) {
    issues.push('table must declare matrixPreset for min legal subtree')
  }

  void ROOTISH_PARENTS
  return issues
}
