import fs from 'node:fs'
import { CATALOG_JSON_REL } from './catalogPolicy.js'
import { catalogJsonPath, generateWidgetCatalog } from './generateWidgetCatalog.js'
import { diffWidgetCatalog, parseWidgetCatalog, type WidgetCatalog } from './widgetCatalog.js'

export function loadCommittedWidgetCatalog(root: string): WidgetCatalog {
  const raw = fs.readFileSync(catalogJsonPath(root), 'utf8')
  return parseWidgetCatalog(JSON.parse(raw))
}

export async function checkWidgetCatalogSync(root: string): Promise<{
  catalog: WidgetCatalog
  diffs: string[]
}> {
  const generated = await generateWidgetCatalog(root)
  const committed = loadCommittedWidgetCatalog(root)
  return {
    catalog: generated,
    diffs: diffWidgetCatalog(generated, committed),
  }
}

export function loadRuntimeWidgetCatalog(): WidgetCatalog {
  const file = new URL('./generated/widget-catalog.json', import.meta.url)
  return parseWidgetCatalog(JSON.parse(fs.readFileSync(file, 'utf8')))
}

let cached: WidgetCatalog | undefined

export function getWidgetCatalog(): WidgetCatalog {
  if (!cached) cached = loadRuntimeWidgetCatalog()
  return cached
}
