import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateWidgetCatalog, writeWidgetCatalog } from '../src/knowledge/generateWidgetCatalog.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const catalog = await generateWidgetCatalog(root)
const out = writeWidgetCatalog(root, catalog)
console.log(`wrote ${out}`)
console.log(`widgetTypes=${catalog.widgets.length} fingerprint=${catalog.source.fingerprint}`)
