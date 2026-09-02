import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CATALOG_JSON_REL,
  FORM_CONFIG_REL,
  WIDGETS_CONFIG_REL,
  classifyKeys,
  detectChildCollections,
  enumFor,
  formEnumFor,
  structureSurgeryFor,
} from './catalogPolicy.js'
import {
  buildOptionConstraints,
  calculateCatalogFingerprint,
  parseWidgetCatalog,
  type OptionConstraint,
  type WidgetCatalog,
  type WidgetCatalogEntry,
} from './widgetCatalog.js'

type WidgetSchema = Record<string, unknown> & {
  type?: string
  alias?: string
  icon?: string
  category?: string
  formItemFlag?: boolean
  internal?: boolean
  options?: Record<string, unknown>
}

type WidgetsConfigModule = {
  containers?: WidgetSchema[]
  basicFields?: WidgetSchema[]
  advancedFields?: WidgetSchema[]
  customFields?: WidgetSchema[]
  chartContainers?: WidgetSchema[]
  chartWidgets?: WidgetSchema[]
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]))
  }
  return value
}

export function extractDefaultFormConfig(utilSource: string): Record<string, unknown> {
  const fnStart = utilSource.indexOf('export function getDefaultFormConfig')
  if (fnStart < 0) throw new Error('getDefaultFormConfig not found in form config source')
  const returnIdx = utilSource.indexOf('return', fnStart)
  const braceStart = utilSource.indexOf('{', returnIdx)
  if (braceStart < 0) throw new Error('getDefaultFormConfig return object not found')
  let depth = 0
  for (let i = braceStart; i < utilSource.length; i++) {
    const ch = utilSource[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const literal = utilSource.slice(braceStart, i + 1)
        const parsed = new Function(`return (${literal})`)() as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('getDefaultFormConfig did not return an object')
        }
        return parsed as Record<string, unknown>
      }
    }
  }
  throw new Error('failed to parse getDefaultFormConfig object literal')
}

function collectSourceTypes(mod: WidgetsConfigModule): Map<string, { category: WidgetCatalogEntry['category']; schemas: WidgetSchema[] }> {
  const groups: Array<{ category: WidgetCatalogEntry['category']; schemas: WidgetSchema[] }> = [
    { category: 'container', schemas: mod.containers || [] },
    { category: 'basic', schemas: mod.basicFields || [] },
    { category: 'advanced', schemas: mod.advancedFields || [] },
    { category: 'custom', schemas: mod.customFields || [] },
    { category: 'chart-container', schemas: mod.chartContainers || [] },
    { category: 'chart-widget', schemas: mod.chartWidgets || [] },
  ]
  const byType = new Map<string, { category: WidgetCatalogEntry['category']; schemas: WidgetSchema[] }>()
  for (const group of groups) {
    for (const schema of group.schemas) {
      const type = typeof schema.type === 'string' ? schema.type : ''
      if (!type) continue
      const existing = byType.get(type)
      if (existing) existing.schemas.push(schema)
      else byType.set(type, { category: group.category, schemas: [schema] })
    }
  }
  return byType
}

function mergeOptions(schemas: WidgetSchema[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const schema of schemas) {
    Object.assign(merged, schema.options || {})
  }
  return merged
}

function withEnums(
  type: string,
  constraints: Record<string, OptionConstraint>,
): Record<string, OptionConstraint> {
  const next = { ...constraints }
  for (const [key, constraint] of Object.entries(next)) {
    const values = enumFor(type, key)
    if (values) next[key] = { ...constraint, enum: values }
  }
  return next
}

function buildEntry(
  type: string,
  category: WidgetCatalogEntry['category'],
  schemas: WidgetSchema[],
): WidgetCatalogEntry {
  const options = mergeOptions(schemas)
  const keys = Object.keys(options)
  const { writable, forbidden } = classifyKeys(keys, 'widget')
  const first = schemas[0]
  return {
    type,
    category,
    formItem: schemas.some((s) => s.formItemFlag === true),
    variants: schemas.map((schema) => ({
      alias: typeof schema.alias === 'string' && schema.alias ? schema.alias : null,
      icon: typeof schema.icon === 'string' ? schema.icon : null,
      defaultOptions: jsonSafe(schema.options || {}) as Record<string, unknown>,
      structure: {
        internal: schema.internal === true,
        childCollections: detectChildCollections(schema),
      },
    })),
    writableKeys: writable,
    forbiddenKeys: forbidden,
    constraints: withEnums(type, buildOptionConstraints(options)),
    notes: { structureSurgery: structureSurgeryFor(type) },
  }
}

export async function generateWidgetCatalog(root: string): Promise<WidgetCatalog> {
  const widgetsPath = path.join(root, WIDGETS_CONFIG_REL)
  const formPath = path.join(root, FORM_CONFIG_REL)
  const widgetsSource = fs.readFileSync(widgetsPath, 'utf8')
  const formSource = fs.readFileSync(formPath, 'utf8')
  const mod = (await import(pathToFileURL(widgetsPath).href)) as WidgetsConfigModule
  const byType = collectSourceTypes(mod)
  if (byType.size === 0) throw new Error('widgetsConfig.js produced zero widget types')

  const widgets = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, group]) => buildEntry(type, group.category, group.schemas))

  const defaultConfig = extractDefaultFormConfig(formSource)
  const formKeys = Object.keys(defaultConfig)
  const formClassified = classifyKeys(formKeys, 'form')
  const formConstraints = buildOptionConstraints(defaultConfig)
  for (const [key, constraint] of Object.entries(formConstraints)) {
    const values = formEnumFor(key)
    if (values) formConstraints[key] = { ...constraint, enum: values }
  }

  return parseWidgetCatalog({
    schemaVersion: 1,
    source: {
      widgetsConfig: WIDGETS_CONFIG_REL,
      formConfig: FORM_CONFIG_REL,
      fingerprint: calculateCatalogFingerprint(widgetsSource, formSource),
    },
    generatedAt: 'source-derived',
    widgets,
    form: {
      defaultConfig: jsonSafe(defaultConfig) as Record<string, unknown>,
      writableKeys: formClassified.writable,
      forbiddenKeys: formClassified.forbidden,
      constraints: formConstraints,
    },
  })
}

export function catalogJsonPath(root: string): string {
  return path.join(root, CATALOG_JSON_REL)
}

export function writeWidgetCatalog(root: string, catalog: WidgetCatalog): string {
  const out = catalogJsonPath(root)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  return out
}
