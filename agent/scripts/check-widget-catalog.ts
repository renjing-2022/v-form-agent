import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkWidgetCatalogSync } from '../src/knowledge/widgetCatalogStore.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { catalog, diffs } = await checkWidgetCatalogSync(root)
if (diffs.length > 0) {
  console.error('WIDGET_CATALOG_DRIFT')
  for (const diff of diffs) console.error(`- ${diff}`)
  process.exit(1)
}
console.log(
  `WIDGET_CATALOG_SYNC widgetTypes=${catalog.widgets.length} fingerprint=${catalog.source.fingerprint}`,
)
