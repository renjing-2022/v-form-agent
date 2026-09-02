import { getWidgetCatalog } from './widgetCatalogStore.js'
import type { WidgetCatalog } from './widgetCatalog.js'
import type { FormFieldSummary } from '../services/formSummary.js'

const MAX_TYPES = 12
const MAX_WRITABLE_PER_TYPE = 24

export function buildCatalogSnippets(
  fields: FormFieldSummary[],
  catalog: WidgetCatalog = getWidgetCatalog(),
): Array<{ type: string; writableKeys: string[]; forbiddenKeys: string[]; structureSurgery?: string }> {
  const types = [...new Set(fields.map((f) => f.type).filter(Boolean) as string[])].slice(0, MAX_TYPES)
  return types.map((type) => {
    const entry = catalog.widgets.find((w) => w.type === type)
    if (!entry) return { type, writableKeys: [], forbiddenKeys: [], structureSurgery: 'unknown' }
    return {
      type,
      writableKeys: entry.writableKeys.slice(0, MAX_WRITABLE_PER_TYPE),
      forbiddenKeys: entry.forbiddenKeys.slice(0, 12),
      structureSurgery: entry.notes?.structureSurgery,
    }
  })
}
