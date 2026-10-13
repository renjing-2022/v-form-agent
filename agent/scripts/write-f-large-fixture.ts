/**
 * 生成 v0.13 大表 fixture：>120 节点 + 深度>8 + 双「备注」歧义锚点。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultFormConfig } from '../src/knowledge/widgetWhitelist.js'
import { buildWidgetFromCatalogDefaults } from '../src/knowledge/widgetDefaults.js'
import { buildFormIndex } from '../src/services/formIndex.js'

function nestDeep(depth: number, leafName: string): Record<string, unknown> {
  if (depth <= 0) {
    return buildWidgetFromCatalogDefaults('input', {
      id: leafName,
      name: leafName,
      label: leafName,
    })
  }
  return buildWidgetFromCatalogDefaults('grid', {
    id: `g${depth}`,
    name: `g${depth}`,
    label: `g${depth}`,
    cols: [
      {
        type: 'grid-col',
        options: { span: 24 },
        widgetList: [nestDeep(depth - 1, leafName)],
      },
    ],
  })
}

export function buildFLarge(): {
  widgetList: Record<string, unknown>[]
  formConfig: Record<string, unknown>
} {
  const widgetList: Record<string, unknown>[] = [
    buildWidgetFromCatalogDefaults('input', {
      id: 'remark_a',
      name: 'remark_a',
      label: '备注',
    }),
    buildWidgetFromCatalogDefaults('textarea', {
      id: 'remark_b',
      name: 'remark_b',
      label: '备注',
    }),
    nestDeep(10, 'deepLeaf'),
  ]
  for (let i = 0; i < 130; i++) {
    widgetList.push(
      buildWidgetFromCatalogDefaults('input', {
        id: `f${i}`,
        name: `f${i}`,
        label: `字段${i}`,
      }),
    )
  }
  return { widgetList, formConfig: getDefaultFormConfig() }
}

function main() {
  const form = buildFLarge()
  const index = buildFormIndex(form as never)
  if (index.nodes.length <= 120) {
    throw new Error(`expected >120 nodes, got ${index.nodes.length}`)
  }
  if (index.maxDepth <= 8) {
    throw new Error(`expected depth >8, got ${index.maxDepth}`)
  }
  const out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/interaction/forms/F-large.json',
  )
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(form), 'utf8')
  console.log(
    `F_LARGE_OK nodes=${index.nodes.length} maxDepth=${index.maxDepth} bytes=${fs.statSync(out).size}`,
  )
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isDirect) main()
