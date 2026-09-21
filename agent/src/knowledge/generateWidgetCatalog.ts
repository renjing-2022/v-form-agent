import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  checkCreateWhitelistCatalogParity,
  compareWidgetsConfigTypesWithCatalog,
} from './createWhitelistPolicy.js'
import {
  CATALOG_JSON_REL,
  FORM_CONFIG_REL,
  FIELD_LABEL_ALIGN_ENUM,
  FORM_LABEL_ALIGN_ENUM,
  FORM_SIZE_ENUM,
  FORM_TRUTH_VALUE_KIND,
  DISPLAY_STYLE_ENUM,
  HIGH_PRECISION_MATRIX,
  PROPERTY_REGISTER_REL,
  PROPERTY_EDITOR_RELS,
  WIDGETS_CONFIG_REL,
  WIDGET_SIZE_ENUM,
  WIDGET_TRUTH_VALUE_KIND,
  classifyKeys,
  constraintSourceFor,
  detectChildCollections,
  enumFor,
  enumsEqual,
  extractEditorEnumLiterals,
  extractDataArrayEnumValues,
  formEnumFor,
  enrichDesignTruthConstraint,
  parsePropertyRegister,
  type PropertyRegisterMaps,
  propertyRegisterEditorFor,
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
import {
  compileDesignTruthGraph,
  checkDesignTruthGraphParity,
} from './compileDesignTruthGraph.js'
import type { DesignTruthGraph } from './designTruthGraph.js'
import { applyCompositeSchemaToConstraint, checkCompositeSchemaParity } from './compositeSchemaPolicy.js'
import { checkContainerLevelPropertyParity, containerLevelKeysForType } from './containerLevelPolicy.js'
import {
  applyFormFieldDualTrack,
  checkFormFieldDualTrackParity,
  FORM_FIELD_DUAL_TRACK_REGISTRY,
} from './formFieldDualTrackPolicy.js'
import {
  applyIdentityForbiddenConstraints,
  CATALOG_IDENTITY_RULES,
  checkIdentityForbiddenParity,
} from './identityForbiddenPolicy.js'
import {
  applyRenderConventionConstraints,
  checkRenderConventionParity,
  renderConventionCatalogBlock,
} from './renderConventionPolicy.js'
import {
  applyExtensionBoundaryWidgetNotes,
  checkExtensionBoundaryParity,
  extensionBoundaryCatalogBlock,
} from './extensionBoundaryPolicy.js'
import {
  checkCatalogSampleParity,
  checkPolicyEnumConvergence,
  resolveCatalogEnumFromGraph,
  resolveFormCatalogEnum,
  CATALOG_SAMPLE_SIZE,
  pickCatalogSamplePairs,
  collectCatalogSampleCandidates,
} from './catalogEnumPolicy.js'
import {
  applyA2StrictFormConstraints,
  applyA2StrictWidgetConstraints,
  checkCatalogFullStrictSweep,
} from './catalogStrictPolicy.js'

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

function withEnumsAndSources(
  type: string,
  constraints: Record<string, OptionConstraint>,
  editorGraph: DesignTruthGraph,
  editorMap: PropertyRegisterMaps,
): Record<string, OptionConstraint> {
  const next: Record<string, OptionConstraint> = {}
  for (const [key, constraint] of Object.entries(constraints)) {
    const values = resolveCatalogEnumFromGraph(type, key, editorGraph, editorMap)
    next[key] = {
      ...constraint,
      ...(values ? { enum: values, strict: true } : {}),
      source: constraintSourceFor('widget', key),
    }
  }
  return next
}

function applyWidgetTruthOverrides(
  constraints: Record<string, OptionConstraint>,
  applicableKeys: string[],
): Record<string, OptionConstraint> {
  const next = { ...constraints }
  for (const [key, override] of Object.entries(WIDGET_TRUTH_VALUE_KIND)) {
    if (!applicableKeys.includes(key) || !(key in next)) continue
    next[key] = {
      valueType: override.valueType,
      nullable: override.nullable,
      source: override.source,
      strict: override.strict,
    }
  }
  if (applicableKeys.includes('size') && next.size) {
    next.size = {
      valueType: 'string',
      nullable: false,
      enum: [...WIDGET_SIZE_ENUM],
      source: 'property-editor',
      strict: true,
    }
  }
  return next
}

function applyFormTruthOverrides(constraints: Record<string, OptionConstraint>): Record<string, OptionConstraint> {
  const next = { ...constraints }
  for (const [key, override] of Object.entries(FORM_TRUTH_VALUE_KIND)) {
    if (!(key in next)) continue
    next[key] = {
      valueType: override.valueType,
      nullable: override.nullable,
      source: override.source,
      strict: override.strict,
    }
  }
  if (next.size) {
    next.size = {
      ...next.size,
      enum: [...FORM_SIZE_ENUM],
      source: 'property-editor',
      strict: true,
    }
  }
  return next
}

function highPrecisionReady(constraints: Record<string, OptionConstraint>, options: Record<string, unknown>): boolean {
  for (const key of HIGH_PRECISION_MATRIX.widgetKeys) {
    if (!(key in options)) continue
    if (key === 'labelAlign' || key === 'displayStyle' || key === 'size') {
      if (!constraints[key]?.enum?.length) return false
    }
    if (key === 'labelWidth') {
      const c = constraints.labelWidth
      if (!c || c.valueType !== 'number' || !c.strict) return false
    }
    if (key === 'labelWrap' || key === 'labelHidden') {
      const c = constraints[key]
      if (!c || c.valueType !== 'boolean' || !c.strict) return false
    }
  }
  return true
}

function applicableKeysFromSchemas(schemas: WidgetSchema[]): string[] {
  const canonical = schemas[0]
  return Object.keys(canonical?.options || {}).sort()
}

function enrichAllConstraints(
  constraints: Record<string, OptionConstraint>,
  editorMap: PropertyRegisterMaps,
  editorGraph: DesignTruthGraph,
  widgetType: string,
  category: WidgetCatalogEntry['category'],
): Record<string, OptionConstraint> {
  const enrichScope = category === 'container' ? 'container' : 'field'
  const propertyScope = category === 'container' ? 'container' : 'field'
  return Object.fromEntries(
    Object.entries(constraints).map(([key, constraint]) => {
      const enriched = enrichDesignTruthConstraint(
        key,
        constraint,
        editorMap,
        editorGraph,
        widgetType,
        enrichScope,
      )
      const withComposite = applyCompositeSchemaToConstraint(key, enriched)
      const withDual =
        FORM_FIELD_DUAL_TRACK_REGISTRY[key] &&
        (enrichScope === 'field' || (enrichScope === 'container' && key === 'customClass'))
          ? applyFormFieldDualTrack('field', key, withComposite)
          : withComposite
      return [key, { ...withDual, propertyScope }]
    }),
  )
}

function buildEntry(
  type: string,
  category: WidgetCatalogEntry['category'],
  schemas: WidgetSchema[],
  editorMap: PropertyRegisterMaps,
  editorGraph: DesignTruthGraph,
): WidgetCatalogEntry {
  const options = mergeOptions(schemas)
  const keys = Object.keys(options)
  const applicableKeys = applicableKeysFromSchemas(schemas)
  const { writable, forbidden } = classifyKeys(keys, 'widget')
  const constraints = applyA2StrictWidgetConstraints(
    type,
    applyRenderConventionConstraints(
      'field',
      applyIdentityForbiddenConstraints(
        'widget',
        enrichAllConstraints(
          applyWidgetTruthOverrides(
            withEnumsAndSources(type, buildOptionConstraints(options), editorGraph, editorMap),
            applicableKeys,
          ),
          editorMap,
          editorGraph,
          type,
          category,
        ),
        forbidden,
        writable,
      ),
    ),
    editorGraph,
    editorMap,
  )
  return applyExtensionBoundaryWidgetNotes({
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
    applicableKeys,
    ...(category === 'container'
      ? { containerLevelKeys: containerLevelKeysForType(type, applicableKeys) }
      : {}),
    forbiddenKeys: forbidden,
    constraints,
    notes: {
      structureSurgery: structureSurgeryFor(type),
      highPrecisionReady: highPrecisionReady(constraints, options),
    },
  })
}

export function assertEditorEnumsMatchDesignTruth(root: string): string[] {
  const issues: string[] = []
  const labelAlignPath = path.join(root, PROPERTY_EDITOR_RELS.labelAlign)
  const displayStylePath = path.join(root, PROPERTY_EDITOR_RELS.displayStyle)
  const sizePath = path.join(root, PROPERTY_EDITOR_RELS.size)
  const labelAlignSrc = fs.readFileSync(labelAlignPath, 'utf8')
  const displayStyleSrc = fs.readFileSync(displayStylePath, 'utf8')
  const sizeSrc = fs.readFileSync(sizePath, 'utf8')
  const fromLabelAlignEditor = extractEditorEnumLiterals(labelAlignSrc)
  const fromDisplayStyleEditor = extractEditorEnumLiterals(displayStyleSrc)
  const fromSizeEditor = extractDataArrayEnumValues(sizeSrc, 'widgetSizes')

  const expectedLabelAlign = FORM_LABEL_ALIGN_ENUM.map(String).sort()
  const actualLabelAlign = [...fromLabelAlignEditor].sort()
  if (!enumsEqual(expectedLabelAlign, actualLabelAlign)) {
    issues.push(
      `labelAlign-editor enum mismatch: editor=[${actualLabelAlign.join(',')}] catalogForm=[${expectedLabelAlign.join(',')}]`,
    )
  }
  if (!enumsEqual(DISPLAY_STYLE_ENUM.map(String), fromDisplayStyleEditor)) {
    issues.push(
      `displayStyle-editor enum mismatch: editor=[${fromDisplayStyleEditor.join(',')}] catalog=[${DISPLAY_STYLE_ENUM.join(',')}]`,
    )
  }
  if (!enumsEqual(WIDGET_SIZE_ENUM.map(String), fromSizeEditor)) {
    issues.push(
      `size-editor enum mismatch: editor=[${fromSizeEditor.join(',')}] catalog=[${WIDGET_SIZE_ENUM.join(',')}]`,
    )
  }
  if (!FIELD_LABEL_ALIGN_ENUM.includes('') || FIELD_LABEL_ALIGN_ENUM.length !== 4) {
    issues.push('FIELD_LABEL_ALIGN_ENUM must include empty inherit and three align classes')
  }
  if (WIDGET_SIZE_ENUM.includes('default') || FORM_SIZE_ENUM.includes('default')) {
    issues.push('size enum must not include literal "default"; use empty string for default size')
  }
  return issues
}

export async function generateTruthArtifacts(root: string): Promise<{
  catalog: WidgetCatalog
  editorGraph: DesignTruthGraph
}> {
  const widgetsPath = path.join(root, WIDGETS_CONFIG_REL)
  const formPath = path.join(root, FORM_CONFIG_REL)
  const widgetsSource = fs.readFileSync(widgetsPath, 'utf8')
  const formSource = fs.readFileSync(formPath, 'utf8')
  const editorExtras = [
    ...Object.values(PROPERTY_EDITOR_RELS).map((rel) => ({
      path: rel,
      content: fs.readFileSync(path.join(root, rel), 'utf8'),
    })),
    {
      path: PROPERTY_REGISTER_REL,
      content: fs.readFileSync(path.join(root, PROPERTY_REGISTER_REL), 'utf8'),
    },
  ]

  const editorIssues = assertEditorEnumsMatchDesignTruth(root)
  if (editorIssues.length) {
    throw new Error(`design-truth editor sync failed:\n${editorIssues.join('\n')}`)
  }

  const registerSource = fs.readFileSync(path.join(root, PROPERTY_REGISTER_REL), 'utf8')
  const editorMap = parsePropertyRegister(registerSource)

  const mod = (await import(pathToFileURL(widgetsPath).href)) as WidgetsConfigModule
  const byType = collectSourceTypes(mod)
  if (byType.size === 0) throw new Error('widgetsConfig.js produced zero widget types')

  const catalogTypes = [...byType.keys()]
  const editorGraph = compileDesignTruthGraph(root, catalogTypes)

  const widgets = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, group]) => buildEntry(type, group.category, group.schemas, editorMap, editorGraph))

  const defaultConfig = extractDefaultFormConfig(formSource)
  const formKeys = Object.keys(defaultConfig)
  const formClassified = classifyKeys(formKeys, 'form')
  const formConstraints = buildOptionConstraints(defaultConfig)
  for (const [key, constraint] of Object.entries(formConstraints)) {
    const values = resolveFormCatalogEnum(key, editorGraph, editorMap)
    formConstraints[key] = {
      ...constraint,
      ...(values ? { enum: values, strict: true } : {}),
      source: constraintSourceFor('form', key),
    }
  }
  Object.assign(formConstraints, applyFormTruthOverrides(formConstraints))
  const enrichedFormConstraints = applyA2StrictFormConstraints(
    applyRenderConventionConstraints(
      'form',
      applyIdentityForbiddenConstraints(
        'form',
        Object.fromEntries(
          Object.entries(formConstraints).map(([key, constraint]) => {
            const enriched = enrichDesignTruthConstraint(key, constraint, editorMap, editorGraph, undefined, 'form')
            const withComposite = applyCompositeSchemaToConstraint(key, enriched)
            const withDual = FORM_FIELD_DUAL_TRACK_REGISTRY[key]
              ? applyFormFieldDualTrack('form', key, withComposite)
              : withComposite
            return [key, { ...withDual, propertyScope: 'form' as const }]
          }),
        ),
        formClassified.forbidden,
        formClassified.writable,
      ),
    ),
    editorGraph,
    editorMap,
  )

  for (const key of HIGH_PRECISION_MATRIX.formKeys) {
    if (!(key in enrichedFormConstraints)) continue
    if ((key === 'labelAlign' || key === 'labelPosition' || key === 'layoutType' || key === 'size') && !enrichedFormConstraints[key].enum) {
      throw new Error(`form high-precision key missing enum: ${key}`)
    }
    if (key === 'labelWidth') {
      const c = enrichedFormConstraints.labelWidth
      if (!c || c.valueType !== 'number' || !c.strict) {
        throw new Error('form high-precision labelWidth must be strict number')
      }
    }
  }

  const catalog = parseWidgetCatalog({
    schemaVersion: 1,
    source: {
      widgetsConfig: WIDGETS_CONFIG_REL,
      formConfig: FORM_CONFIG_REL,
      propertyEditors: Object.values(PROPERTY_EDITOR_RELS),
      fingerprint: calculateCatalogFingerprint(widgetsSource, formSource, editorExtras),
    },
    generatedAt: 'source-derived',
    identity: { rules: CATALOG_IDENTITY_RULES },
    renderConventions: renderConventionCatalogBlock(),
    extensionPolicy: extensionBoundaryCatalogBlock(),
    widgets,
    form: {
      defaultConfig: jsonSafe(defaultConfig) as Record<string, unknown>,
      writableKeys: formClassified.writable,
      forbiddenKeys: formClassified.forbidden,
      constraints: enrichedFormConstraints,
    },
  })
  return { catalog, editorGraph }
}

export async function generateWidgetCatalog(root: string): Promise<WidgetCatalog> {
  return (await generateTruthArtifacts(root)).catalog
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

/** 高精度矩阵覆盖检查（用于 catalog:check / acceptance） */
export function checkHighPrecisionCoverage(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  for (const widget of catalog.widgets) {
    const defaults = widget.variants[0]?.defaultOptions || {}
    for (const key of HIGH_PRECISION_MATRIX.widgetKeys) {
      if (!(key in defaults)) continue
      if (key === 'labelAlign' || key === 'displayStyle' || key === 'size') {
        if (!widget.constraints[key]?.enum?.length) {
          issues.push(`${widget.type} missing enum for high-precision key: ${key}`)
        }
      }
      if (key === 'labelWidth') {
        const c = widget.constraints.labelWidth
        if (!c || c.valueType !== 'number' || !c.strict) {
          issues.push(`${widget.type} labelWidth must be strict number (property-editor)`)
        }
      }
      if (key === 'labelAlign') {
        const e = widget.constraints.labelAlign?.enum || []
        if (!enumsEqual(e, FIELD_LABEL_ALIGN_ENUM)) {
          issues.push(`${widget.type} labelAlign enum must match FIELD_LABEL_ALIGN_ENUM`)
        }
      }
      if (key === 'size') {
        const e = widget.constraints.size?.enum || []
        if (e.includes('default')) {
          issues.push(`${widget.type} size enum must not include literal "default"`)
        }
        if (!enumsEqual(e, WIDGET_SIZE_ENUM)) {
          issues.push(`${widget.type} size enum must match WIDGET_SIZE_ENUM`)
        }
      }
    }
    if (Object.keys(defaults).some((k) => /^on[A-Z]/.test(k)) && widget.forbiddenKeys.filter((k) => /^on[A-Z]/.test(k)).length === 0) {
      issues.push(`${widget.type} must expose event keys in forbiddenKeys`)
    }
  }
  const formAlign = catalog.form.constraints.labelAlign?.enum
  if (!enumsEqual(formAlign, FORM_LABEL_ALIGN_ENUM)) {
    issues.push('form.labelAlign enum must match FORM_LABEL_ALIGN_ENUM')
  }
  const formLabelWidth = catalog.form.constraints.labelWidth
  if (!formLabelWidth || formLabelWidth.valueType !== 'number' || !formLabelWidth.strict) {
    issues.push('form.labelWidth must be strict number')
  }
  const formSize = catalog.form.constraints.size?.enum
  if (formSize?.includes('default') || !enumsEqual(formSize, FORM_SIZE_ENUM)) {
    issues.push('form.size enum must match FORM_SIZE_ENUM without literal "default"')
  }
  return issues
}

/** applicableKeys 与 canonical variant 模板 options 键一致（hasConfig 等价） */
export function checkApplicableKeysParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  for (const widget of catalog.widgets) {
    const expected = Object.keys(widget.variants[0]?.defaultOptions || {}).sort()
    const actual = [...(widget.applicableKeys || [])].sort()
    if (!widget.applicableKeys?.length) {
      issues.push(`${widget.type} missing applicableKeys`)
      continue
    }
    if (!enumsEqual(expected, actual)) {
      issues.push(`${widget.type} applicableKeys mismatch canonical variant`)
    }
  }
  const formCustom = catalog.form.constraints.customClass
  if (!formCustom || formCustom.valueType !== 'array' || !formCustom.strict) {
    issues.push('form.customClass must be strict array')
  }
  return issues
}

export function checkWidgetsConfigCatalogTypeParity(
  catalog: WidgetCatalog,
  widgetsConfigTypes: string[],
): string[] {
  return compareWidgetsConfigTypesWithCatalog(widgetsConfigTypes, catalog)
}

export function checkCreateWhitelistPolicy(catalog: WidgetCatalog): string[] {
  return checkCreateWhitelistCatalogParity(catalog)
}

export { checkFormFieldDualTrackParity } from './formFieldDualTrackPolicy.js'
export { checkIdentityForbiddenParity } from './identityForbiddenPolicy.js'
export { checkRenderConventionParity } from './renderConventionPolicy.js'
export { checkExtensionBoundaryParity } from './extensionBoundaryPolicy.js'
export {
  checkCatalogSampleParity,
  checkPolicyEnumConvergence,
  CATALOG_SAMPLE_SIZE,
  collectCatalogSampleCandidates,
  pickCatalogSamplePairs,
} from './catalogEnumPolicy.js'
export { checkCatalogFullStrictSweep, formatCatalogStrictGapReport } from './catalogStrictPolicy.js'

/** propertyRegister 106+33 键映射 editor，且 HIGH_PRECISION 键在 Catalog 中带 editor 字段 */
export function checkPropertyRegisterParity(root: string, catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const source = fs.readFileSync(path.join(root, PROPERTY_REGISTER_REL), 'utf8')
  const maps = parsePropertyRegister(source)
  const commonCount = Object.keys(maps.common).length
  const advancedCount = Object.keys(maps.advanced).length
  if (commonCount < 100) {
    issues.push(`propertyRegister COMMON_PROPERTIES too few: ${commonCount}`)
  }
  if (advancedCount < 30) {
    issues.push(`propertyRegister ADVANCED_PROPERTIES too few: ${advancedCount}`)
  }
  for (const key of ['labelAlign', 'displayStyle', 'labelWidth', 'size', 'rows', 'autosize'] as const) {
    const editor = propertyRegisterEditorFor(maps, key)
    if (!editor) {
      issues.push(`propertyRegister missing editor for ${key}`)
    }
  }
  const input = catalog.widgets.find((w) => w.type === 'input')
  const textarea = catalog.widgets.find((w) => w.type === 'textarea')
  if (!input?.constraints.labelAlign?.editor) {
    issues.push('input.labelAlign missing catalog editor mapping')
  }
  if (!textarea?.constraints.rows?.linkageBlockedWhen) {
    issues.push('textarea.rows missing linkageBlockedWhen autosize=true')
  }
  if (textarea?.constraints.rows?.editor !== 'rows-editor') {
    issues.push('textarea.rows editor must be rows-editor')
  }
  return issues
}

export async function listWidgetsConfigUniqueTypes(root: string): Promise<string[]> {
  const widgetsPath = path.join(root, WIDGETS_CONFIG_REL)
  const mod = (await import(pathToFileURL(widgetsPath).href)) as WidgetsConfigModule
  return [...collectSourceTypes(mod).keys()].sort()
}
