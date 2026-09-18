import fs from 'node:fs'
import { CATALOG_JSON_REL } from './catalogPolicy.js'
import {
  catalogJsonPath,
  generateTruthArtifacts,
} from './generateWidgetCatalog.js'
import { diffWidgetCatalog, parseWidgetCatalog, type WidgetCatalog } from './widgetCatalog.js'
import {
  designTruthGraphPath,
  loadCommittedDesignTruthGraph,
} from './compileDesignTruthGraph.js'
import { diffDesignTruthGraph, type DesignTruthGraph } from './designTruthGraph.js'

export function loadCommittedWidgetCatalog(root: string): WidgetCatalog {
  const raw = fs.readFileSync(catalogJsonPath(root), 'utf8')
  return parseWidgetCatalog(JSON.parse(raw))
}

export async function checkWidgetCatalogSync(root: string): Promise<{
  catalog: WidgetCatalog
  editorGraph: DesignTruthGraph
  catalogDiffs: string[]
  graphDiffs: string[]
}> {
  const { catalog, editorGraph } = await generateTruthArtifacts(root)
  const committedCatalog = loadCommittedWidgetCatalog(root)
  const committedGraph = loadCommittedDesignTruthGraph(root)
  return {
    catalog,
    editorGraph,
    catalogDiffs: diffWidgetCatalog(catalog, committedCatalog),
    graphDiffs: diffDesignTruthGraph(editorGraph, committedGraph),
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

export { CATALOG_JSON_REL, designTruthGraphPath }
