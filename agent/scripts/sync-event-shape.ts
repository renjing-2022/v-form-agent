import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildEventShapeRegistry,
  writeEventShapeRegistry,
  checkEventShapeParity,
} from '../src/knowledge/eventShapeRegistry.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shapes = buildEventShapeRegistry(root)
writeEventShapeRegistry(root, shapes)
const issues = checkEventShapeParity(root)
if (issues.length) {
  console.error('EVENT_SHAPE_SYNC_FAILED')
  for (const i of issues) console.error(`- ${i}`)
  process.exit(1)
}
console.log(`EVENT_SHAPE_SYNC_OK shapes=${shapes.length}`)
