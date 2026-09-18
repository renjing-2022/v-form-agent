import fs from 'node:fs'
import path from 'node:path'
import {
  DESIGN_TRUTH_GRAPH_REL,
  PROPERTY_EDITOR_ROOT_REL,
  PROPERTY_REGISTER_REL,
  extractEditorEnumLiterals,
  extractDataArrayEnumValues,
  parsePropertyRegister,
  type PropertyRegisterMaps,
  propertyRegisterEditorFor,
} from './catalogPolicy.js'
import {
  calculateDesignTruthFingerprint,
  parseDesignTruthGraph,
  type DesignTruthEditorEntry,
  type DesignTruthGraph,
  type DesignTruthTypeOverride,
} from './designTruthGraph.js'
import type { ValueKind } from './widgetCatalog.js'

const EXPECTED_EDITOR_FILE_COUNT = 219

function isEditorSourceFile(rel: string, fileName: string): boolean {
  if (fileName.endsWith('-editor.vue')) return true
  const norm = rel.replace(/\\/g, '/')
  if (norm.includes('event-handler/') && /^on[A-Z][A-Za-z0-9_-]*\.vue$/.test(fileName) && !fileName.endsWith('-editor.vue')) {
    return true
  }
  return false
}

function walkEditorFiles(dir: string, relRoot: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walkEditorFiles(full, relRoot, out)
    } else if (isEditorSourceFile(path.relative(relRoot, full), ent.name)) {
      out.push(path.relative(relRoot, full).replace(/\\/g, '/'))
    }
  }
  return out
}

function extractEditorComponentName(source: string, fallback: string): string {
  const m = source.match(/name:\s*['"]([^'"]+-editor)['"]/)
  return m?.[1] || fallback
}

function extractTemplate(source: string): string {
  const m = source.match(/<template>([\s\S]*?)<\/template>/)
  return m?.[1] || source
}

function extractLinkageHiddenWhen(template: string): DesignTruthEditorEntry['linkageHiddenWhen'] | undefined {
  const m = template.match(/v-if="!optionModel\.(\w+)"/)
  if (!m) return undefined
  return { key: m[1], equals: true }
}

function inferValueKind(editorName: string, source: string, template: string): ValueKind {
  const base = editorName.replace(/-editor$/, '')
  if (/eventMixin|editEventHandler/.test(source) || /^on[A-Z]/.test(base)) {
    return 'string'
  }
  if (/<el-switch\b/.test(template)) return 'boolean'
  if (/<el-input-number\b/.test(template)) return 'number'
  if (/<el-input[^>]*\btype="number"/.test(template)) return 'number'
  if (/<el-rate\b/.test(template)) return 'number'
  if (/<el-slider\b/.test(template)) return 'number'
  if (/<el-radio-button\b|<el-radio\b/.test(template)) return 'enum'
  if (/<el-select\b/.test(template) && /<el-option\b/.test(template)) return 'enum'
  if (
    /optionItems|option-lines|optionLines|treeData|validation|columns-editor|data-table-columns/i.test(
      template + editorName,
    )
  ) {
    return 'array'
  }
  if (
    /columnWidth|htmlContent|uploadURL|uploadTip|cssCode|fontSize|switchWidth|width-editor|cellWidth|contentHeight|vf-drawer-size|format-editor|valueFormat|textContent|placeholder-editor/i.test(
      editorName,
    )
  ) {
    return 'cssText'
  }
  if (/<el-input[^>]*\btype="textarea"/.test(template)) return 'string'
  return 'string'
}

function extractEnumLiterals(source: string, template: string, valueKind: ValueKind): Array<string | number | boolean> | undefined {
  if (valueKind !== 'enum') return undefined
  const fromRadios = extractEditorEnumLiterals(template)
  if (fromRadios.length) return fromRadios
  const widgetSizes = extractDataArrayEnumValues(source, 'widgetSizes')
  if (widgetSizes.length) return widgetSizes
  const formSizes = extractDataArrayEnumValues(source, 'formSizes')
  if (formSizes.length) return formSizes
  const labelIconPosition = extractDataArrayEnumValues(source, 'labelIconPosition')
  if (labelIconPosition.length) return labelIconPosition
  return undefined
}

function parseEditorVue(relPath: string, source: string): { name: string; entry: DesignTruthEditorEntry } {
  const fallbackName = path.basename(relPath, '.vue')
  const name = extractEditorComponentName(source, fallbackName)
  const template = extractTemplate(source)
  const valueKind = inferValueKind(name, source, template)
  const enumValues = extractEnumLiterals(source, template, valueKind)
  const linkageHiddenWhen = extractLinkageHiddenWhen(template)
  return {
    name,
    entry: {
      relPath: `${PROPERTY_EDITOR_ROOT_REL}/${relPath}`,
      valueKind,
      ...(enumValues?.length ? { enum: enumValues } : {}),
      ...(linkageHiddenWhen ? { linkageHiddenWhen } : {}),
      source: 'property-editor',
    },
  }
}

export function parseTypePropOverride(
  editorName: string,
  catalogTypes: string[],
  register?: PropertyRegisterMaps,
): DesignTruthTypeOverride | null {
  if (!editorName.endsWith('-editor')) return null
  const body = editorName.slice(0, -'-editor'.length)
  const sorted = [...catalogTypes].sort((a, b) => b.length - a.length)
  for (const widgetType of sorted) {
    const prefix = `${widgetType}-`
    if (!body.startsWith(prefix)) continue
    const prop = body.slice(prefix.length)
    if (!prop) continue
    const generic = register ? propertyRegisterEditorFor(register, prop) : undefined
    return {
      widgetType,
      prop,
      editor: editorName,
      ...(generic && generic !== editorName ? { skipsGenericEditor: true } : {}),
    }
  }
  return null
}

/** propertyRegister 常引用 generic 名（preWrap-editor），实际组件为 static-text-preWrap-editor 等 */
function augmentRegisterEditorAliases(
  editors: Record<string, DesignTruthEditorEntry>,
  register: PropertyRegisterMaps,
): void {
  const pairs: Array<[string, string]> = [
    ...Object.entries(register.common),
    ...Object.entries(register.advanced),
  ]
  for (const [prop, registerEditorName] of pairs) {
    if (editors[registerEditorName]) continue
    const suffix = `-${prop}-editor`
    const typeSpecific = Object.entries(editors).find(([name]) => name.endsWith(suffix))
    if (typeSpecific) {
      editors[registerEditorName] = { ...typeSpecific[1] }
    }
  }
}

export function compileDesignTruthGraph(root: string, catalogTypes: string[]): DesignTruthGraph {
  const editorRoot = path.join(root, PROPERTY_EDITOR_ROOT_REL)
  const registerPath = path.join(root, PROPERTY_REGISTER_REL)
  const registerSource = fs.readFileSync(registerPath, 'utf8')
  const register = parsePropertyRegister(registerSource)

  const relFiles = walkEditorFiles(editorRoot, editorRoot).sort()
  const standardEditorFiles = relFiles.filter((rel) => rel.endsWith('-editor.vue'))
  if (standardEditorFiles.length !== EXPECTED_EDITOR_FILE_COUNT) {
    throw new Error(
      `property-editor *-editor.vue count mismatch: expected ${EXPECTED_EDITOR_FILE_COUNT} actual ${standardEditorFiles.length}`,
    )
  }

  const editors: Record<string, DesignTruthEditorEntry> = {}
  const editorSources: Array<{ relPath: string; content: string }> = []
  for (const rel of relFiles) {
    const abs = path.join(editorRoot, rel)
    const source = fs.readFileSync(abs, 'utf8')
    editorSources.push({ relPath: rel, content: source })
    const parsed = parseEditorVue(rel, source)
    if (editors[parsed.name]) {
      throw new Error(`duplicate editor component name: ${parsed.name} (${rel})`)
    }
    editors[parsed.name] = parsed.entry
  }

  const typeOverrides: DesignTruthTypeOverride[] = []
  const seenOverride = new Set<string>()
  for (const editorName of Object.keys(editors).sort()) {
    const override = parseTypePropOverride(editorName, catalogTypes, register)
    if (!override) continue
    const key = `${override.widgetType}.${override.prop}`
    if (seenOverride.has(key)) continue
    seenOverride.add(key)
    typeOverrides.push(override)
  }

  augmentRegisterEditorAliases(editors, register)

  const registerEditors = new Set<string>()
  for (const name of [
    ...Object.values(register.common),
    ...Object.values(register.advanced),
    ...Object.values(register.event),
  ]) {
    registerEditors.add(name)
  }
  for (const name of registerEditors) {
    if (!editors[name]) {
      throw new Error(`propertyRegister editor not found in graph: ${name}`)
    }
  }

  return parseDesignTruthGraph({
    schemaVersion: 1,
    source: {
      propertyEditorRoot: PROPERTY_EDITOR_ROOT_REL,
      editorFileCount: standardEditorFiles.length,
      registerEditorCount: registerEditors.size,
      fingerprint: calculateDesignTruthFingerprint(editorSources, registerSource),
    },
    generatedAt: 'source-derived',
    editors,
    typeOverrides,
  })
}

export function designTruthGraphPath(root: string): string {
  return path.join(root, DESIGN_TRUTH_GRAPH_REL)
}

export function writeDesignTruthGraph(root: string, graph: DesignTruthGraph): string {
  const out = designTruthGraphPath(root)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
  return out
}

export function loadCommittedDesignTruthGraph(root: string): DesignTruthGraph {
  return parseDesignTruthGraph(JSON.parse(fs.readFileSync(designTruthGraphPath(root), 'utf8')))
}

/** catalog:check / acceptance：219 文件、register 映射、HIGH_PRECISION editor valueKind */
export function checkDesignTruthGraphParity(root: string, graph: DesignTruthGraph): string[] {
  const issues: string[] = []
  if (graph.source.editorFileCount !== EXPECTED_EDITOR_FILE_COUNT) {
    issues.push(`editor file count must be ${EXPECTED_EDITOR_FILE_COUNT}, got ${graph.source.editorFileCount}`)
  }
  const expectations: Array<[string, ValueKind]> = [
    ['labelWidth-editor', 'number'],
    ['rows-editor', 'number'],
    ['size-editor', 'enum'],
    ['labelAlign-editor', 'enum'],
    ['displayStyle-editor', 'enum'],
    ['required-editor', 'boolean'],
    ['autosize-editor', 'boolean'],
    ['labelWrap-editor', 'boolean'],
    ['labelHidden-editor', 'boolean'],
  ]
  for (const [name, kind] of expectations) {
    const entry = graph.editors[name]
    if (!entry) {
      issues.push(`missing expected editor: ${name}`)
      continue
    }
    if (entry.valueKind !== kind) {
      issues.push(`${name} valueKind expected ${kind} got ${entry.valueKind}`)
    }
  }
  const rows = graph.editors['rows-editor']
  if (!rows?.linkageHiddenWhen || rows.linkageHiddenWhen.key !== 'autosize') {
    issues.push('rows-editor must declare linkageHiddenWhen autosize')
  }
  if (!graph.editors['button-type-editor']) {
    issues.push('missing button-type-editor type override component')
  }
  const buttonTypeOverride = graph.typeOverrides.find((o) => o.widgetType === 'button' && o.prop === 'type')
  if (!buttonTypeOverride?.skipsGenericEditor) {
    issues.push('button.type override must skip generic type-editor')
  }
  if (graph.typeOverrides.length < 30) {
    issues.push(`typeOverrides too few: ${graph.typeOverrides.length}`)
  }
  return issues
}
