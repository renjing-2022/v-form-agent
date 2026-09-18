import { getWidgetCatalog } from './widgetCatalogStore.js'
import type { WidgetCatalog, WidgetCatalogEntry } from './widgetCatalog.js'

export type WidgetDefaultSchema = {
  type: string
  icon: string
  formItemFlag: boolean
  category: WidgetCatalogEntry['category']
  defaultOptions: Record<string, unknown>
}

function mergeVariantDefaultOptions(entry: WidgetCatalogEntry): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const variant of entry.variants) {
    Object.assign(merged, variant.defaultOptions)
  }
  return merged
}

/** 从 Catalog（widgetsConfig 编译产物）读取控件出厂 defaultOptions + 元数据 */
export function getWidgetDefaultSchema(
  type: string,
  catalog = getWidgetCatalog(),
): WidgetDefaultSchema | null {
  const entry = catalog.widgets.find((w) => w.type === type)
  if (!entry || entry.variants.length === 0) return null
  const primary = entry.variants[0]
  return {
    type: entry.type,
    icon: primary.icon || entry.type,
    formItemFlag: entry.formItem,
    category: entry.category,
    defaultOptions: structuredClone(mergeVariantDefaultOptions(entry)),
  }
}

export function cloneCatalogDefaultOptions(type: string, catalog = getWidgetCatalog()): Record<string, unknown> {
  const schema = getWidgetDefaultSchema(type, catalog)
  if (!schema) {
    throw new Error(`Catalog 中不存在 type="${type}" 的 widgetsConfig 默认 options`)
  }
  return structuredClone(schema.defaultOptions)
}

export function buildWidgetFromCatalogDefaults(
  type: string,
  params: {
    id: string
    name: string
    label?: string
    optionOverrides?: Record<string, unknown>
    widgetList?: Record<string, unknown>[]
    tabs?: Record<string, unknown>[]
  },
  catalog = getWidgetCatalog(),
): Record<string, unknown> {
  const schema = getWidgetDefaultSchema(type, catalog)
  if (!schema) {
    throw new Error(`无法从 Catalog 克隆新建节点: type="${type}" 不在 widgetsConfig`)
  }
  const options: Record<string, unknown> = {
    ...structuredClone(schema.defaultOptions),
    name: params.name,
    ...(params.label !== undefined ? { label: params.label } : {}),
    ...(params.optionOverrides || {}),
  }
  const node: Record<string, unknown> = {
    type: schema.type,
    icon: schema.icon,
    formItemFlag: schema.formItemFlag,
    options,
    id: params.id,
  }
  if (schema.category === 'container') {
    node.category = schema.category
  }
  if (params.widgetList) node.widgetList = params.widgetList
  if (params.tabs) node.tabs = params.tabs
  return node
}

/** refine/generate 新建白名单 type 均须在 Catalog 中有 defaultOptions */
export function assertCreateTypesHaveCatalogDefaults(
  types: readonly string[],
  catalog = getWidgetCatalog(),
): string[] {
  const missing: string[] = []
  for (const type of types) {
    if (!getWidgetDefaultSchema(type, catalog)) missing.push(type)
  }
  return missing
}
