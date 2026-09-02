/** Catalog 可写/禁写与结构策略。事件与脚本不得因出现在 options 中就被开放。 */

export const WIDGETS_CONFIG_REL = 'v-form/src/components/form-designer/widget-panel/widgetsConfig.js'
export const FORM_CONFIG_REL = 'v-form/src/utils/util.js'
export const CATALOG_JSON_REL = 'agent/src/knowledge/generated/widget-catalog.json'

export const STRUCTURE_SURGERY_SUPPORTED = new Set(['tab', 'tab-pane', 'grid', 'grid-col'])

export const HEAVY_STRUCTURE_TYPES = new Set([
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

const FORM_FORBIDDEN_KEYS = new Set([
  'modelName',
  'refName',
  'rulesName',
  'jsonVersion',
  'functions',
  'dataSources',
  'onFormCreated',
  'onFormMounted',
  'onFormDataChange',
  'onFormValidate',
])

const WIDGET_FORBIDDEN_KEYS = new Set([
  'customRule',
  'dsEnabled',
  'dsName',
  'dataSetName',
  'remote',
])

const ENUMS_BY_TYPE: Record<string, Record<string, Array<string | number | boolean>>> = {
  tab: {
    tabType: ['card', 'border-card'],
    tabPosition: ['top', 'right', 'bottom', 'left'],
  },
  radio: { displayStyle: ['inline', 'block'] },
  checkbox: { displayStyle: ['inline', 'block'] },
  button: { displayStyle: ['inline', 'block'] },
  divider: {
    direction: ['horizontal', 'vertical'],
    contentPosition: ['left', 'center', 'right'],
  },
  number: { controlsPosition: ['', 'right'] },
  'data-table': {
    tableSize: ['large', 'default', 'small'],
    paginationAlign: ['left', 'center', 'right'],
  },
  'sub-form': { actionColumnPosition: ['left', 'right'] },
  'grid-sub-form': { actionColumnPosition: ['left', 'right'] },
  'vf-drawer': { direction: ['ltr', 'rtl', 'ttb', 'btt'] },
}

const FORM_ENUMS: Record<string, Array<string | number | boolean>> = {
  labelPosition: ['left', 'right', 'top'],
  labelAlign: ['label-left-align', 'label-center-align', 'label-right-align'],
  layoutType: ['PC', 'H5', 'Pad'],
  size: ['', 'large', 'default', 'small'],
}

export function isEventKey(key: string): boolean {
  return /^on[A-Z]/.test(key)
}

export function isForbiddenWidgetKey(key: string): boolean {
  return isEventKey(key) || WIDGET_FORBIDDEN_KEYS.has(key)
}

export function isForbiddenFormKey(key: string): boolean {
  return isEventKey(key) || FORM_FORBIDDEN_KEYS.has(key)
}

export function classifyKeys(keys: string[], kind: 'widget' | 'form'): { writable: string[]; forbidden: string[] } {
  const forbidden: string[] = []
  const writable: string[] = []
  const predicate = kind === 'form' ? isForbiddenFormKey : isForbiddenWidgetKey
  for (const key of [...keys].sort()) {
    if (predicate(key)) forbidden.push(key)
    else writable.push(key)
  }
  return { writable, forbidden }
}

export function enumFor(type: string, key: string): Array<string | number | boolean> | undefined {
  return ENUMS_BY_TYPE[type]?.[key]
}

export function formEnumFor(key: string): Array<string | number | boolean> | undefined {
  return FORM_ENUMS[key]
}

export function structureSurgeryFor(type: string): 'supported' | 'unsupported' {
  if (STRUCTURE_SURGERY_SUPPORTED.has(type)) return 'supported'
  if (HEAVY_STRUCTURE_TYPES.has(type)) return 'unsupported'
  return 'unsupported'
}

export function detectChildCollections(schema: Record<string, unknown>): Array<{
  key: string
  shape: 'list' | 'matrix'
  allowedTypes: string[]
}> {
  const collections: Array<{ key: string; shape: 'list' | 'matrix'; allowedTypes: string[] }> = []
  const type = String(schema.type || '')
  if (Array.isArray(schema.cols)) {
    collections.push({ key: 'cols', shape: 'list', allowedTypes: type === 'grid' ? ['grid-col'] : [] })
  }
  if (Array.isArray(schema.tabs)) {
    collections.push({ key: 'tabs', shape: 'list', allowedTypes: ['tab-pane'] })
  }
  if (Array.isArray(schema.rows)) {
    collections.push({ key: 'rows', shape: 'matrix', allowedTypes: type === 'table' ? ['table-cell'] : [] })
  }
  if (Array.isArray(schema.widgetList)) {
    collections.push({ key: 'widgetList', shape: 'list', allowedTypes: [] })
  }
  return collections
}
