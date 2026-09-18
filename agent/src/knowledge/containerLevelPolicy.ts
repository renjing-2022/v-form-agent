import type { WidgetCatalog } from './widgetCatalog.js'
import { isEventKey } from './catalogPolicy.js'

/**
 * 容器级属性（非 form-item field）登记矩阵。
 * 与 widgetsConfig containers[].options 对齐；不含 event 键。
 */
export const CONTAINER_LEVEL_PROPERTY_MATRIX: Record<string, readonly string[]> = {
  grid: ['name', 'hidden', 'gutter', 'colHeight', 'customClass'],
  'grid-col': ['name', 'hidden', 'span', 'offset', 'push', 'pull', 'responsive', 'md', 'sm', 'xs', 'customClass'],
  tab: ['name', 'tabType', 'tabPosition', 'hidden', 'customClass'],
  'tab-pane': ['name', 'label', 'hidden', 'active', 'disabled', 'customClass'],
  table: ['name', 'hidden', 'customClass'],
  'table-cell': ['name', 'cellWidth', 'cellHeight', 'colspan', 'rowspan', 'wordBreak', 'customClass'],
  'sub-form': [
    'name',
    'label',
    'showBlankRow',
    'showRowNumber',
    'labelAlign',
    'hidden',
    'disabled',
    'actionColumnPosition',
    'customClass',
  ],
  'grid-sub-form': [
    'name',
    'label',
    'showBlankRow',
    'showRowNumber',
    'hidden',
    'disabled',
    'actionColumnPosition',
    'appendButtonAtBottom',
    'deleteButtonHidden',
    'customClass',
  ],
  'data-table': [
    'name',
    'label',
    'hidden',
    'rowSpacing',
    'tableHeight',
    'tableWidth',
    'customClass',
    'stripe',
    'showIndex',
    'showCheckBox',
    'showPagination',
    'paginationAlign',
    'smallPagination',
    'showSummary',
    'border',
    'tableSize',
    'autoColumnWidthDisabled',
    'columnWordWrap',
    'tableColumns',
    'showButtonsColumn',
    'buttonsColumnFixed',
    'buttonsColumnTitle',
    'buttonsColumnWidth',
    'operationButtons',
    'pagination',
    'dsEnabled',
    'dsName',
    'dataSetName',
    'treeDataEnabled',
    'rowKey',
    'childrenKey',
    'tableData',
  ],
  tree: [
    'name',
    'label',
    'filter',
    'draggable',
    'defaultExpandAllNode',
    'selectClearAllNode',
    'expandRetractAllNode',
    'showCheckBox',
    'expandOnClickNode',
    'lazy',
    'treeDataEdit',
    'checkStrictly',
    'nodeEdit',
    'size',
    'disabled',
    'hidden',
    'dsEnabled',
    'dsName',
    'dataSetName',
    'customClass',
    'treeData',
  ],
  'button-group': ['name', 'size', 'hidden', 'disabled', 'customClass', 'buttons'],
  'object-group': ['name', 'objectName', 'hidden', 'customClass'],
  'vf-dialog': [
    'name',
    'title',
    'width',
    'fullscreen',
    'showModal',
    'showClose',
    'closeOnClickModal',
    'closeOnPressEscape',
    'center',
    'readMode',
    'disabledMode',
    'okButtonLabel',
    'okButtonHidden',
    'cancelButtonLabel',
    'cancelButtonHidden',
  ],
  'vf-drawer': [
    'name',
    'title',
    'size',
    'showModal',
    'showClose',
    'closeOnClickModal',
    'closeOnPressEscape',
    'direction',
    'readMode',
    'disabledMode',
    'okButtonLabel',
    'okButtonHidden',
    'cancelButtonLabel',
    'cancelButtonHidden',
  ],
}

export function containerLevelKeysForType(type: string, applicableKeys: string[]): string[] {
  const matrix = CONTAINER_LEVEL_PROPERTY_MATRIX[type]
  if (matrix) return [...matrix]
  return applicableKeys.filter((key) => !isEventKey(key))
}

export function checkContainerLevelPropertyParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const containers = catalog.widgets.filter((w) => w.category === 'container')

  for (const widget of containers) {
    const expected = CONTAINER_LEVEL_PROPERTY_MATRIX[widget.type]
    if (!expected) {
      issues.push(`container type "${widget.type}" missing CONTAINER_LEVEL_PROPERTY_MATRIX`)
      continue
    }
    if (!widget.containerLevelKeys?.length) {
      issues.push(`${widget.type} missing containerLevelKeys`)
      continue
    }
    const actual = widget.containerLevelKeys
    const missing = expected.filter((key) => !actual.includes(key))
    const extra = actual.filter((key) => !expected.includes(key))
    if (missing.length) {
      issues.push(`${widget.type} containerLevelKeys missing: ${missing.join(', ')}`)
    }
    if (extra.length) {
      issues.push(`${widget.type} containerLevelKeys extra: ${extra.join(', ')}`)
    }
    for (const key of expected) {
      if (!widget.applicableKeys?.includes(key)) {
        issues.push(`${widget.type}.${key} in container matrix but not applicableKeys`)
      }
      if (!widget.constraints[key]) {
        issues.push(`${widget.type}.${key} missing constraint`)
      }
    }
  }

  for (const type of Object.keys(CONTAINER_LEVEL_PROPERTY_MATRIX)) {
    if (!containers.some((w) => w.type === type)) {
      issues.push(`CONTAINER_LEVEL_PROPERTY_MATRIX type missing from catalog containers: ${type}`)
    }
  }

  if (containers.length !== Object.keys(CONTAINER_LEVEL_PROPERTY_MATRIX).length) {
    issues.push(
      `container level matrix count ${Object.keys(CONTAINER_LEVEL_PROPERTY_MATRIX).length} != catalog containers ${containers.length}`,
    )
  }

  return issues
}
