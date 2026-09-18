import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateTruthArtifacts,
  writeWidgetCatalog,
} from '../src/knowledge/generateWidgetCatalog.js'
import { writeDesignTruthGraph } from '../src/knowledge/compileDesignTruthGraph.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const { catalog, editorGraph } = await generateTruthArtifacts(root)
const catalogOut = writeWidgetCatalog(root, catalog)
const graphOut = writeDesignTruthGraph(root, editorGraph)
console.log(`wrote ${catalogOut}`)
console.log(`wrote ${graphOut}`)
console.log(
  `widgetTypes=${catalog.widgets.length} editors=${editorGraph.source.editorFileCount} typeOverrides=${editorGraph.typeOverrides.length} catalogFingerprint=${catalog.source.fingerprint} graphFingerprint=${editorGraph.source.fingerprint}`,
)
