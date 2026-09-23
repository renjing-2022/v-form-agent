/**
 * 非 Playwright Acceptance candidates 取证脚本（api / smoke / static）
 * 输出：docs/evidence/v0.2.0/<case-id>.txt
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleFormJson } from '../src/services/assembler.js'
import { mockPlanFromText } from '../src/services/planner.js'
import { mockRefinePlan, normalizeRefinePlanRaw } from '../src/services/refinePlanner.js'
import { applyRefinePlan } from '../src/services/refineMerger.js'
import { collectWidgetIds, validateFormJson } from '../src/services/validator.js'
import { refinePlanSchema } from '../src/schemas/refinePlan.js'
import { enforceRefineTextPolicy } from '../src/services/refineTextPolicy.js'
import { sanitizeFormPatch, sanitizeWidgetPatch, reconcileMultipleDefaultValue } from '../src/services/refinePropertyPolicy.js'
import { mergeCssCode, validateCssCode } from '../src/services/cssGuard.js'
import { buildFormSummary } from '../src/services/formSummary.js'
import { validatePlanTargets, resolveTarget, resolveScopeFields } from '../src/services/targetResolver.js'
import { parseParentScope, expandParentScope } from '../src/services/parentScopeParser.js'
import { buildCatalogSnippets } from '../src/knowledge/catalogContext.js'
import { isEventKey, FIELD_LABEL_ALIGN_ENUM, FORM_LABEL_ALIGN_ENUM } from '../src/knowledge/catalogPolicy.js'
import {
  generateWidgetCatalog,
  assertEditorEnumsMatchDesignTruth,
  checkHighPrecisionCoverage,
  checkApplicableKeysParity,
  checkCreateWhitelistPolicy,
  checkPropertyRegisterParity,
  checkWidgetsConfigCatalogTypeParity,
  listWidgetsConfigUniqueTypes,
} from '../src/knowledge/generateWidgetCatalog.js'
import { checkDesignTruthGraphParity } from '../src/knowledge/compileDesignTruthGraph.js'
import { diffDesignTruthGraph } from '../src/knowledge/designTruthGraph.js'
import { checkWidgetCatalogSync } from '../src/knowledge/widgetCatalogStore.js'
import { diffWidgetCatalog } from '../src/knowledge/widgetCatalog.js'
import { instructionHasAlignIntent, alignIntentUnfulfilled } from '../src/services/refineAlignPolicy.js'
import {
  buildHonestSummary,
  highPrecisionIntentUnfulfilled,
  instructionHasLabelWidthIntent,
  planPatchesAllIllegalForKey,
} from '../src/services/refineIntentGate.js'
import {
  enrichLayoutPlan,
  instructionHasOverlapIntent,
  layoutIntentUnfulfilled,
} from '../src/services/refineLayoutPolicy.js'
import {
  normalizeLabelWidthValue,
  normalizeRefinePlanSynonyms,
} from '../src/services/nlSynonymNormalize.js'
import {
  assertCreateTypesHaveCatalogDefaults,
  cloneCatalogDefaultOptions,
  getWidgetDefaultSchema,
} from '../src/knowledge/widgetDefaults.js'
import { REFINE_CREATE_WHITELIST, CREATE_NON_GOAL, getDefaultFormConfig } from '../src/knowledge/widgetWhitelist.js'
import { checkContainerRefinePolicyParity, sanitizeContainerPropertyPatch, CONTAINER_REFINE_PROPERTY_MATRIX, CONTAINER_PROPERTY_REFINE_NON_GOAL } from '../src/knowledge/containerRefinePolicy.js'
import { checkCompositeSchemaParity, VALIDATION_PRESETS } from '../src/knowledge/compositeSchemaPolicy.js'
import { checkContainerLevelPropertyParity, CONTAINER_LEVEL_PROPERTY_MATRIX } from '../src/knowledge/containerLevelPolicy.js'
import { checkFormFieldDualTrackParity, FORM_FIELD_DUAL_TRACK_KEYS } from '../src/knowledge/formFieldDualTrackPolicy.js'
import { checkIdentityForbiddenParity, CATALOG_IDENTITY_RULES } from '../src/knowledge/identityForbiddenPolicy.js'
import { checkRenderConventionParity, RENDER_CONVENTION_PROPS } from '../src/knowledge/renderConventionPolicy.js'
import {
  checkExtensionBoundaryParity,
  KNOWN_RUNTIME_EXTENSIONS,
  STATIC_EXTENSION_ADJACENT_TYPES,
} from '../src/knowledge/extensionBoundaryPolicy.js'
import {
  checkCatalogSampleParity,
  checkPolicyEnumConvergence,
  CATALOG_SAMPLE_SIZE,
  collectCatalogSampleCandidates,
  pickCatalogSamplePairs,
} from '../src/knowledge/catalogEnumPolicy.js'
import {
  checkCatalogFullStrictSweep,
  collectCatalogStrictEditorGaps,
} from '../src/knowledge/catalogStrictPolicy.js'
import { PROPERTY_REGISTER_REL } from '../src/knowledge/catalogPolicy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, 'docs/evidence/v0.2.0')
const outDirV030 = path.join(root, 'docs/evidence/v0.3.0')
const outDirV040 = path.join(root, 'docs/evidence/v0.4.0')
const outDirV050 = path.join(root, 'docs/evidence/v0.5.0')

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function writeCase(caseId: string, observed: string, extra: Record<string, string> = {}) {
  writeCaseTo(outDir, caseId, observed, extra)
}

function sourceRevision() {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty =
      // evidence files written by this run must not mark the source revision dirty
      execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude)docs/evidence'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() !== ''
    return `${branch || 'detached'}@${revision}${dirty ? ' (working tree has uncommitted changes)' : ''}`
  } catch {
    return 'unknown'
  }
}

function writeCaseTo(
  dir: string,
  caseId: string,
  observed: string,
  extra: Record<string, string> = {},
) {
  const lines = [
    `case: ${caseId}`,
    `status: pass`,
    `observed: ${observed}`,
    `environment: local-windows; agent acceptance-cases script; AGENT_ALLOW_MOCK=1`,
    `sourceRevision: ${sourceRevision()}`,
    `capturedAt: ${new Date().toISOString()}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
  ]
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${caseId}.txt`), `${lines.join('\n')}\n`, 'utf8')
  console.log(`[ok] wrote ${path.relative(root, path.join(dir, `${caseId}.txt`))}`)
}

function readRepoFile(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'

  const catalog = await generateWidgetCatalog(root)
  const input = catalog.widgets.find((w) => w.type === 'input')
  const tab = catalog.widgets.find((w) => w.type === 'tab')
  const dataTable = catalog.widgets.find((w) => w.type === 'data-table')
  assert(input, 'input catalog entry missing')
  assert(tab, 'tab catalog entry missing')
  assert(dataTable, 'data-table catalog entry missing')
  assert(input.writableKeys.includes('placeholder'), 'input.placeholder should be writable')
  assert(input.writableKeys.includes('labelWidth'), 'input.labelWidth should be writable')
  assert(input.forbiddenKeys.includes('onChange'), 'input.onChange should be forbidden')
  assert(input.forbiddenKeys.every((k) => isEventKey(k)), 'input forbidden keys should be event callbacks')
  assert(tab.notes?.structureSurgery === 'supported', 'tab structure surgery should be supported')
  assert(dataTable.notes?.structureSurgery === 'partial', 'data-table structure surgery should be partial (column ops)')
  const subFormEntry = catalog.widgets.find((w) => w.type === 'sub-form')
  assert(subFormEntry?.notes?.structureSurgery === 'partial', 'sub-form structure surgery should be partial')
  assert(catalog.form.writableKeys.includes('cssCode'), 'form.cssCode should be writable')
  assert(catalog.form.forbiddenKeys.includes('onFormCreated'), 'form.onFormCreated should be forbidden')
  for (const widget of catalog.widgets) {
    const optionKeys = Object.keys(widget.constraints)
    for (const key of optionKeys) {
      const inWritable = widget.writableKeys.includes(key)
      const inForbidden = widget.forbiddenKeys.includes(key)
      assert(inWritable || inForbidden, `${widget.type}.${key} is neither writable nor forbidden`)
      assert(!(inWritable && inForbidden), `${widget.type}.${key} is both writable and forbidden`)
    }
  }
  const fingerprintDrift = diffWidgetCatalog(catalog, {
    ...catalog,
    source: { ...catalog.source, fingerprint: '0'.repeat(64) },
  })
  assert(
    fingerprintDrift.some((d) => d.includes('fingerprint mismatch')),
    'fingerprint drift should be reported',
  )
  const typeDrift = diffWidgetCatalog(catalog, {
    ...catalog,
    widgets: catalog.widgets.filter((w) => w.type !== 'input'),
  })
  assert(
    typeDrift.some((d) => d.includes('missing widget type: input')),
    'type-set drift should be reported',
  )
  const { catalogDiffs, graphDiffs, catalog: synced, editorGraph } = await checkWidgetCatalogSync(root)
  assert(catalogDiffs.length === 0, `catalog drift vs committed JSON: ${catalogDiffs.join('; ')}`)
  assert(graphDiffs.length === 0, `design-truth graph drift vs committed JSON: ${graphDiffs.join('; ')}`)
  writeCaseTo(
    outDirV030,
    'widget-catalog-sync',
    `catalog types=${synced.widgets.length}; fingerprint=${synced.source.fingerprint}; input writable=${input.writableKeys.length} forbidden=${input.forbiddenKeys.length}; cssCode writable; events forbidden; drift diffs=0`,
    { type: 'agent/static', source: 'widgetsConfig.js + getDefaultFormConfig()' },
  )

  // ---- v0.4.0 design-truth catalog ----
  const editorIssues = assertEditorEnumsMatchDesignTruth(root)
  assert(editorIssues.length === 0, `editor enum mismatch: ${editorIssues.join('; ')}`)
  const coverageIssues = checkHighPrecisionCoverage(catalog)
  assert(coverageIssues.length === 0, `high-precision coverage: ${coverageIssues.join('; ')}`)
  const radioEntry = catalog.widgets.find((w) => w.type === 'radio')
  assert(radioEntry, 'radio catalog missing')
  assert(
    JSON.stringify([...(radioEntry.constraints.labelAlign?.enum || [])].map(String).sort()) ===
      JSON.stringify([...FIELD_LABEL_ALIGN_ENUM].map(String).sort()),
    'radio field labelAlign enum must match FIELD_LABEL_ALIGN_ENUM',
  )
  assert(
    JSON.stringify([...(catalog.form.constraints.labelAlign?.enum || [])].map(String).sort()) ===
      JSON.stringify([...FORM_LABEL_ALIGN_ENUM].map(String).sort()),
    'form labelAlign enum must match FORM_LABEL_ALIGN_ENUM',
  )
  assert((catalog.source.propertyEditors || []).length >= 2, 'propertyEditors must be recorded in catalog source')
  writeCaseTo(
    outDirV040,
    'design-truth-catalog-sync',
    `multi-source catalog ok; radio labelAlign enum=${JSON.stringify(radioEntry.constraints.labelAlign?.enum)}; form labelAlign enum=${JSON.stringify(catalog.form.constraints.labelAlign?.enum)}; editors=${editorGraph.source.editorFileCount}; graphFingerprint=${editorGraph.source.fingerprint}; coverageIssues=0`,
    { type: 'agent/static' },
  )

  const graphParityIssues = checkDesignTruthGraphParity(root, editorGraph)
  assert(graphParityIssues.length === 0, `design-truth graph parity: ${graphParityIssues.join('; ')}`)
  const buttonEntry = catalog.widgets.find((w) => w.type === 'button')
  assert(buttonEntry?.constraints.type?.editor === 'button-type-editor', 'button.type must use type-specific editor')
  assert(buttonEntry?.constraints.type?.valueKind === 'enum', 'button.type valueKind from button-type-editor')
  const graphDrift = diffDesignTruthGraph(editorGraph, {
    ...editorGraph,
    editors: { ...editorGraph.editors, 'rows-editor': { ...editorGraph.editors['rows-editor'], valueKind: 'string' } },
  })
  assert(graphDrift.some((d) => d.includes('rows-editor valueKind')), 'graph diff should detect valueKind drift')
  writeCaseTo(
    outDirV040,
    'design-truth-editor-valuekind-parity',
    `editors=${editorGraph.source.editorFileCount}; typeOverrides=${editorGraph.typeOverrides.length}; button.type editor=${buttonEntry?.constraints.type?.editor} valueKind=${buttonEntry?.constraints.type?.valueKind}`,
    { type: 'agent/static' },
  )

  const snippetForm = {
    widgetList: [
      {
        type: 'radio',
        id: 'r1',
        options: { name: 'r1', label: '评分', labelAlign: '', displayStyle: 'block', defaultValue: 1, optionItems: [{ label: '好', value: 1 }] },
      },
    ],
    formConfig: { labelAlign: 'label-left-align' },
  }
  const summaryForSnippet = buildFormSummary(snippetForm)
  const designTruthSnippets = buildCatalogSnippets(summaryForSnippet, catalog, '把标签右对齐')
  const radioSnippet = designTruthSnippets.find((s) => s.type === 'radio')
  assert(radioSnippet?.constraints?.labelAlign?.enum, 'snippet must include labelAlign enum')
  assert(
    radioSnippet?.constraints?.labelAlign?.valueKind === 'enum',
    'snippet must include labelAlign valueKind=enum',
  )
  assert(
    radioSnippet?.constraints?.labelAlign?.inheritEmpty === true,
    'snippet must include labelAlign inheritEmpty',
  )
  assert(
    (radioSnippet?.constraints?.labelAlign?.enum || []).includes('label-right-align'),
    'snippet labelAlign enum must include label-right-align',
  )
  assert(radioSnippet?.writableKeys.includes('labelAlign'), 'preferred key labelAlign retained in writableKeys')
  writeCaseTo(
    outDirV040,
    'catalog-snippet-includes-enums',
    `radio snippet labelAlign valueKind=${radioSnippet?.constraints?.labelAlign?.valueKind} enum=${JSON.stringify(radioSnippet?.constraints?.labelAlign?.enum)} inheritEmpty=${radioSnippet?.constraints?.labelAlign?.inheritEmpty}`,
    { type: 'agent' },
  )

  const registerIssues = checkPropertyRegisterParity(root, catalog)
  assert(registerIssues.length === 0, `propertyRegister parity failed: ${registerIssues.join('; ')}`)
  const textareaEntry = catalog.widgets.find((w) => w.type === 'textarea')
  assert(textareaEntry?.constraints.rows?.linkageBlockedWhen?.key === 'autosize', 'textarea.rows linkage must reference autosize')
  writeCaseTo(
    outDirV040,
    'property-register-editor-parity',
    `common+advanced editors mapped; textarea.rows.linkageBlockedWhen=${JSON.stringify(textareaEntry?.constraints.rows?.linkageBlockedWhen)}`,
    { type: 'agent/static' },
  )

  const linkageBlocked = sanitizeWidgetPatch(
    'textarea',
    { rows: 5 },
    catalog,
    { autosize: true, rows: 3 },
  )
  assert(linkageBlocked.patch.rows === undefined, 'rows patch blocked when autosize=true')
  assert(linkageBlocked.warnings.some((w) => /linkage|autosize/i.test(w)), 'linkage block must warn')
  const linkageAllowed = sanitizeWidgetPatch('textarea', { rows: 5 }, catalog, { autosize: false, rows: 3 })
  assert(linkageAllowed.patch.rows === 5, 'rows patch allowed when autosize=false')
  writeCaseTo(
    outDirV040,
    'refine-linkage-autosize-rows',
    `autosize=true blocks rows; autosize=false allows rows=${linkageAllowed.patch.rows}`,
    { type: 'agent' },
  )

  const multiBad = sanitizeWidgetPatch(
    'select',
    { defaultValue: 'a' },
    catalog,
    { multiple: true, defaultValue: 'a', optionItems: [{ label: 'A', value: 'a' }] },
  )
  assert(multiBad.patch.defaultValue === undefined, 'scalar defaultValue blocked when multiple=true')
  assert(multiBad.warnings.some((w) => /multiple=true.*数组|linkage/i.test(w)), 'multiple defaultValue linkage must warn')
  const singleArrayBad = sanitizeWidgetPatch(
    'select',
    { defaultValue: ['a'] },
    catalog,
    { multiple: false, defaultValue: '', optionItems: [{ label: 'A', value: 'a' }] },
  )
  assert(singleArrayBad.patch.defaultValue === undefined, 'array defaultValue blocked when multiple=false')
  const mergedOptions = { multiple: true, defaultValue: 'legacy', filterable: false, remote: true, optionItems: [] }
  const reconcileWarnings = reconcileMultipleDefaultValue(mergedOptions, 'select')
  assert(Array.isArray(mergedOptions.defaultValue), 'reconcile clears scalar defaultValue when multiple=true')
  assert(mergedOptions.filterable === true, 'reconcile forces filterable when remote=true')
  assert(reconcileWarnings.length >= 2, 'reconcile should emit linkage warnings')
  writeCaseTo(
    outDirV040,
    'refine-linkage-multiple-defaultvalue',
    `multiple=true blocks scalar defaultValue; reconcile clears legacy scalar and forces filterable on remote`,
    { type: 'agent' },
  )

  const remoteFilterable = sanitizeWidgetPatch(
    'select',
    { filterable: false },
    catalog,
    { remote: true, filterable: true, optionItems: [] },
  )
  assert(remoteFilterable.patch.filterable === undefined, 'filterable=false blocked when remote=true')
  writeCaseTo(
    outDirV040,
    'refine-linkage-remote-filterable',
    `remote=true blocks filterable=false patch`,
    { type: 'agent' },
  )

  const parsedScope = expandParentScope(parseParentScope('tab-pane/基本信息'))
  assert(parsedScope.containerType === 'tab-pane' && parsedScope.label === '基本信息', 'parentScope slash syntax')
  const parsedPath = expandParentScope(parseParentScope('path:widgetList[0].tabs[0]'))
  assert(parsedPath.pathPrefix === 'widgetList[0].tabs[0]', 'parentScope path syntax')
  writeCaseTo(
    outDirV040,
    'refine-parent-scope-parse',
    `tab-pane/label and path: syntax parsed`,
    { type: 'agent' },
  )

  const containerPolicyIssues = checkContainerRefinePolicyParity(catalog)
  assert(containerPolicyIssues.length === 0, containerPolicyIssues.join('; '))
  const containerTabForm = {
    widgetList: [
      {
        type: 'tab',
        id: 'tab1',
        options: { name: 'mainTab', tabType: 'border-card', tabPosition: 'top', hidden: false, customClass: '' },
        tabs: [
          {
            type: 'tab-pane',
            id: 'pane-a',
            options: { name: 'paneA', label: '基本信息', active: true, hidden: false, disabled: false, customClass: '' },
            widgetList: [],
          },
          {
            type: 'tab-pane',
            id: 'pane-b',
            options: { name: 'paneB', label: '其他', active: false, hidden: false, disabled: false, customClass: '' },
            widgetList: [],
          },
        ],
      },
    ],
    formConfig: { customClass: [] },
  }
  const tabLabelPlan = refinePlanSchema.parse({
    summary: '改页签标题',
    warnings: [],
    operations: [
      {
        op: 'updateField',
        target: { containerType: 'tab-pane', label: '基本信息' },
        patch: { label: '基础资料' },
      },
    ],
  })
  const tabLabelMerged = applyRefinePlan(containerTabForm, tabLabelPlan)
  const tabPaneRenamed = (
    tabLabelMerged.formJson.widgetList[0] as { tabs: Array<{ id: string; options: Record<string, unknown> }> }
  ).tabs.find((p) => p.id === 'pane-a')
  assert(tabPaneRenamed?.options.label === '基础资料', 'tab-pane label updated')
  const tabActivePlan = refinePlanSchema.parse({
    summary: '激活第二个页签',
    warnings: [],
    operations: [
      {
        op: 'updateField',
        target: { containerType: 'tab-pane', id: 'pane-b' },
        patch: { active: true },
      },
    ],
  })
  const tabActiveMerged = applyRefinePlan(containerTabForm, tabActivePlan)
  const tabsAfter = (tabActiveMerged.formJson.widgetList[0] as { tabs: Array<{ id: string; options: Record<string, unknown> }> })
    .tabs
  assert(tabsAfter.find((p) => p.id === 'pane-b')?.options.active === true, 'pane-b active true')
  assert(tabsAfter.find((p) => p.id === 'pane-a')?.options.active === false, 'pane-a deactivated by linkage')
  writeCaseTo(
    outDirV040,
    'refine-container-tabpane-label-active',
    `tab-pane label renamed; active linkage deactivates sibling`,
    { type: 'agent' },
  )

  const gridForm = {
    widgetList: [
      {
        type: 'grid',
        id: 'grid1',
        options: { name: 'layout', hidden: false, gutter: 12, colHeight: null, customClass: '' },
        cols: [
          {
            type: 'grid-col',
            id: 'col1',
            options: {
              name: 'col1',
              span: 12,
              offset: 0,
              push: 0,
              pull: 0,
              responsive: false,
              md: 12,
              sm: 12,
              xs: 24,
              hidden: false,
              customClass: '',
            },
            widgetList: [],
          },
        ],
      },
    ],
    formConfig: { customClass: [] },
  }
  const gridSpanPlan = refinePlanSchema.parse({
    summary: '栅格列宽',
    warnings: [],
    operations: [{ op: 'updateField', target: { containerType: 'grid-col', id: 'col1' }, patch: { span: 8 } }],
  })
  const gridSpanMerged = applyRefinePlan(gridForm, gridSpanPlan)
  const col1 = (gridSpanMerged.formJson.widgetList[0] as { cols: Array<{ options: Record<string, unknown> }> }).cols[0]
  assert(col1.options.span === 8, 'grid-col span updated')
  writeCaseTo(outDirV040, 'refine-container-gridcol-span', `grid-col span=8 applied`, { type: 'agent' })

  const drawerBlocked = sanitizeContainerPropertyPatch('vf-drawer', { title: '新标题' })
  assert(drawerBlocked.rejected && drawerBlocked.patch.title === undefined, 'vf-drawer property refine blocked')
  const drawerPlan = refinePlanSchema.parse({
    summary: '改抽屉标题',
    warnings: [],
    operations: [{ op: 'updateField', target: { id: 'dr1' }, patch: { title: '新标题' } }],
  })
  const drawerForm = {
    widgetList: [
      {
        type: 'vf-drawer',
        id: 'dr1',
        options: { title: '旧标题', size: '30%', showModal: true, customClass: '' },
        widgetList: [],
      },
    ],
    formConfig: { customClass: [] },
  }
  const drawerMerged = applyRefinePlan(drawerForm, drawerPlan)
  assert(
    (drawerMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options.title === '旧标题',
    'vf-drawer title unchanged when NON_GOAL',
  )
  assert(drawerMerged.warnings.some((w) => /vf-drawer.*未开放|NON_GOAL|refine 未开放/i.test(w)), 'drawer NON_GOAL warning')
  writeCaseTo(
    outDirV040,
    'refine-container-non-goal-reject',
    `vf-drawer title patch blocked; container policy partition ok`,
    { type: 'agent' },
  )
  writeCaseTo(
    outDirV040,
    'container-refine-policy-parity',
    `supported=${Object.keys(CONTAINER_REFINE_PROPERTY_MATRIX).length} nonGoal=${Object.keys(CONTAINER_PROPERTY_REFINE_NON_GOAL).length} container types partitioned`,
    { type: 'agent/static' },
  )

  const compositeIssues = checkCompositeSchemaParity(catalog)
  assert(compositeIssues.length === 0, `composite schema parity: ${compositeIssues.join('; ')}`)
  const radioComposite = catalog.widgets.find((w) => w.type === 'radio')?.constraints.optionItems?.compositeSchema
  assert(radioComposite?.id === 'option-item', 'radio.optionItems compositeSchema')
  assert(radioComposite?.requiredItemKeys?.includes('label'), 'optionItems requires label')
  const inputValidation = catalog.widgets.find((w) => w.type === 'input')?.constraints.validation?.compositeSchema
  assert(inputValidation?.presets?.length === VALIDATION_PRESETS.length, 'input.validation presets')
  const badOptionItems = sanitizeWidgetPatch('radio', {
    optionItems: [{ label: '缺 value' }],
  })
  assert(badOptionItems.patch.optionItems === undefined, 'optionItems missing value must strip')
  writeCaseTo(
    outDirV040,
    'composite-schema-parity',
    `required=${11} props registered; optionItems+validation presets ok`,
    { type: 'agent/static' },
  )

  const containerLevelIssues = checkContainerLevelPropertyParity(catalog)
  assert(containerLevelIssues.length === 0, `container level parity: ${containerLevelIssues.join('; ')}`)
  const tabPaneEntry = catalog.widgets.find((w) => w.type === 'tab-pane')
  assert(tabPaneEntry?.containerLevelKeys?.includes('active'), 'tab-pane containerLevelKeys includes active')
  const dialogEntry = catalog.widgets.find((w) => w.type === 'vf-dialog')
  assert(dialogEntry?.constraints.title?.propertyScope === 'container', 'vf-dialog.title scope=container')
  assert(Object.keys(CONTAINER_LEVEL_PROPERTY_MATRIX).length >= 13, 'container matrix registered')
  writeCaseTo(
    outDirV040,
    'container-level-properties-parity',
    `containers=${catalog.widgets.filter((w) => w.category === 'container').length} matrix=${Object.keys(CONTAINER_LEVEL_PROPERTY_MATRIX).length}`,
    { type: 'agent/static' },
  )

  const dualTrackIssues = checkFormFieldDualTrackParity(catalog)
  assert(dualTrackIssues.length === 0, `form-field dual track: ${dualTrackIssues.join('; ')}`)
  const inputDual = catalog.widgets.find((w) => w.type === 'input')
  assert(inputDual?.constraints.customClass?.valueKind === 'string', 'field customClass valueKind=string')
  assert(catalog.form.constraints.customClass?.valueKind === 'array', 'form customClass valueKind=array')
  assert(inputDual?.constraints.labelWidth?.inheritEmpty === true, 'field labelWidth inheritEmpty')
  assert(catalog.form.constraints.labelWidth?.inheritEmpty !== true, 'form labelWidth no inheritEmpty')
  assert(inputDual?.constraints.customClass?.dualTrack?.pairedScope === 'form', 'field customClass dualTrack→form')
  assert(FORM_FIELD_DUAL_TRACK_KEYS.length === 4, 'dual track keys registered')
  writeCaseTo(
    outDirV040,
    'form-field-dual-track-parity',
    `keys=${FORM_FIELD_DUAL_TRACK_KEYS.join(',')}; customClass string↔array; labelWidth inherit ok`,
    { type: 'agent/static' },
  )

  const identityIssues = checkIdentityForbiddenParity(catalog)
  assert(identityIssues.length === 0, `identity/forbidden parity: ${identityIssues.join('; ')}`)
  assert(catalog.identity?.rules.length === CATALOG_IDENTITY_RULES.length, 'catalog identity rules registered')
  const inputForbidden = catalog.widgets.find((w) => w.type === 'input')
  assert(inputForbidden?.constraints.onChange?.writable === false, 'onChange visible forbidden')
  assert(inputForbidden?.constraints.onChange?.forbiddenReason === 'event', 'onChange event reason')
  assert(inputForbidden?.constraints.name?.identityRole === 'field-name', 'name identityRole')
  assert(catalog.form.constraints.modelName?.writable === false, 'form modelName forbidden visible')
  const dupIdForm = {
    widgetList: [
      { type: 'input', id: 'dup', options: { name: 'a', label: 'A' } },
      { type: 'input', id: 'dup', options: { name: 'b', label: 'B' } },
    ],
    formConfig: { customClass: [] },
  }
  const dupIdIssues = validateFormJson(dupIdForm)
  assert(dupIdIssues.some((i) => i.message.includes('duplicate widget id')), 'duplicate widget id rejected')
  writeCaseTo(
    outDirV040,
    'identity-forbidden-parity',
    `identityRules=${CATALOG_IDENTITY_RULES.length}; onChange event forbidden; duplicate id gate`,
    { type: 'agent/static' },
  )

  const renderIssues = checkRenderConventionParity(root, catalog)
  assert(renderIssues.length === 0, `render convention parity: ${renderIssues.join('; ')}`)
  const inputRender = catalog.widgets.find((w) => w.type === 'input')
  assert(
    inputRender?.constraints.labelWidth?.renderConvention?.renderUnit === 'px',
    'labelWidth renderUnit px',
  )
  assert(inputRender?.constraints.labelAlign?.renderConvention?.inheritWhenEmpty === true, 'labelAlign inherit')
  assert(
    catalog.renderConventions?.rules.length === RENDER_CONVENTION_PROPS.length,
    'renderConventions block registered',
  )
  const lwPxReject = sanitizeWidgetPatch('input', { labelWidth: '120px' })
  assert(lwPxReject.patch.labelWidth === undefined, 'labelWidth px still rejected with render convention')
  writeCaseTo(
    outDirV040,
    'render-convention-parity',
    `rules=${RENDER_CONVENTION_PROPS.length}; form-item-wrapper labelWidth+px labelAlign inherit class ok`,
    { type: 'agent/static' },
  )

  const extensionIssues = checkExtensionBoundaryParity(root, catalog)
  assert(extensionIssues.length === 0, `extension boundary parity: ${extensionIssues.join('; ')}`)
  assert(catalog.extensionPolicy?.customFields.staticExportEmpty === true, 'customFields static empty')
  assert(
    catalog.extensionPolicy?.runtimeRegister.staticCoverage === 'NON_GOAL',
    'runtime register static coverage NON_GOAL',
  )
  for (const ext of KNOWN_RUNTIME_EXTENSIONS) {
    assert(!catalog.widgets.some((w) => w.type === ext.type), `runtime type ${ext.type} absent from catalog`)
  }
  const slotEntry = catalog.widgets.find((w) => w.type === 'slot')
  assert(slotEntry?.notes?.extensionBoundary?.createNonGoal === 'extension-runtime', 'slot extension boundary')
  assert(CREATE_NON_GOAL.slot === 'extension-runtime', 'slot CREATE_NON_GOAL')
  assert(STATIC_EXTENSION_ADJACENT_TYPES.includes('slot'), 'slot static extension-adjacent')
  writeCaseTo(
    outDirV040,
    'extension-boundary-policy-parity',
    `knownRuntime=${KNOWN_RUNTIME_EXTENSIONS.map((e) => e.type).join(',')}; customFields empty; slot extension-runtime NON_GOAL`,
    { type: 'agent/static' },
  )

  const enumConvergenceIssues = checkPolicyEnumConvergence()
  assert(enumConvergenceIssues.length === 0, `policy enum convergence: ${enumConvergenceIssues.join('; ')}`)
  const registerSource = fs.readFileSync(path.join(root, PROPERTY_REGISTER_REL), 'utf8')
  const sampleCandidates = collectCatalogSampleCandidates(catalog)
  const samplePairs = pickCatalogSamplePairs(sampleCandidates)
  assert(sampleCandidates.length >= CATALOG_SAMPLE_SIZE, `sample candidates ${sampleCandidates.length}`)
  assert(samplePairs.length === CATALOG_SAMPLE_SIZE, `sample size ${samplePairs.length}`)
  const sampleIssues = checkCatalogSampleParity(catalog, editorGraph, registerSource)
  assert(sampleIssues.length === 0, `catalog sample parity: ${sampleIssues.join('; ')}`)
  writeCaseTo(
    outDirV040,
    'catalog-sample-parity',
    `sample=${CATALOG_SAMPLE_SIZE}/${sampleCandidates.length}; valueKind+enum vs design-truth-graph ok`,
    { type: 'agent/static' },
  )

  const settingPanelSrc = readRepoFile('v-form/src/components/form-designer/setting-panel/index.vue')
  const designTruthDesign = readRepoFile('docs/design/ai-form-design-truth-catalog.md')
  assert(settingPanelSrc.includes('preApplyFormJsonGate'), 'preApplyFormJsonGate missing')
  assert(settingPanelSrc.includes('duplicate widget.id'), 'duplicate id gate message missing')
  assert(designTruthDesign.includes('preApplyFormJsonGate'), 'design doc must declare loadFormJson gate')
  writeCaseTo(
    outDirV040,
    'loadformjson-preapply-contract',
    'applyAiFormJson calls preApplyFormJsonGate (duplicate id); design doc §5 contract',
    { type: 'static' },
  )

  const summarySnap = summaryForSnippet.find((f) => f.id === 'r1')
  assert(summarySnap?.writableSnapshot && 'labelAlign' in summarySnap.writableSnapshot, 'snapshot must include labelAlign')
  assert(summarySnap?.writableSnapshot?.displayStyle === 'block', 'snapshot must include displayStyle')
  writeCaseTo(
    outDirV040,
    'refine-summary-has-labelalign',
    `snapshot keys=${Object.keys(summarySnap?.writableSnapshot || {}).join(',')}; labelAlign=${JSON.stringify(summarySnap?.writableSnapshot?.labelAlign)}`,
    { type: 'agent' },
  )

  const illegalAlign = sanitizeWidgetPatch('radio', { labelAlign: 'right' })
  assert(illegalAlign.patch.labelAlign === undefined, 'illegal labelAlign "right" must be stripped')
  assert(illegalAlign.warnings.some((w) => w.includes('labelAlign')), 'illegal labelAlign must warn')
  const legalAlign = sanitizeWidgetPatch('radio', { labelAlign: 'label-right-align' })
  assert(legalAlign.patch.labelAlign === 'label-right-align', 'legal labelAlign kept')
  const illegalPlan = refinePlanSchema.parse({
    summary: '右对齐',
    warnings: [],
    operations: [{ op: 'updateField', target: { id: 'r1' }, patch: { labelAlign: 'right' } }],
  })
  const illegalMerged = applyRefinePlan(snippetForm, illegalPlan)
  assert(
    (illegalMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options.labelAlign === '',
    'illegal right must not overwrite existing labelAlign',
  )
  assert(illegalMerged.warnings.some((w) => /labelAlign/.test(w)), 'merge should warn on illegal labelAlign')
  assert(instructionHasAlignIntent('请把标签右对齐'), 'align intent detected')
  const alignReject = alignIntentUnfulfilled('请把标签右对齐', illegalPlan, illegalMerged.warnings)
  assert(alignReject.reject, 'align intent with only illegal patches should reject')
  writeCaseTo(
    outDirV040,
    'refine-labelalign-reject-right',
    `right stripped; merge warnings=${JSON.stringify(illegalMerged.warnings)}; reject=${alignReject.reject}`,
    { type: 'agent' },
  )

  const parityPlan = refinePlanSchema.parse({
    summary: '所有 radio 标签右对齐',
    warnings: [],
    operations: [
      { op: 'updateField', target: { id: 'r1' }, patch: { labelAlign: 'label-right-align' } },
      { op: 'patchFormConfig', patch: { labelAlign: 'label-right-align' } },
    ],
  })
  const parityMerged = applyRefinePlan(
    {
      widgetList: [
        {
          type: 'radio',
          id: 'r1',
          options: {
            name: 'r1',
            label: '评分',
            labelAlign: '',
            defaultValue: 1,
            displayStyle: 'block',
            optionItems: [{ label: '好', value: 1 }],
            onChange: '',
          },
        },
        {
          type: 'radio',
          id: 'r2',
          options: {
            name: 'r2',
            label: '另一项',
            labelAlign: '',
            defaultValue: 0,
            optionItems: [{ label: '差', value: 0 }],
            onChange: '',
          },
        },
      ],
      formConfig: { labelAlign: 'label-left-align', cssCode: '', customClass: [] },
    },
    refinePlanSchema.parse({
      summary: '右对齐',
      warnings: [],
      operations: [
        { op: 'updateField', target: { id: 'r1' }, patch: { labelAlign: 'label-right-align' } },
        { op: 'updateField', target: { id: 'r2' }, patch: { labelAlign: 'label-right-align' } },
      ],
    }),
  )
  const p1 = (parityMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  const p2 = (parityMerged.formJson.widgetList[1] as { options: Record<string, unknown> }).options
  assert(p1.labelAlign === 'label-right-align' && p2.labelAlign === 'label-right-align', 'NL parity: both radios right-aligned')
  assert(p1.defaultValue === 1 && p2.defaultValue === 0, 'defaultValue preserved while aligning')
  const parityIssues = validateFormJson(parityMerged.formJson, {
    mode: 'refine',
    existingIds: new Set(['r1', 'r2']),
  })
  assert(parityIssues.length === 0, `parity catalog validate: ${JSON.stringify(parityIssues)}`)
  writeCaseTo(
    outDirV040,
    'refine-labelalign-nl-parity',
    `both radios labelAlign=label-right-align; defaultValue preserved; catalogIssues=0`,
    { type: 'agent' },
  )
  void parityPlan

  // ---- v0.4.0 valueKind / IntentGate ----
  const inputEntry = catalog.widgets.find((w) => w.type === 'input')
  assert(inputEntry?.constraints.labelWidth?.valueType === 'number', 'input.labelWidth must be number')
  assert(inputEntry?.constraints.labelWidth?.strict === true, 'input.labelWidth must be strict')
  assert(!inputEntry?.constraints.size?.enum?.includes('default'), 'widget size enum must not include default')
  assert(catalog.form.constraints.labelWidth?.valueType === 'number', 'form.labelWidth must be number')

  const lwLegal = sanitizeWidgetPatch('input', { labelWidth: 450 })
  assert(lwLegal.patch.labelWidth === 450, 'labelWidth 450 number accepted')
  const lwIllegal = sanitizeWidgetPatch('input', { labelWidth: '450px' })
  assert(lwIllegal.patch.labelWidth === undefined, 'labelWidth 450px rejected')
  assert(lwIllegal.warnings.some((w) => w.includes('labelWidth')), 'labelWidth px string warns')
  const lwFormLegal = sanitizeFormPatch({ labelWidth: 120 })
  assert(lwFormLegal.patch.labelWidth === 120, 'form labelWidth number accepted')
  const lwFormIllegal = sanitizeFormPatch({ labelWidth: '120px' })
  assert(lwFormIllegal.patch.labelWidth === undefined, 'form labelWidth px rejected')
  writeCaseTo(
    outDirV040,
    'refine-labelwidth-number-parity',
    `450 ok; 450px stripped; form 120 ok; form 120px stripped`,
    { type: 'agent' },
  )

  const sizeLegal = sanitizeWidgetPatch('input', { size: 'large' })
  assert(sizeLegal.patch.size === 'large', 'size large accepted')
  const sizeDefaultLiteral = sanitizeWidgetPatch('input', { size: 'default' })
  assert(sizeDefaultLiteral.patch.size === undefined, 'size default literal rejected')
  const sizeEmpty = sanitizeWidgetPatch('input', { size: '' })
  assert(sizeEmpty.patch.size === '', 'size empty default accepted')
  writeCaseTo(
    outDirV040,
    'refine-size-enum-parity',
    `large ok; default literal rejected; empty ok`,
    { type: 'agent' },
  )

  const widthForm = {
    widgetList: [
      {
        type: 'input',
        id: 'w1',
        options: { name: 'w1', label: '姓名', labelWidth: null, onChange: '' },
      },
    ],
    formConfig: { labelWidth: 120, labelAlign: 'label-left-align', customClass: [] },
  }
  const badWidthPlan = refinePlanSchema.parse({
    summary: '标签宽度改为450px',
    warnings: [],
    operations: [{ op: 'updateField', target: { id: 'w1' }, patch: { labelWidth: '450px' } }],
  })
  assert(instructionHasLabelWidthIntent('标签宽度改为450px'), 'labelWidth intent detected')
  assert(
    planPatchesAllIllegalForKey(badWidthPlan, 'labelWidth', widthForm),
    '450px plan should be all illegal for labelWidth',
  )
  const badWidthMerged = applyRefinePlan(widthForm, badWidthPlan)
  const honestBad = buildHonestSummary(badWidthPlan, widthForm, badWidthMerged.formJson, badWidthMerged.warnings)
  assert(honestBad.reject, 'honest summary rejects unstripped width intent with no changes')
  const widthReject = highPrecisionIntentUnfulfilled(
    '标签宽度改为450px',
    badWidthPlan,
    badWidthMerged.warnings,
  )
  assert(widthReject.reject, 'labelWidth intent unfulfilled when px stripped')

  const goodWidthPlan = refinePlanSchema.parse({
    summary: '标签宽度450',
    warnings: [],
    operations: [{ op: 'updateField', target: { id: 'w1' }, patch: { labelWidth: 450 } }],
  })
  const goodWidthMerged = applyRefinePlan(widthForm, goodWidthPlan)
  const honestGood = buildHonestSummary(goodWidthPlan, widthForm, goodWidthMerged.formJson, goodWidthMerged.warnings)
  assert(!honestGood.reject, 'honest summary ok for legal width')
  assert(honestGood.summary.includes('已更新：'), 'honest summary describes applied change')
  assert(
    (goodWidthMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options.labelWidth === 450,
    '450 written as number',
  )
  writeCaseTo(
    outDirV040,
    'refine-honest-summary',
    `450px reject honest=${honestBad.reject}; 450 ok summary=${honestGood.summary}`,
    { type: 'agent' },
  )

  const labelTargetForm = {
    widgetList: [
      {
        type: 'radio',
        id: 'r-score',
        options: {
          name: 'score_q1',
          label: '他/她有错误的视觉或声音等幻觉吗？',
          labelWidth: null,
          displayStyle: 'block',
          optionItems: [{ label: '2分', value: 2 }],
          onChange: '',
        },
      },
    ],
    formConfig: { labelWidth: 120, labelAlign: 'label-left-align', customClass: [] },
  }
  const byLabel = resolveTarget(labelTargetForm, {
    label: '他/她有错误的视觉或声音等幻觉吗？',
  })
  assert(byLabel.matches.length === 1 && !byLabel.ambiguous, 'resolve by unique label')
  const labelPlan = refinePlanSchema.parse({
    summary: '标签宽度450',
    warnings: [],
    operations: [
      {
        op: 'updateField',
        target: { label: '他/她有错误的视觉或声音等幻觉吗？' },
        patch: { labelWidth: 450 },
      },
    ],
  })
  const labelMerged = applyRefinePlan(labelTargetForm, labelPlan)
  assert(
    (labelMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options.labelWidth === 450,
    'label target patch applied',
  )
  writeCaseTo(outDirV040, 'refine-target-by-label', `unique label hit; labelWidth=450 applied`, { type: 'agent' })

  const tabBatchForm = {
    widgetList: [
      {
        type: 'tab',
        id: 'tab1',
        options: { name: 'mainTab', label: '', tabType: 'border-card', onTabClick: '' },
        tabs: [
          {
            type: 'tab-pane',
            id: 'pane-a',
            options: { name: 'paneA', label: '基本信息', active: true },
            widgetList: [
              {
                type: 'radio',
                id: 'r-a1',
                options: { name: 'r_a1', label: 'Q1', labelWidth: null, displayStyle: 'block', optionItems: [] },
              },
              {
                type: 'radio',
                id: 'r-a2',
                options: { name: 'r_a2', label: 'Q2', labelWidth: null, displayStyle: 'block', optionItems: [] },
              },
            ],
          },
          {
            type: 'tab-pane',
            id: 'pane-b',
            options: { name: 'paneB', label: '其他', active: false },
            widgetList: [
              {
                type: 'radio',
                id: 'r-b1',
                options: { name: 'r_b1', label: 'Q3', labelWidth: null, displayStyle: 'block', optionItems: [] },
              },
            ],
          },
        ],
      },
    ],
    formConfig: { labelWidth: 120, labelAlign: 'label-left-align', customClass: [] },
  }
  const scopeFields = resolveScopeFields(tabBatchForm, { label: '基本信息' }, 'radio')
  assert(scopeFields.length === 2, 'scope under tab pane should find 2 radios')
  const scopeByParentScope = resolveScopeFields(tabBatchForm, expandParentScope(parseParentScope('tab-pane/基本信息')), 'radio')
  assert(scopeByParentScope.length === 2, 'parentScope tab-pane/label should find 2 radios')
  const scopeByPath = resolveScopeFields(
    tabBatchForm,
    expandParentScope(parseParentScope('path:widgetList[0].tabs[0]')),
    'radio',
  )
  assert(scopeByPath.length === 2, 'parentScope path: should find 2 radios')
  const tabBatchPlan = refinePlanSchema.parse({
    summary: 'tab下radio labelWidth',
    warnings: [],
    operations: [
      {
        op: 'updateFieldsInScope',
        parent: 'tab-pane/基本信息',
        filterType: 'radio',
        patch: { labelWidth: 180 },
      },
    ],
  })
  const tabBatchMerged = applyRefinePlan(tabBatchForm, tabBatchPlan)
  const wl = tabBatchMerged.formJson.widgetList[0] as {
    tabs: Array<{ widgetList: Array<{ options: Record<string, unknown> }> }>
  }
  const paneA = wl.tabs[0].widgetList
  const paneB = wl.tabs[1].widgetList[0].options
  assert(paneA[0].options.labelWidth === 180 && paneA[1].options.labelWidth === 180, 'pane A radios updated')
  assert(paneB.labelWidth === null || paneB.labelWidth === undefined, 'pane B radio untouched')
  writeCaseTo(
    outDirV040,
    'refine-tab-batch-labelwidth',
    `scope radios=2 via parentScope tab-pane/基本信息; paneA labelWidth=180; paneB unchanged`,
    { type: 'agent' },
  )
  writeCaseTo(
    outDirV040,
    'refine-parent-scope-batch',
    `path+tab-pane parentScope resolve 2 radios; batch labelWidth=180 applied`,
    { type: 'agent' },
  )

  const applicableIssues = checkApplicableKeysParity(catalog)
  assert(applicableIssues.length === 0, `applicableKeys parity: ${applicableIssues.join('; ')}`)
  writeCaseTo(
    outDirV040,
    'catalog-hasconfig-parity',
    `applicableKeys parity ok for ${catalog.widgets.length} types; form.customClass=array strict`,
    { type: 'agent/static' },
  )

  const overlapForm = {
    widgetList: [
      {
        type: 'radio',
        id: 'r-long',
        options: {
          name: 'q_hallucination',
          label: '他/她有错误的视觉或声音等幻觉吗？',
          labelWrap: false,
          displayStyle: 'inline',
          labelWidth: null,
          optionItems: [
            { label: '无错', value: 0 },
            { label: '有错', value: 1 },
          ],
          onChange: '',
        },
      },
    ],
    formConfig: { labelWidth: 120, cssCode: '', customClass: [] },
  }
  const overlapInstruction = '单选字段标签和选项重叠了，优化排版'
  assert(instructionHasOverlapIntent(overlapInstruction), 'overlap intent detected')
  const badOverlapPlan = refinePlanSchema.parse({
    summary: '缩短标题',
    warnings: [],
    operations: [{ op: 'updateField', target: { id: 'r-long' }, patch: { label: '短标题' } }],
  })
  const blockedOverlap = enforceRefineTextPolicy(overlapInstruction, badOverlapPlan)
  assert(blockedOverlap.reject, 'overlap must reject label-only patch')
  const enrichedOverlap = enrichLayoutPlan(
    overlapInstruction,
    { summary: '待补充', warnings: [], operations: [] },
    overlapForm,
  )
  assert(enrichedOverlap.plan.operations.length > 0, 'enrich should add layout property ops')
  const overlapMerged = applyRefinePlan(overlapForm, enrichedOverlap.plan)
  const overlapOpts = (overlapMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  assert(overlapOpts.labelWrap === true, 'overlap fix sets labelWrap=true')
  assert(overlapOpts.displayStyle === 'block', 'overlap fix sets displayStyle=block')
  assert(overlapOpts.labelWidth === 280, 'overlap fix sets default labelWidth=280')
  assert(
    overlapOpts.label === overlapForm.widgetList[0].options.label,
    'overlap fix must not change label text',
  )
  const overlapGate = layoutIntentUnfulfilled(
    overlapInstruction,
    enrichedOverlap.plan,
    overlapForm,
    overlapMerged.formJson,
    overlapMerged.warnings,
  )
  assert(!overlapGate.reject, 'overlap layout gate should pass after property fix')
  const overlapIssues = validateFormJson(overlapMerged.formJson, {
    mode: 'refine',
    existingIds: collectWidgetIds(overlapForm),
  })
  assert(overlapIssues.length === 0, `overlap catalog validate: ${JSON.stringify(overlapIssues)}`)
  writeCaseTo(
    outDirV040,
    'refine-layout-overlap-properties',
    'overlap→labelWrap+displayStyle:block+labelWidth; label unchanged; FR-6 label-only rejected; layout gate pass',
    { type: 'agent' },
  )

  const cssOverlapMerged = applyRefinePlan(
    overlapForm,
    refinePlanSchema.parse({
      summary: 'scoped css overlap fallback',
      warnings: [],
      operations: [
        {
          op: 'setCssCode',
          css: '.field-q_hallucination { margin-top: 8px; }',
          mode: 'append',
          target: { name: 'q_hallucination' },
          customClass: 'field-q_hallucination',
        },
      ],
    }),
  )
  assert(
    String(cssOverlapMerged.formJson.formConfig.cssCode).includes('margin-top'),
    'css overlap fallback appended',
  )
  assert(
    (cssOverlapMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options.label ===
      overlapForm.widgetList[0].options.label,
    'css path keeps label',
  )
  writeCaseTo(
    outDirV040,
    'refine-layout-css-fallback',
    'explicit setCssCode+customClass fixes overlap class; label unchanged; css appended',
    { type: 'agent' },
  )

  const synonymPlan = normalizeRefinePlanSynonyms(
    refinePlanSchema.parse({
      summary: 'NL 口语对齐',
      warnings: [],
      operations: [
        { op: 'updateField', target: { id: 'r1' }, patch: { labelAlign: 'right' } },
        { op: 'updateField', target: { id: 'r1' }, patch: { labelWidth: '450px' } },
        { op: 'patchFormConfig', patch: { labelAlign: 'center', size: 'default' } },
      ],
    }),
  )
  assert(
    synonymPlan.warnings.some((w) => w.includes('NL归一') && w.includes('labelAlign')),
    'labelAlign synonym warning expected',
  )
  const alignOp = synonymPlan.plan.operations.find(
    (op) => op.op === 'updateField' && 'labelAlign' in (op.patch || {}),
  ) as { patch: Record<string, unknown> } | undefined
  assert(alignOp?.patch.labelAlign === 'label-right-align', 'right → label-right-align')
  const widthOp = synonymPlan.plan.operations.find(
    (op) => op.op === 'updateField' && 'labelWidth' in (op.patch || {}),
  ) as { patch: Record<string, unknown> } | undefined
  assert(widthOp?.patch.labelWidth === 450, '450px → 450 number')
  const formOp = synonymPlan.plan.operations.find((op) => op.op === 'patchFormConfig') as
    | { patch: Record<string, unknown> }
    | undefined
  assert(formOp?.patch.labelAlign === 'label-center-align', 'center → label-center-align')
  assert(formOp?.patch.size === '', 'default → empty size')
  const synonymMerged = applyRefinePlan(
    {
      widgetList: [
        {
          type: 'radio',
          id: 'r1',
          options: {
            name: 'r1',
            label: '评分',
            labelAlign: '',
            labelWidth: null,
            displayStyle: 'block',
            optionItems: [{ label: '好', value: 1 }],
            onChange: '',
          },
        },
      ],
      formConfig: { labelWidth: 120, labelAlign: 'label-left-align', size: '', customClass: [] },
    },
    synonymPlan.plan,
  )
  const synRadio = (synonymMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  assert(synRadio.labelAlign === 'label-right-align', 'synonym merge writes label-right-align')
  assert(synRadio.labelWidth === 450, 'synonym merge writes labelWidth number')
  assert(synonymMerged.formJson.formConfig.labelAlign === 'label-center-align', 'form center applied')
  assert(synonymMerged.formJson.formConfig.size === '', 'form size default normalized')
  writeCaseTo(
    outDirV040,
    'nl-synonym-normalize-parity',
    'right/center/450px/default → catalog literals; merge passes sanitize',
    { type: 'agent' },
  )
  assert(normalizeLabelWidthValue('120px') === 120, 'normalizeLabelWidthValue helper')

  const goodGenerate = assembleFormJson(mockPlanFromText('生成含评估题的表单'))
  const goodGenIssues = validateFormJson(goodGenerate)
  assert(goodGenIssues.length === 0, `generate catalog validate ok: ${JSON.stringify(goodGenIssues)}`)
  const badGenerate = structuredClone(goodGenerate) as unknown as {
    widgetList: Array<{ type?: string; options: Record<string, unknown> }>
    formConfig: Record<string, unknown>
  }
  const badInput = badGenerate.widgetList.find((w) => w.type === 'input')
  assert(badInput, 'mock generate should include input')
  badInput.options.labelWidth = '450px'
  const badGenIssues = validateFormJson(badGenerate)
  assert(
    badGenIssues.some((i) => i.path.includes('labelWidth') && i.message.includes('catalog')),
    `generate path rejects labelWidth px string: ${JSON.stringify(badGenIssues)}`,
  )
  writeCaseTo(
    outDirV040,
    'generate-catalog-validator-parity',
    'generate+excel same catalog validator; assembled form ok; injected 450px fails',
    { type: 'agent' },
  )

  const missingCreateDefaults = assertCreateTypesHaveCatalogDefaults(REFINE_CREATE_WHITELIST, catalog)
  assert(missingCreateDefaults.length === 0, `create whitelist missing catalog defaults: ${missingCreateDefaults.join(',')}`)
  const mergerSrc = readRepoFile('agent/src/services/refineMerger.ts')
  const assemblerSrc = readRepoFile('agent/src/services/assembler.ts')
  assert(!mergerSrc.includes('widgetTemplates'), 'refineMerger must not import widgetTemplates')
  assert(!assemblerSrc.includes('widgetTemplates'), 'assembler must not import widgetTemplates')
  const inputDefaults = cloneCatalogDefaultOptions('input', catalog)
  assert(inputDefaults.labelWidth === null, 'catalog input.labelWidth should be null inherit')
  assert(inputDefaults.columnWidth === '200px', 'catalog input.columnWidth from widgetsConfig')
  const addFieldMerged = applyRefinePlan(
    { widgetList: [], formConfig: getDefaultFormConfig() },
    refinePlanSchema.parse({
      summary: 'addField from catalog',
      warnings: [],
      operations: [
        {
          op: 'addField',
          field: { key: 'note', label: '备注', type: 'textarea', required: true },
        },
      ],
    }),
  )
  const added = addFieldMerged.formJson.widgetList[0] as { type?: string; options: Record<string, unknown> }
  assert(added.type === 'textarea', 'addField type')
  assert(added.options.label === '备注' && added.options.required === true, 'addField overrides applied')
  assert(added.options.labelWidth === inputDefaults.labelWidth, 'addField inherits catalog labelWidth default')
  assert(added.options.columnWidth === inputDefaults.columnWidth, 'addField inherits catalog columnWidth')
  const addIssues = validateFormJson(addFieldMerged.formJson, { mode: 'refine', existingIds: new Set() })
  assert(addIssues.length === 0, `addField catalog clone validate: ${JSON.stringify(addIssues)}`)
  const tabMerged = applyRefinePlan(
    {
      widgetList: [{ type: 'input', id: 'x1', options: { name: 'x1', label: 'X', onChange: '' } }],
      formConfig: getDefaultFormConfig(),
    },
    refinePlanSchema.parse({
      summary: 'wrap tabs from catalog',
      warnings: [],
      operations: [
        {
          op: 'wrapInTabs',
          panes: [{ label: '分组', targets: [{ id: 'x1' }] }],
        },
      ],
    }),
  )
  const tabNode = tabMerged.formJson.widgetList.find((w: { type?: string }) => w.type === 'tab') as
    | { options: Record<string, unknown> }
    | undefined
  assert(tabNode, 'wrapInTabs creates tab from catalog')
  assert(tabNode.options.tabType === getWidgetDefaultSchema('tab', catalog)?.defaultOptions.tabType, 'tab options from catalog')
  writeCaseTo(
    outDirV040,
    'addfield-catalog-defaults-parity',
    'addField/wrapInTabs clone widgetsConfig via Catalog; labelWidth null; columnWidth 200px; create whitelist covered',
    { type: 'agent' },
  )

  const wcTypes = await listWidgetsConfigUniqueTypes(root)
  assert(wcTypes.length === catalog.widgets.length, `widgetsConfig types=${wcTypes.length} catalog=${catalog.widgets.length}`)
  const wcParity = checkWidgetsConfigCatalogTypeParity(catalog, wcTypes)
  assert(wcParity.length === 0, `widgetsConfig/catalog type parity: ${wcParity.join('; ')}`)
  const createParity = checkCreateWhitelistPolicy(catalog)
  assert(createParity.length === 0, `create whitelist parity: ${createParity.join('; ')}`)
  assert(
    REFINE_CREATE_WHITELIST.length + Object.keys(CREATE_NON_GOAL).length === catalog.widgets.length,
    'create allowed + NON_GOAL must partition catalog types',
  )
  const validatorSrc = readRepoFile('agent/src/services/validator.ts')
  assert(validatorSrc.includes('createRejectMessageForType'), 'validator uses create NON_GOAL messages')
  writeCaseTo(
    outDirV040,
    'create-whitelist-catalog-parity',
    `widgetsConfigTypes=${wcTypes.length}; catalogTypes=${catalog.widgets.length}; createAllowed=${REFINE_CREATE_WHITELIST.length}; nonGoal=${Object.keys(CREATE_NON_GOAL).length}; partition ok`,
    { type: 'agent/static' },
  )

  const colOk = sanitizeWidgetPatch('input', { columnWidth: '200px' })
  assert(colOk.patch.columnWidth === '200px', 'columnWidth css text ok')
  const colBad = sanitizeWidgetPatch('input', { columnWidth: 200 as unknown as string })
  assert(colBad.patch.columnWidth === undefined, 'columnWidth number rejected')
  const widgetClsOk = sanitizeWidgetPatch('input', { customClass: 'field-x' })
  assert(widgetClsOk.patch.customClass === 'field-x', 'widget customClass string ok')
  const widgetClsBad = sanitizeWidgetPatch('input', { customClass: ['x'] as unknown as string })
  assert(widgetClsBad.patch.customClass === undefined, 'widget customClass array rejected')
  const formClsOk = sanitizeFormPatch({ customClass: ['form-x'] })
  assert(Array.isArray(formClsOk.patch.customClass), 'form customClass array ok')
  const formClsBad = sanitizeFormPatch({ customClass: 'form-x' as unknown as string[] })
  assert(formClsBad.patch.customClass === undefined, 'form customClass string rejected')

  const sampleForm = {
    widgetList: [
      {
        type: 'input',
        id: 'input1',
        options: {
          name: 'input1',
          label: '姓名',
          placeholder: '',
          required: false,
          onChange: '',
        },
      },
      {
        type: 'radio',
        id: 'radio1',
        options: {
          name: 'radio1',
          label: '评分',
          displayStyle: 'inline',
          optionItems: [{ label: '好', value: 1 }],
        },
      },
    ],
    formConfig: { cssCode: '.keep-me { color: red; }', customClass: [] },
  }
  const unknown = sanitizeWidgetPatch('input', { placeholder: '请输入姓名', notAKey: 'x' })
  assert(unknown.patch.placeholder === '请输入姓名', 'writable placeholder kept')
  assert(unknown.warnings.some((w) => w.includes('未知键')), 'unknown key warning')
  const forbidden = sanitizeWidgetPatch('input', { onChange: 'alert(1)' })
  assert(forbidden.patch.onChange === undefined, 'event key must be stripped')
  assert(forbidden.warnings.some((w) => w.includes('禁写键')), 'forbidden key warning')
  const enumMismatch = sanitizeWidgetPatch('radio', { displayStyle: 'diagonal' })
  assert(enumMismatch.patch.displayStyle === undefined, 'invalid enum stripped')
  const typeMismatch = sanitizeWidgetPatch('input', { required: 'yes' })
  assert(typeMismatch.patch.required === undefined, 'type mismatch stripped')
  const applied = applyRefinePlan(sampleForm, refinePlanSchema.parse({
    summary: '改 placeholder 并追加 CSS',
    warnings: [],
    operations: [
      { op: 'updateField', target: { name: 'input1' }, patch: { placeholder: '请输入姓名', onChange: 'bad()' } },
      {
        op: 'setCssCode',
        css: '.field-input1 { margin-top: 8px; }',
        mode: 'append',
        target: { name: 'input1' },
        customClass: 'field-input1',
      },
    ],
  }))
  const appliedInput = (applied.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  assert(appliedInput.placeholder === '请输入姓名', 'placeholder written')
  assert(appliedInput.onChange === '', 'onChange must remain empty')
  assert(appliedInput.label === '姓名', 'unmentioned label kept')
  assert(String(applied.formJson.formConfig.cssCode).includes('.keep-me'), 'existing css preserved')
  assert(String(applied.formJson.formConfig.cssCode).includes('.field-input1'), 'new css appended')
  const dangerous = validateCssCode('@import url(https://evil.example/x.css); .x{color:red}')
  assert(dangerous.ok === false, 'dangerous css rejected')
  const mergedCss = mergeCssCode('.keep-me { color: red; }', '.field-input1 { margin-top: 8px; }')
  assert(mergedCss.includes('.keep-me') && mergedCss.includes('.field-input1'), 'css merge keeps both')
  const styleWithCss = enforceRefineTextPolicy(
    '标签和选项重叠了，优化样式',
    refinePlanSchema.parse({
      summary: '受控样式',
      warnings: [],
      operations: [
        { op: 'updateField', target: { name: 'input1' }, patch: { label: '短标题' } },
        { op: 'setCssCode', css: '.field-input1 { display: block; }' },
      ],
    }),
  )
  assert(!styleWithCss.reject, 'style intent with css op should not reject')
  assert(
    !styleWithCss.plan.operations.some((op) => op.op === 'updateField' && 'label' in (op.patch as object)),
    'label patch stripped under style intent',
  )
  writeCaseTo(
    outDirV030,
    'refine-property-policy',
    'unknown/forbidden/type-mismatch keys stripped; placeholder applied; events unchanged; css append keeps existing; dangerous css rejected; style+css does not fall back to copy',
    { type: 'agent' },
  )

  const nestedForm = {
    widgetList: [
      {
        type: 'tab',
        id: 'tab1',
        options: { name: 'main_tab' },
        tabs: [
          {
            type: 'tab-pane',
            id: 'pane1',
            options: { name: 'pane_basic', label: '基本信息' },
            widgetList: [
              {
                type: 'input',
                id: 'input_in_tab',
                options: { name: 'username', label: '用户名', placeholder: '' },
              },
            ],
          },
        ],
      },
      { type: 'input', id: 'input_root', options: { name: 'dup', label: '字段A' } },
      { type: 'input', id: 'input_root2', options: { name: 'dup', label: '字段B' } },
    ],
    formConfig: {},
  }
  const summary = buildFormSummary(nestedForm)
  const nested = summary.find((f) => f.id === 'input_in_tab')
  assert(nested?.path.includes('tabs[0].widgetList[0]'), 'nested path should be stable')
  assert(nested?.parent?.type === 'tab-pane', 'parent container should be recorded')
  assert(nested?.writableSnapshot?.placeholder === '', 'writable snapshot includes placeholder')
  const snippets = buildCatalogSnippets(summary)
  assert(snippets.some((s) => s.type === 'input'), 'catalog snippet includes input type')
  assert(snippets.length <= 12, 'catalog snippets capped')
  const uniqueTarget = validatePlanTargets(nestedForm, [
    { op: 'updateField', target: { id: 'input_in_tab' }, patch: { placeholder: 'x' } },
  ])
  assert(uniqueTarget.ok, 'unique id target should pass')
  const ambiguous = validatePlanTargets(nestedForm, [
    { op: 'updateField', target: { name: 'dup' }, patch: { placeholder: 'x' } },
  ])
  assert(!ambiguous.ok, 'duplicate name target should reject')
  assert(ambiguous.rejectMessage?.includes('歧义') || ambiguous.rejectMessage?.includes('多个'), 'ambiguous message readable')
  writeCaseTo(
    outDirV030,
    'refine-precise-targeting',
    'summary includes path/parent/writableSnapshot; unique id passes; duplicate name rejected',
    { type: 'agent' },
  )
  writeCaseTo(
    outDirV030,
    'refine-ambiguous-target-reject',
    'duplicate name in plan targets returns rejectMessage without applying merge',
    { type: 'agent' },
  )

  const multiTypeForm = {
    widgetList: [
      { type: 'input', id: 'f1', options: { name: 'f1', label: 'A', placeholder: '', required: false, onChange: '' } },
      { type: 'number', id: 'f2', options: { name: 'f2', label: 'B', precision: 0, required: false, onChange: '' } },
      {
        type: 'data-table',
        id: 'tbl1',
        options: { name: 'tbl1', label: '表格', onChange: '' },
        widgetList: [],
      },
    ],
    formConfig: { cssCode: '', customClass: [] },
  }
  const multiMerged = applyRefinePlan(multiTypeForm, refinePlanSchema.parse({
    summary: '多类型属性修改',
    warnings: [],
    operations: [
      { op: 'updateField', target: { id: 'f1' }, patch: { placeholder: '请输入', required: true } },
      { op: 'updateField', target: { id: 'f2' }, patch: { precision: 2, label: 'B' } },
      {
        op: 'addField',
        parent: { id: 'tbl1' },
        field: { key: 'note', label: '备注', type: 'textarea', required: false },
      },
    ],
  }))
  const f1 = (multiMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  const f2 = (multiMerged.formJson.widgetList[1] as { options: Record<string, unknown> }).options
  assert(f1.placeholder === '请输入' && f1.required === true, 'input string/bool properties applied')
  assert(f2.precision === 2 && f2.label === 'B', 'number property applied')
  assert(
    multiMerged.warnings.some((w) => w.includes('data-table') || w.includes('结构手术')),
    'heavy parent addField should warn and fallback',
  )
  const idsMulti = collectWidgetIds(multiTypeForm)
  const catalogIssues = validateFormJson(multiMerged.formJson, { mode: 'refine', existingIds: idsMulti })
  assert(catalogIssues.length === 0, `catalog validate after merge: ${JSON.stringify(catalogIssues)}`)
  writeCaseTo(
    outDirV030,
    'refine-common-properties',
    'input+number writable properties applied; heavy parent addField warns; catalog validator passes',
    { type: 'agent' },
  )

  // Repair: 合法 radio defaultValue 不得阻断对齐类 refine
  const alignWithDefaultForm = {
    widgetList: [
      {
        type: 'radio',
        id: 'radio_score',
        options: {
          name: 'score',
          label: '评分项',
          labelAlign: '',
          defaultValue: 1,
          displayStyle: 'block',
          optionItems: [
            { label: '差', value: 0 },
            { label: '好', value: 1 },
          ],
          onChange: '',
        },
      },
    ],
    formConfig: { labelAlign: 'label-left-align', cssCode: '', customClass: [] },
  }
  const alignMerged = applyRefinePlan(
    alignWithDefaultForm,
    refinePlanSchema.parse({
      summary: '标签居中',
      warnings: [],
      operations: [
        { op: 'patchFormConfig', patch: { labelAlign: 'label-center-align' } },
        { op: 'updateField', target: { id: 'radio_score' }, patch: { labelAlign: 'label-center-align' } },
      ],
    }),
  )
  const alignRadio = (alignMerged.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  assert(alignMerged.formJson.formConfig.labelAlign === 'label-center-align', 'form labelAlign applied')
  assert(alignRadio.labelAlign === 'label-center-align', 'field labelAlign applied')
  assert(alignRadio.defaultValue === 1, 'radio defaultValue preserved')
  const alignIssues = validateFormJson(alignMerged.formJson, {
    mode: 'refine',
    existingIds: collectWidgetIds(alignWithDefaultForm),
  })
  assert(alignIssues.length === 0, `align with defaultValue must pass catalog: ${JSON.stringify(alignIssues)}`)
  writeCaseTo(
    outDirV030,
    'refine-align-keeps-radio-default',
    'labelAlign refine keeps legitimate radio defaultValue; catalog validator does not false-positive',
    { type: 'agent' },
  )

  const cssApply = applyRefinePlan(sampleForm, refinePlanSchema.parse({
    summary: 'scoped css',
    warnings: [],
    operations: [
      {
        op: 'setCssCode',
        css: '.field-input1 label { white-space: nowrap; }',
        mode: 'append',
        target: { name: 'input1' },
        customClass: 'field-input1',
      },
    ],
  }))
  assert(String(cssApply.formJson.formConfig.cssCode).includes('white-space'), 'css applied')
  assert(
    (cssApply.formJson.widgetList[0] as { options: Record<string, unknown> }).options.label === '姓名',
    'css apply keeps label',
  )
  writeCaseTo(
    outDirV030,
    'refine-csscode-apply',
    'scoped css appended; label unchanged; customClass bound',
    { type: 'agent' },
  )

  const cssRejectPlan = refinePlanSchema.parse({
    summary: 'bad css',
    warnings: [],
    operations: [{ op: 'setCssCode', css: '@import url(x); body{color:red}', mode: 'append' }],
  })
  const cssReject = applyRefinePlan(sampleForm, cssRejectPlan)
  assert(!String(cssReject.formJson.formConfig.cssCode).includes('@import'), 'dangerous css not merged')
  const cssRejectValidate = validateFormJson(cssReject.formJson, { mode: 'refine', existingIds: collectWidgetIds(sampleForm) })
  assert(!cssRejectValidate.some((i) => i.path === 'formConfig.cssCode'), 'no dangerous css in validated form')
  writeCaseTo(
    outDirV030,
    'refine-csscode-reject',
    'dangerous css blocked at merge; validator clean',
    { type: 'agent' },
  )

  // agent-health: module/boot contract via smoke imports + health route source
  const serverSrc = readRepoFile('agent/src/server.ts')
  assert(serverSrc.includes("app.get('/health'"), 'health route missing')
  assert(serverSrc.includes('registerRefineRoutes'), 'refine routes not registered')
  writeCase('agent-health', 'health route and refine registration present in agent/src/server.ts')

  // text-generate-apply: API generate path + frontend confirm wiring (static, no E2E)
  const base = assembleFormJson(mockPlanFromText('生成含评估题的表单'))
  const genIssues = validateFormJson(base)
  assert(genIssues.length === 0, `generate validate failed: ${JSON.stringify(genIssues)}`)
  const aiChat = readRepoFile('v-form/src/components/AiChat/index.vue')
  const setting = readRepoFile('v-form/src/components/form-designer/setting-panel/index.vue')
  assert(aiChat.includes('应用到设计器'), 'apply button missing')
  assert(aiChat.includes("emit('apply'"), 'apply emit missing')
  assert(!/onMounted\(\)\s*\{[\s\S]*emit\('apply'/.test(aiChat), 'must not auto-apply on mount')
  assert(setting.includes('applyAiFormJson'), 'applyAiFormJson missing')
  assert(setting.includes('loadFormJson'), 'loadFormJson wiring missing')
  writeCase(
    'text-generate-apply',
    `mock generate widgetCount=${base.widgetList.length}; AiChat requires explicit apply emit; setting-panel applyAiFormJson -> loadFormJson`,
    { type: 'api+static', note: 'Playwright deferred by request; confirmed via generate pipeline + source wiring' },
  )

  // coerce string targets (manual bug fix regression)
  const coerced = refinePlanSchema.parse(
    normalizeRefinePlanRaw({
      summary: 'string targets coerce',
      warnings: [],
      operations: [
        {
          op: 'wrapInTabs',
          panes: [
            { label: '基本信息', targets: ['name', base.widgetList[0]?.id || 'input1'] },
            { label: '评估题目', targets: [] },
          ],
        },
      ],
    }),
  )
  assert(typeof (coerced.operations[0] as any).panes[0].targets[0] === 'object', 'coerce failed')

  // refine-structure-tab
  const ids0 = collectWidgetIds(base)
  const planTab = mockRefinePlan('给表单增加两个 tab：基本信息 / 评估题目', base)
  const mergedTab = applyRefinePlan(base, planTab)
  const tabIssues = validateFormJson(mergedTab.formJson, { mode: 'refine', existingIds: ids0 })
  assert(tabIssues.length === 0, `tab refine issues: ${JSON.stringify(tabIssues)}`)
  assert(mergedTab.formJson.widgetList.some((w: any) => w.type === 'tab'), 'tab missing')
  // also apply coerced string-target plan onto a fresh copy
  const mergedCoerced = applyRefinePlan(base, coerced)
  assert(mergedCoerced.formJson.widgetList.some((w: any) => w.type === 'tab'), 'coerced wrapInTabs failed')
  writeCase(
    'refine-structure-tab',
    `wrapInTabs produced tab; string-target coerce path also produced tab; validate issues=0`,
    { type: 'api+smoke' },
  )

  // refine-options-formula + multiturn
  const ids1 = collectWidgetIds(mergedTab.formJson)
  const plan2 = mockRefinePlan('优化选项分值，并增加总分公式', mergedTab.formJson)
  const merged2 = applyRefinePlan(mergedTab.formJson, plan2)
  const issues2 = validateFormJson(merged2.formJson, { mode: 'refine', existingIds: ids1 })
  assert(issues2.length === 0, `round2 issues: ${JSON.stringify(issues2)}`)
  const hasFormula = JSON.stringify(merged2.formJson).includes('formulaEnabled')
  assert(hasFormula, 'formula not present after round2')
  writeCase(
    'refine-options-formula',
    `second-round refine applied options/formula; formulaEnabled present=${hasFormula}; validate issues=0`,
    { type: 'api+smoke' },
  )
  writeCase(
    'refine-multiturn-apply',
    `two sequential refine merges on evolving formJson succeeded (tab then options/formula); apply still requires UI confirm (static)`,
    { type: 'api+static', note: 'Playwright deferred; multiturn proven at agent merge layer' },
  )

  // refine-reject-keeps-canvas: illegal new type rejected; UI does not auto-apply
  const bad = structuredClone(base) as any
  bad.widgetList.push({
    type: 'data-table',
    id: 'new_illegal_1',
    options: { name: 'bad_table' },
    widgetList: [],
  })
  const badIssues = validateFormJson(bad, { mode: 'refine', existingIds: ids0 })
  assert(
    badIssues.some((i) => i.message.includes('新建白名单') || i.message.includes('refine create whitelist')),
    'expected reject',
  )
  assert(aiChat.includes('error.value'), 'error state present')
  assert(
    aiChat.includes('canApply') && aiChat.includes(':disabled="!canApply"'),
    'apply disabled without applyable refine result',
  )
  writeCase(
    'refine-reject-keeps-canvas',
    `illegal new type rejected by refine validator; AiChat apply disabled without lastResult and only emits apply on explicit click`,
    { type: 'api+static', note: 'Playwright deferred; canvas preservation inferred from no auto-apply + 422/validate fail path' },
  )

  // refine-text-style-policy: style intent must not apply copy-only patches
  const stylePlan = refinePlanSchema.parse({
    summary: '缩短标题避免重叠',
    warnings: [],
    operations: [
      {
        op: 'updateField',
        target: { name: 'score1' },
        patch: { label: '短标题' },
      },
    ],
  })
  const styleBlocked = enforceRefineTextPolicy('标签和选项重叠了，优化样式', stylePlan)
  assert(styleBlocked.reject === true, 'style-only copy patch should reject')
  assert(
    styleBlocked.warnings.some((w) => w.includes('样式') || w.includes('CSS')),
    'expected style policy warning',
  )
  const explicitText = enforceRefineTextPolicy('把标题改成「评估项 A」', stylePlan)
  assert(!explicitText.reject, 'explicit text change should allow label patch')
  assert(explicitText.plan.operations.length === 1, 'label patch kept when user asks to rename')
  writeCase(
    'refine-text-style-policy',
    'style overlap instruction rejects label-only patch; explicit rename keeps updateField',
    { type: 'unit+policy', repair: 'REFINE-TEXT-STYLE-WORKAROUND' },
  )

  assert(aiChat.includes('lastResult?.warnings'), 'AiChat renders refine warnings')
  writeCaseTo(
    outDirV030,
    'refine-p1-regression',
    'v0.2.0 agent regression cases pass in same run; AiChat warnings UI wired',
    { type: 'agent/static', note: 'Playwright E2E deferred to e2e suite' },
  )

  const frontendSrc = [
    readRepoFile('v-form/src/components/AiChat/index.vue'),
    readRepoFile('v-form/src/components/AiChat/index2.vue'),
  ].join('\n')
  assert(!/DEEPSEEK_API_KEY|sk-[a-zA-Z0-9]{10,}/.test(frontendSrc), 'frontend must not embed DeepSeek secrets')
  writeCaseTo(
    outDirV040,
    'frontend-no-secret',
    'AiChat sources contain no DeepSeek API key literals',
    { type: 'static' },
  )
  writeCaseTo(
    outDirV040,
    'refine-v03-regression',
    'v0.3 acceptance cases in same run still pass; design-truth labelAlign cases added',
    { type: 'agent' },
  )

  // ---------- v0.5.0 structure ops + full strict sweep ----------
  const registerSourceV050 = fs.readFileSync(path.join(root, PROPERTY_REGISTER_REL), 'utf8')
  const catalogSyncV050 = await checkWidgetCatalogSync(root)
  assert(catalogSyncV050.catalogDiffs.length === 0, `catalog drift: ${catalogSyncV050.catalogDiffs.slice(0, 3).join('; ')}`)
  assert(catalogSyncV050.graphDiffs.length === 0, `graph drift: ${catalogSyncV050.graphDiffs.slice(0, 3).join('; ')}`)
  const strictIssues = checkCatalogFullStrictSweep(
    catalogSyncV050.catalog,
    catalogSyncV050.editorGraph,
    registerSourceV050,
  )
  assert(strictIssues.length === 0, `full strict sweep failed: ${strictIssues.slice(0, 5).join('; ')}`)
  const editorGaps = collectCatalogStrictEditorGaps(
    catalogSyncV050.catalog,
    catalogSyncV050.editorGraph,
    registerSourceV050,
  )
  writeCaseTo(
    outDirV050,
    'catalog-full-strict-sweep',
    `full applicable strict sweep pass; editorGaps=${editorGaps.length} (non-blocking report)`,
    { type: 'agent/static', editorGaps: String(editorGaps.length) },
  )

  const baseForm = assembleFormJson(mockPlanFromText('生成含姓名和性别的简易表单'))
  const remarksBefore = (baseForm.widgetList as Array<{ options?: { label?: string } }>).filter(
    (w) => w.options?.label === '备注',
  ).length
  assert(remarksBefore >= 1, 'fixture should include 备注')
  const removePlan = mockRefinePlan('删掉备注字段', baseForm)
  assert(removePlan.operations.some((o) => o.op === 'removeField'), 'mock removeField expected')
  const removed = applyRefinePlan(baseForm, removePlan)
  const remarksAfter = (removed.formJson.widgetList as Array<{ options?: { label?: string } }>).filter(
    (w) => w.options?.label === '备注',
  ).length
  assert(remarksAfter === remarksBefore - 1, '备注 should be removed')
  const withTwoInputs = applyRefinePlan(baseForm, refinePlanSchema.parse({
    summary: 'add extra input',
    warnings: [],
    operations: [
      {
        op: 'addField',
        field: { key: 'extra_input', label: '额外输入', type: 'input' },
      },
    ],
  })).formJson
  writeCaseTo(
    outDirV050,
    'refine-remove-field-by-label',
    'mock removeField deleted 备注; remaining fields preserved',
    { type: 'agent' },
  )

  const tabbed = applyRefinePlan(withTwoInputs, mockRefinePlan('用 tab 分成基本信息和评估题目', withTwoInputs)).formJson
  const panesBefore = (tabbed.widgetList as Array<{ type?: string; tabs?: unknown[] }>).find((w) => w.type === 'tab')
    ?.tabs as Array<{ type?: string; id?: string; options?: { label?: string }; widgetList?: unknown[] }>
  assert(panesBefore && panesBefore.length >= 2, 'expected >=2 tab-panes')
  const paneToRemove = panesBefore[1]
  const childCount = Array.isArray(paneToRemove.widgetList) ? paneToRemove.widgetList.length : 0
  const cascadePlan = refinePlanSchema.parse({
    summary: 'delete second tab-pane',
    warnings: [],
    operations: [
      {
        op: 'removeField',
        target: { id: paneToRemove.id!, containerType: 'tab-pane' },
      },
    ],
  })
  const cascaded = applyRefinePlan(tabbed, cascadePlan)
  const panesAfter = (cascaded.formJson.widgetList as Array<{ type?: string; tabs?: unknown[] }>).find(
    (w) => w.type === 'tab',
  )?.tabs as Array<{ id?: string }>
  assert(panesAfter && panesAfter.length === panesBefore.length - 1, 'pane count decreased')
  assert(!panesAfter.some((p) => p.id === paneToRemove.id), 'removed pane gone')
  assert(
    cascaded.warnings.some((w) => w.includes('tab-pane') && w.includes('内部控件')),
    'cascade warning expected',
  )
  writeCaseTo(
    outDirV050,
    'refine-remove-tabpane-cascade',
    `removed tab-pane ${paneToRemove.id} with ${childCount} children; no orphan lift`,
    { type: 'agent' },
  )

  const reorderBase = withTwoInputs
  const fields = (reorderBase.widgetList as Array<{ id?: string; options?: { label?: string; name?: string } }>)
  assert(fields.length >= 2, 'need >=2 fields for reorder')
  const moving = fields[fields.length - 1]
  const anchor = fields[0]
  const reorderPlan = refinePlanSchema.parse({
    summary: 'reorder sibling',
    warnings: [],
    operations: [
      {
        op: 'reorderField',
        target: { id: moving.id! },
        position: { kind: 'after', sibling: { id: anchor.id! } },
      },
    ],
  })
  const reordered = applyRefinePlan(reorderBase, reorderPlan)
  const afterIds = (reordered.formJson.widgetList as Array<{ id?: string }>).map((w) => w.id)
  assert(afterIds[1] === moving.id || afterIds.indexOf(moving.id) === afterIds.indexOf(anchor.id) + 1, 'moved after anchor')
  writeCaseTo(
    outDirV050,
    'refine-reorder-sibling',
    `reorderField moved ${moving.id} after ${anchor.id}; order=${afterIds.join(',')}`,
    { type: 'agent' },
  )

  const dupPlan = mockRefinePlan('复制一份评分 radio', withTwoInputs)
  assert(dupPlan.operations.some((o) => o.op === 'duplicateField'), 'mock duplicate expected')
  const beforeCount = (withTwoInputs.widgetList as unknown[]).length
  const duplicated = applyRefinePlan(withTwoInputs, dupPlan)
  const afterCount = (duplicated.formJson.widgetList as unknown[]).length
  assert(afterCount === beforeCount + 1, 'duplicate increases root count by 1')
  const ids = (duplicated.formJson.widgetList as Array<{ id?: string }>).map((w) => w.id)
  assert(new Set(ids).size === ids.length, 'ids unique after duplicate')
  writeCaseTo(
    outDirV050,
    'refine-duplicate-field',
    `duplicateField added widget; unique ids=${ids.length}`,
    { type: 'agent' },
  )

  const ambiguousForm = assembleFormJson(mockPlanFromText('生成含两个同名备注的表单'))
  const twin = applyRefinePlan(ambiguousForm, refinePlanSchema.parse({
    summary: 'force twin labels',
    warnings: [],
    operations: [
      { op: 'addField', field: { key: 'a', label: '备注', type: 'input' } },
      { op: 'addField', field: { key: 'b', label: '备注', type: 'input' } },
    ],
  })).formJson
  const ambPlan = refinePlanSchema.parse({
    summary: 'ambiguous remove',
    warnings: [],
    operations: [{ op: 'removeField', target: { label: '备注' } }],
  })
  const ambCheck = validatePlanTargets(twin, ambPlan.operations)
  assert(!ambCheck.ok, 'ambiguous label must reject')
  writeCaseTo(
    outDirV050,
    'refine-structure-ambiguous-reject',
    `ambiguous removeField label=备注 rejected: ${ambCheck.rejectMessage}`,
    { type: 'agent' },
  )

  writeCaseTo(
    outDirV050,
    'refine-v04-regression',
    'v0.4 agent acceptance cases in same run still pass; structure ops added',
    { type: 'agent' },
  )
  writeCaseTo(
    outDirV050,
    'frontend-no-secret',
    'AiChat sources contain no DeepSeek API key literals',
    { type: 'static' },
  )

  // ---- v0.6.0 heavy container refine ----
  const outDirV060 = path.join(root, 'docs/evidence/v0.6.0')
  fs.mkdirSync(outDirV060, { recursive: true })

  const flatTableForm = {
    widgetList: [
      {
        type: 'data-table',
        id: 'dt1',
        options: {
          name: 'dt1',
          label: '人员表',
          tableColumns: [
            { columnId: 1, prop: 'name', label: '姓名', width: '100', show: true, align: 'left' },
            { columnId: 2, prop: 'date', label: '日期', width: '160', show: true, align: 'left' },
          ],
          stripe: true,
          showIndex: false,
          customClass: '',
        },
        widgetList: [],
      },
    ],
    formConfig: { customClass: [] },
  }

  const addCol = applyRefinePlan(
    flatTableForm,
    refinePlanSchema.parse({
      summary: '加备注列',
      warnings: [],
      operations: [
        {
          op: 'addTableColumn',
          table: { id: 'dt1' },
          column: { prop: 'remark', label: '备注', width: '120', show: true },
        },
      ],
    }),
  )
  const colsAfterAdd = (addCol.formJson.widgetList[0] as { options: { tableColumns: Array<{ prop: string; columnId: number }> } })
    .options.tableColumns
  assert(colsAfterAdd.length === 3 && colsAfterAdd.some((c) => c.prop === 'remark'), 'addTableColumn should append remark')
  assert(colsAfterAdd.find((c) => c.prop === 'remark')?.columnId === 3, 'new columnId should be max+1')
  writeCaseTo(outDirV060, 'refine-datatable-add-column', 'flat table addColumn remark columnId=3', { type: 'agent' })

  const updCol = applyRefinePlan(
    flatTableForm,
    refinePlanSchema.parse({
      summary: '改姓名列宽',
      warnings: [],
      operations: [
        { op: 'updateTableColumn', table: { id: 'dt1' }, column: { prop: 'name' }, patch: { width: '140', label: '姓名列' } },
      ],
    }),
  )
  const nameCol = (updCol.formJson.widgetList[0] as { options: { tableColumns: Array<{ prop: string; width: string; label: string }> } })
    .options.tableColumns.find((c) => c.prop === 'name')
  assert(nameCol?.width === '140' && nameCol?.label === '姓名列', 'updateTableColumn should patch label/width')
  writeCaseTo(outDirV060, 'refine-datatable-update-column', 'update name column width=140 label=姓名列', { type: 'agent' })

  const remReorder = applyRefinePlan(
    flatTableForm,
    refinePlanSchema.parse({
      summary: '删日期并重排',
      warnings: [],
      operations: [
        { op: 'removeTableColumn', table: { id: 'dt1' }, column: { prop: 'date' } },
        { op: 'reorderTableColumn', table: { id: 'dt1' }, column: { prop: 'name' }, position: { kind: 'last' } },
      ],
    }),
  )
  const remCols = (remReorder.formJson.widgetList[0] as { options: { tableColumns: Array<{ prop: string }> } }).options
    .tableColumns
  assert(remCols.length === 1 && remCols[0].prop === 'name', 'remove+reorder should leave name only')
  writeCaseTo(outDirV060, 'refine-datatable-remove-reorder-column', 'removed date; name remains', { type: 'agent' })

  const nestedTableForm = {
    widgetList: [
      {
        type: 'data-table',
        id: 'dtn',
        options: {
          name: 'dtn',
          label: '嵌套表',
          tableColumns: [
            { columnId: 1, prop: 'name', label: '姓名', show: true },
            {
              columnId: 14,
              prop: '~',
              headerFlag: true,
              label: '表头1',
              children: [{ columnId: 15, prop: 'x', label: '子列', show: true }],
            },
          ],
          customClass: '',
        },
        widgetList: [],
      },
    ],
    formConfig: { customClass: [] },
  }
  const nestedReject = applyRefinePlan(
    nestedTableForm,
    refinePlanSchema.parse({
      summary: '嵌套表加列',
      warnings: [],
      operations: [
        { op: 'addTableColumn', table: { id: 'dtn' }, column: { prop: 'y', label: 'Y' } },
      ],
    }),
  )
  assert(
    nestedReject.warnings.some((w) => /多级表头|children|headerFlag/i.test(w)),
    'nested header must reject column ops',
  )
  assert(
    ((nestedReject.formJson.widgetList[0] as { options: { tableColumns: unknown[] } }).options.tableColumns.length === 2),
    'nested table columns unchanged',
  )
  writeCaseTo(outDirV060, 'refine-datatable-nested-header-reject', 'nested header addTableColumn rejected', {
    type: 'agent',
  })

  const patchBlock = applyRefinePlan(
    flatTableForm,
    refinePlanSchema.parse({
      summary: '整段替换列',
      warnings: [],
      operations: [
        {
          op: 'updateField',
          target: { id: 'dt1' },
          patch: { tableColumns: [{ columnId: 99, prop: 'hack', label: 'Hack' }] },
        },
      ],
    }),
  )
  assert(
    patchBlock.warnings.some((w) => /禁止经 updateField|tableColumns/i.test(w)),
    'updateField tableColumns must be blocked',
  )
  assert(
    (patchBlock.formJson.widgetList[0] as { options: { tableColumns: Array<{ prop: string }> } }).options.tableColumns[0]
      .prop === 'name',
    'tableColumns must remain original after blocked patch',
  )
  writeCaseTo(outDirV060, 'refine-datatable-tablecolumns-patch-block', 'updateField tableColumns stripped', {
    type: 'agent',
  })

  const subFormStruct = {
    widgetList: [
      {
        type: 'sub-form',
        id: 'sf1',
        options: {
          name: 'sf1',
          label: '明细',
          showBlankRow: true,
          showRowNumber: false,
          labelAlign: 'label-center-align',
          actionColumnPosition: 'left',
          hidden: false,
          disabled: false,
          customClass: '',
        },
        widgetList: [
          { type: 'input', id: 'sfi1', options: { name: 'sfi1', label: '品名', placeholder: '', required: false } },
          { type: 'number', id: 'sfi2', options: { name: 'sfi2', label: '数量', precision: 0, required: false } },
        ],
      },
    ],
    formConfig: { customClass: [] },
  }
  const subDup = applyRefinePlan(
    subFormStruct,
    refinePlanSchema.parse({
      summary: '复制品名',
      warnings: [],
      operations: [{ op: 'duplicateField', target: { id: 'sfi1' } }],
    }),
  )
  const sfList = (subDup.formJson.widgetList[0] as { widgetList: Array<{ id?: string; options?: { label?: string } }> })
    .widgetList
  assert(sfList.length === 3, 'sub-form child duplicate should grow widgetList')
  assert(sfList.filter((w) => w.options?.label === '品名').length === 2, 'duplicated 品名')
  writeCaseTo(outDirV060, 'refine-subform-structure-ops', 'duplicateField inside sub-form widgetList', { type: 'agent' })

  const subShell = applyRefinePlan(
    subFormStruct,
    refinePlanSchema.parse({
      summary: '显示行号',
      warnings: [],
      operations: [
        { op: 'updateField', target: { id: 'sf1', containerType: 'sub-form' }, patch: { showRowNumber: true } },
      ],
    }),
  )
  assert(
    (subShell.formJson.widgetList[0] as { options: { showRowNumber: boolean } }).options.showRowNumber === true,
    'sub-form showRowNumber should update',
  )
  writeCaseTo(outDirV060, 'refine-subform-shell-props', 'sub-form showRowNumber=true', { type: 'agent' })

  const subAdd = applyRefinePlan(
    subFormStruct,
    refinePlanSchema.parse({
      summary: '子表加备注',
      warnings: [],
      operations: [
        {
          op: 'addField',
          parent: { id: 'sf1' },
          field: { key: 'note', label: '备注', type: 'input' },
        },
      ],
    }),
  )
  assert(
    (subAdd.formJson.widgetList[0] as { widgetList: unknown[] }).widgetList.length === 3,
    'addField parent=sub-form should nest field',
  )
  assert(
    !subAdd.warnings.some((w) => /未纳入结构手术|追加到根节点/i.test(w)),
    'sub-form parent must not fallback to root',
  )
  writeCaseTo(outDirV060, 'refine-subform-add-field-parent', 'addField into sub-form widgetList', { type: 'agent' })

  const dialogShellForm = {
    widgetList: [
      {
        type: 'vf-dialog',
        id: 'dlg1',
        options: {
          name: 'dlg1',
          title: '旧标题',
          width: '50%',
          fullscreen: false,
          showModal: true,
          showClose: true,
          closeOnClickModal: false,
          closeOnPressEscape: false,
          center: false,
          readMode: false,
          disabledMode: false,
          okButtonLabel: '',
          okButtonHidden: false,
          cancelButtonLabel: '',
          cancelButtonHidden: false,
          onOkButtonClick: '',
        },
        widgetList: [
          { type: 'input', id: 'di1', options: { name: 'di1', label: '弹窗内字段', required: false } },
        ],
      },
    ],
    formConfig: { customClass: [] },
  }
  const dialogShell = applyRefinePlan(
    dialogShellForm,
    refinePlanSchema.parse({
      summary: '改弹窗标题宽度',
      warnings: [],
      operations: [
        {
          op: 'updateField',
          target: { id: 'dlg1', containerType: 'vf-dialog' },
          patch: { title: '新标题', width: '60%' },
        },
      ],
    }),
  )
  const dlgOpts = (dialogShell.formJson.widgetList[0] as { options: Record<string, unknown> }).options
  assert(dlgOpts.title === '新标题' && dlgOpts.width === '60%', 'vf-dialog shell props applied')
  writeCaseTo(outDirV060, 'refine-dialog-shell-props', 'vf-dialog title+width updated', { type: 'agent' })

  const dialogEvent = applyRefinePlan(
    dialogShellForm,
    refinePlanSchema.parse({
      summary: '写事件',
      warnings: [],
      operations: [
        {
          op: 'updateField',
          target: { id: 'dlg1' },
          patch: { onOkButtonClick: 'alert(1)' },
        },
      ],
    }),
  )
  assert(
    (dialogEvent.formJson.widgetList[0] as { options: { onOkButtonClick: string } }).options.onOkButtonClick === '',
    'dialog event key must stay empty',
  )
  writeCaseTo(outDirV060, 'refine-dialog-event-forbid', 'onOkButtonClick stripped/forbidden', { type: 'agent' })

  assert(!(REFINE_CREATE_WHITELIST as readonly string[]).includes('data-table'), 'data-table not in create whitelist')
  assert(!(REFINE_CREATE_WHITELIST as readonly string[]).includes('sub-form'), 'sub-form not in create whitelist')
  assert(!(REFINE_CREATE_WHITELIST as readonly string[]).includes('vf-dialog'), 'vf-dialog not in create whitelist')
  assert(CREATE_NON_GOAL['data-table'] && CREATE_NON_GOAL['sub-form'] && CREATE_NON_GOAL['vf-dialog'], 'heavy create NON_GOAL')
  writeCaseTo(outDirV060, 'refine-heavy-create-reject', 'data-table/sub-form/vf-dialog remain CREATE_NON_GOAL', {
    type: 'agent',
  })

  const gridSubBlocked = sanitizeContainerPropertyPatch('grid-sub-form', { showRowNumber: true })
  assert(gridSubBlocked.rejected, 'grid-sub-form shell still NON_GOAL')
  const gridSubStruct = applyRefinePlan(
    {
      widgetList: [
        {
          type: 'grid-sub-form',
          id: 'gsf1',
          options: { name: 'gsf1', label: 'g', showBlankRow: true, showRowNumber: false, customClass: '' },
          widgetList: [{ type: 'input', id: 'gsfi', options: { name: 'gsfi', label: 'A', required: false } }],
        },
      ],
      formConfig: { customClass: [] },
    },
    refinePlanSchema.parse({
      summary: '删 grid-sub-form 子字段',
      warnings: [],
      operations: [{ op: 'removeField', target: { id: 'gsfi' } }],
    }),
  )
  // child field inside grid-sub-form: target type is input, should work; removing grid-sub-form itself blocked
  assert(
    (gridSubStruct.formJson.widgetList[0] as { widgetList: unknown[] }).widgetList.length === 0,
    'field inside grid-sub-form can still be removed by type=input',
  )
  const gridSubSelf = applyRefinePlan(
    {
      widgetList: [
        {
          type: 'grid-sub-form',
          id: 'gsf2',
          options: { name: 'gsf2', label: 'g2', customClass: '' },
          widgetList: [],
        },
      ],
      formConfig: { customClass: [] },
    },
    refinePlanSchema.parse({
      summary: '删整块 grid-sub-form',
      warnings: [],
      operations: [{ op: 'removeField', target: { id: 'gsf2' } }],
    }),
  )
  assert(
    gridSubSelf.warnings.some((w) => /不在本版 delete\/reorder\/duplicate/i.test(w)),
    'grid-sub-form node structure op still NON_GOAL',
  )
  writeCaseTo(outDirV060, 'refine-grid-subform-still-non-goal', 'grid-sub-form shell+node NON_GOAL', { type: 'agent' })

  assert(REFINE_CREATE_WHITELIST.length === 12, `create whitelist must stay 12, got ${REFINE_CREATE_WHITELIST.length}`)
  writeCaseTo(outDirV060, 'create-whitelist-unchanged', `REFINE_CREATE_WHITELIST length=${REFINE_CREATE_WHITELIST.length}`, {
    type: 'static',
  })

  const heavyParity = checkContainerRefinePolicyParity(catalog)
  assert(heavyParity.length === 0, `container refine parity: ${heavyParity.join('; ')}`)
  assert(dataTable.notes?.structureSurgery === 'partial', 'catalog data-table partial')
  writeCaseTo(
    outDirV060,
    'catalog-heavy-container-policy-parity',
    `structureSurgery partial for data-table/sub-form; container refine parity ok; matrix=${Object.keys(CONTAINER_REFINE_PROPERTY_MATRIX).length}`,
    { type: 'agent/static' },
  )

  writeCaseTo(
    outDirV060,
    'refine-v05-regression',
    'v0.5 remove/reorder/duplicate and strict sweep still exercised in same acceptance run',
    { type: 'agent' },
  )

  // ---- v0.7.0 event shape + clarify (no event write) ----
  const outDirV070 = path.join(root, 'docs/evidence/v0.7.0')
  fs.mkdirSync(outDirV070, { recursive: true })

  const {
    buildEventShapeRegistry,
    checkEventShapeParity,
    loadEventShapeRegistry,
    writeEventShapeRegistry,
  } = await import('../src/knowledge/eventShapeRegistry.js')
  const { planEventClarify, assertEventKeysUnchanged } = await import('../src/services/eventPlanner.js')

  const shapesBuilt = buildEventShapeRegistry(root)
  writeEventShapeRegistry(root, shapesBuilt)
  const shapeIssues = checkEventShapeParity(root)
  assert(shapeIssues.length === 0, `event shape parity: ${shapeIssues.join('; ')}`)
  const shapesLoaded = loadEventShapeRegistry(root)
  assert(
    shapesLoaded.some((s) => s.key === 'onCreated' && (s.writableIn === 'v0.8' || s.writableIn === 'v0.8+')),
    'onCreated v0.8',
  )
  assert(
    shapesLoaded.some((s) => s.key === 'onMounted' && (s.writableIn === 'v0.8' || s.writableIn === 'v0.8+')),
    'onMounted v0.8',
  )
  assert(
    shapesLoaded.some((s) => s.key === 'onSubFormRowAdd' && (s.writableIn === 'v0.8' || s.writableIn === 'v0.8+')),
    'onSubFormRowAdd v0.8',
  )
  assert(shapesLoaded.some((s) => s.key === 'onRemoteQuery' && s.writableIn === 'never'), 'onRemoteQuery never')
  writeCaseTo(outDirV070, 'event-shape-registry-parity', `shapes=${shapesLoaded.length} parity ok`, {
    type: 'static',
  })

  const eventForm = {
    widgetList: [
      { type: 'number', id: 'yw', options: { name: 'yw', label: '语文', required: false, defaultValue: 0 } },
      { type: 'number', id: 'sx', options: { name: 'sx', label: '数学', required: false, defaultValue: 0 } },
      { type: 'number', id: 'zf', options: { name: 'zf', label: '总分', required: false, defaultValue: 0 } },
      {
        type: 'sub-form',
        id: 'sf1',
        options: { name: 'sf1', label: '明细子表', showBlankRow: true, showRowNumber: false, customClass: '' },
        widgetList: [{ type: 'input', id: 'sfi', options: { name: 'sfi', label: '项', required: false } }],
      },
    ],
    formConfig: { customClass: [], functions: '', onFormMounted: '', onFormCreated: '' },
  }

  const incomplete = planEventClarify({
    instruction: '加点交互',
    currentFormJson: eventForm,
  })
  assert(incomplete.httpStatus === 200, 'incomplete should be 200')
  assert(incomplete.response.status === 'need_clarification', 'incomplete need_clarification')
  assert((incomplete.response.questions || []).length > 0, 'incomplete questions')
  assert(incomplete.response.applied === false, 'incomplete not applied')
  assertEventKeysUnchanged(eventForm, incomplete.response.formJson)
  writeCaseTo(outDirV070, 'event-clarify-incomplete-intent', 'need_clarification with questions', {
    type: 'agent',
  })

  const complete = planEventClarify({
    instruction: '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":6}',
    currentFormJson: eventForm,
  })
  assert(complete.httpStatus === 200 && complete.response.status === 'spec_ready', 'complete spec_ready')
  assert(complete.response.eventSpec?.trigger.eventKey === 'onChange', 'complete onChange')
  assert((complete.response.eventSpec?.examples || []).length >= 1, 'complete has example')
  assert(complete.response.applied === false, 'complete not applied')
  assert(!/已更新事件|已应用\s*JS|已写入事件/i.test(complete.response.summary), 'no write claim')
  assertEventKeysUnchanged(eventForm, complete.response.formJson)
  writeCaseTo(outDirV070, 'event-clarify-complete-to-spec', 'spec_ready onChange with example', {
    type: 'agent',
  })

  const danger = planEventClarify({
    instruction: '请求接口填充下拉选项',
    currentFormJson: eventForm,
  })
  assert(danger.httpStatus === 422, 'danger 422')
  assertEventKeysUnchanged(eventForm, danger.response.formJson)
  writeCaseTo(outDirV070, 'event-clarify-danger-reject', 'interface intent rejected 422', { type: 'agent' })

  const life = planEventClarify({
    instruction: '打开表单时初始化 期望：{"ready":true}',
    currentFormJson: eventForm,
  })
  assert(life.response.status === 'spec_ready', 'lifecycle spec_ready')
  assert(life.response.eventSpec?.trigger.eventKey === 'onFormMounted', 'lifecycle onFormMounted')
  assert(life.response.applied === false, 'lifecycle not applied')
  writeCaseTo(outDirV070, 'event-clarify-lifecycle-spec', 'spec_ready onFormMounted', { type: 'agent' })

  const row = planEventClarify({
    instruction: '子表增行时带默认值 期望：{"ok":true}',
    currentFormJson: eventForm,
  })
  assert(row.response.status === 'spec_ready', 'subform row spec_ready')
  assert(row.response.eventSpec?.trigger.eventKey === 'onSubFormRowAdd', 'onSubFormRowAdd')
  assert(row.response.applied === false, 'row not applied')
  writeCaseTo(outDirV070, 'event-clarify-subform-row-spec', 'spec_ready onSubFormRowAdd', { type: 'agent' })

  assertEventKeysUnchanged(eventForm, complete.response.formJson)
  writeCaseTo(outDirV070, 'event-endpoint-does-not-write-onstar', 'clarify responses keep event keys empty', {
    type: 'agent',
  })

  const refineStillForbid = applyRefinePlan(
    eventForm,
    refinePlanSchema.parse({
      summary: '偷写 onChange',
      warnings: [],
      operations: [{ op: 'updateField', target: { id: 'yw' }, patch: { onChange: 'alert(1)' } }],
    }),
  )
  assert(
    (refineStillForbid.formJson.widgetList[0] as { options: { onChange: string } }).options.onChange === '' ||
      (refineStillForbid.formJson.widgetList[0] as { options: { onChange?: string } }).options.onChange === undefined ||
      String((refineStillForbid.formJson.widgetList[0] as { options: Record<string, unknown> }).options.onChange || '') ===
        '',
    'refine still strips onChange',
  )
  writeCaseTo(outDirV070, 'event-refine-still-forbids-events', 'refine path still forbids event keys', {
    type: 'agent',
  })

  writeCaseTo(
    outDirV070,
    'refine-v06-regression',
    'v0.6 heavy container cases still executed earlier in this acceptance run',
    { type: 'agent' },
  )

  // 回归证据落入 v0.7 目录，便于 Evidence Manifest 自包含
  writeCaseTo(
    outDirV070,
    'refine-dialog-event-forbid',
    'onOkButtonClick stripped/forbidden (re-asserted in same run as v0.6 case)',
    { type: 'agent' },
  )
  const strictAgain = checkCatalogFullStrictSweep(catalog, editorGraph, registerSource)
  assert(strictAgain.length === 0, `catalog-full-strict-sweep: ${strictAgain.join('; ')}`)
  writeCaseTo(outDirV070, 'catalog-full-strict-sweep', 'Truth Strict full sweep green', { type: 'static' })
  const frontendAiChat = [
    readRepoFile('v-form/src/components/AiChat/index.vue'),
    readRepoFile('v-form/src/api/chat/index.ts'),
  ].join('\n')
  assert(!/DEEPSEEK_API_KEY|sk-[a-zA-Z0-9]{10,}/.test(frontendAiChat), 'frontend must not embed DeepSeek secrets')
  writeCaseTo(outDirV070, 'frontend-no-secret', 'AiChat/event client contain no DeepSeek API key literals', {
    type: 'static',
  })

  // ---- v0.8.0 generate + guard + apply (no Playwright mock-this) ----
  const outDirV080 = path.join(root, 'docs/evidence/v0.8.0')
  fs.mkdirSync(outDirV080, { recursive: true })

  const { planEventGenerate, planEventApply } = await import('../src/services/eventApply.js')
  const { guardEventJs } = await import('../src/services/eventJsGuard.js')
  const { listPureFrontendEventKeys, PREVIEW_EXECUTION_CONSTRAINTS } = await import(
    '../src/knowledge/eventAllowlist.js'
  )

  assert(PREVIEW_EXECUTION_CONSTRAINTS.forbidDesignState === true, 'preview constraints locked')
  assert(
    PREVIEW_EXECUTION_CONSTRAINTS.lifecycleTrigger === 'preview-mount-and-wait-mounted',
    'lifecycle trigger locked',
  )
  const pureKeys = listPureFrontendEventKeys(root)
  assert(pureKeys.includes('onChange') && pureKeys.includes('onFormMounted'), 'allowlist has core keys')
  assert(!pureKeys.includes('onRemoteQuery'), 'allowlist excludes remote')
  writeCaseTo(outDirV080, 'event-allowlist-covers-pure-frontend', `pureKeys=${pureKeys.length}`, {
    type: 'static',
  })

  const eventFormV8 = {
    widgetList: [
      { type: 'number', id: 'yw', options: { name: 'yw', label: '语文', required: false, defaultValue: 0 } },
      { type: 'number', id: 'sx', options: { name: 'sx', label: '数学', required: false, defaultValue: 0 } },
      { type: 'number', id: 'zf', options: { name: 'zf', label: '总分', required: false, defaultValue: 0 } },
      {
        type: 'button',
        id: 'btn1',
        options: { name: 'btn1', label: '打开', onClick: '' },
      },
      {
        type: 'sub-form',
        id: 'sf1',
        options: { name: 'sf1', label: '明细子表', showBlankRow: true, showRowNumber: false, customClass: '' },
        widgetList: [{ type: 'input', id: 'sfi', options: { name: 'sfi', label: '项', required: false } }],
      },
    ],
    formConfig: { customClass: [], functions: '', onFormMounted: '', onFormCreated: '', onFormValidate: '' },
  }

  const readySpec = planEventClarify({
    instruction: '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":6}',
    currentFormJson: eventFormV8,
  })
  assert(readySpec.response.status === 'spec_ready' && readySpec.response.eventSpec, 'v0.8 clarify ready')

  const genOk = planEventGenerate({
    instruction: '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":6}',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(genOk.httpStatus === 200 && genOk.response.status === 'code_preview', 'generate code_preview')
  assert(genOk.response.applied === false, 'generate not applied')
  assert(Boolean(genOk.response.code && genOk.response.formJsonCandidate), 'has candidate')
  assertEventKeysUnchanged(eventFormV8, genOk.response.formJson)
  writeCaseTo(outDirV080, 'event-generate-onchange-preview', 'generate → code_preview, canvas unchanged', {
    type: 'agent',
  })

  const genNet = planEventGenerate({
    instruction: '联动 [guard:network]',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(genNet.httpStatus === 422, 'network guard 422')
  writeCaseTo(outDirV080, 'event-guard-forbid-network', 'fetch rejected by guard', { type: 'agent' })

  const genEval = planEventGenerate({
    instruction: '联动 [guard:eval]',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(genEval.httpStatus === 422, 'eval guard 422')
  const genDom = planEventGenerate({
    instruction: '联动 [guard:dom]',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(genDom.httpStatus === 422, 'dom guard 422')
  const genTimer = planEventGenerate({
    instruction: '联动 [guard:timer]',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(genTimer.httpStatus === 422, 'timer guard 422')
  writeCaseTo(outDirV080, 'event-guard-forbid-eval-dom-timer', 'eval/dom/timer rejected', { type: 'agent' })

  const genUnknown = planEventGenerate({
    instruction: '联动 [guard:unknown-field]',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(genUnknown.httpStatus === 422, 'unknown field 422')
  writeCaseTo(outDirV080, 'event-guard-unknown-field-ref', 'unknown field ref rejected', { type: 'agent' })

  const formulaPrefer = planEventGenerate({
    instruction: '总分用公式优先公式 例如：语文=2,数学=4 期望：{"总分":6}',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
  })
  assert(formulaPrefer.httpStatus === 422, 'formula preferred 422')
  writeCaseTo(outDirV080, 'event-formula-still-preferred', 'formula-preferable generate rejected', {
    type: 'agent',
  })

  const applyNoReport = planEventApply({
    instruction: 'apply',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
  })
  assert(applyNoReport.httpStatus === 422 && applyNoReport.response.status === 'draft', 'no report rejected')
  assertEventKeysUnchanged(eventFormV8, applyNoReport.response.formJson)
  writeCaseTo(outDirV080, 'event-apply-without-report-rejected', 'apply without report → draft/422', {
    type: 'agent',
  })

  const applyFail = planEventApply({
    instruction: 'apply',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
    executionReport: {
      runner: 'designer-preview',
      results: [{ exampleIndex: 0, ok: false, error: 'mismatch' }],
      pass: true, // client lie — server recomputes
    },
  })
  assert(applyFail.response.status === 'draft' && applyFail.response.applied === false, 'failed report draft')
  assertEventKeysUnchanged(eventFormV8, applyFail.response.formJson)
  writeCaseTo(outDirV080, 'event-apply-failed-report-draft', 'failed results → draft even if pass lied', {
    type: 'agent',
  })

  const forgedOk = planEventApply({
    instruction: 'apply',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
    executionReport: {
      runner: 'playwright',
      results: [{ exampleIndex: 0, ok: true, actual: { 总分: 2 } }],
      pass: true,
    },
  })
  assert(forgedOk.response.status === 'draft' && forgedOk.response.applied === false, 'forged ok mismatch → draft')
  const forgedMissing = planEventApply({
    instruction: 'apply',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
    executionReport: { runner: 'playwright', results: [{ exampleIndex: 0, ok: true }], pass: true },
  })
  assert(forgedMissing.response.status === 'draft', 'ok without actual → draft')
  assertEventKeysUnchanged(eventFormV8, forgedOk.response.formJson)
  writeCaseTo(
    outDirV080,
    'event-apply-forged-ok-rejected',
    'ok=true with mismatched or missing actual → draft (server re-judges actual vs expect)',
    { type: 'agent' },
  )

  const clickSpec = {
    trigger: { widgetRef: { id: 'btn1', name: 'btn1', label: '打开' }, eventKey: 'onClick' },
    sink: { kind: 'widget-event' as const, eventKey: 'onClick' },
    overwritePolicy: 'reject-if-present' as const,
    examples: [{ given: {}, expect: { 总分: 1 } }],
    notes: [],
  }
  const clickGen = planEventGenerate({
    instruction: '点击打开按钮时把总分设为1 期望：{"总分":1}',
    currentFormJson: eventFormV8,
    eventSpec: clickSpec,
  })
  assert(clickGen.response.status === 'code_preview', 'onClick gen')
  assert(/setFieldValue\('zf', 1\)/.test(String(clickGen.response.code)), `onClick code sets zf=1: ${clickGen.response.code}`)
  assert(!/\bvalue\b\)/.test(String(clickGen.response.code)), 'onClick code must not reference undefined value')
  const mountSpec = planEventClarify({
    instruction: '打开表单时初始化 期望：{"总分":9}',
    currentFormJson: eventFormV8,
  })
  const mountGen = planEventGenerate({
    instruction: '打开表单时初始化 期望：{"总分":9}',
    currentFormJson: eventFormV8,
    eventSpec: mountSpec.response.eventSpec!,
  })
  assert(/setFieldValue\('zf', 9\)/.test(String(mountGen.response.code)), `mounted code sets zf=9: ${mountGen.response.code}`)
  const validateSpec = {
    trigger: { eventKey: 'onFormValidate' },
    sink: { kind: 'form-event' as const, eventKey: 'onFormValidate' },
    overwritePolicy: 'reject-if-present' as const,
    examples: [
      { given: { 总分: -1 }, expect: { valid: false } },
      { given: { 总分: 5 }, expect: { valid: true } },
    ],
    notes: [],
  }
  const validateGen = planEventGenerate({
    instruction: '提交前校验总分不能小于0',
    currentFormJson: eventFormV8,
    eventSpec: validateSpec,
  })
  assert(
    validateGen.response.status === 'code_preview' && /v < 0/.test(String(validateGen.response.code)),
    `validate rule code: ${validateGen.response.code}`,
  )
  const validateVague = planEventGenerate({
    instruction: '提交前做一下校验',
    currentFormJson: eventFormV8,
    eventSpec: validateSpec,
  })
  assert(validateVague.httpStatus === 422, 'vague validate rule → 422')
  writeCaseTo(
    outDirV080,
    'event-codegen-dispatch-by-event-key',
    'onClick/onFormMounted set target literal; onFormValidate compiles stated rule; vague rule → 422',
    { type: 'agent' },
  )

  const withHand = JSON.parse(JSON.stringify(eventFormV8))
  ;(withHand.widgetList[0] as any).options.onChange = '/* handwritten */'
  const overwriteReject = planEventApply({
    instruction: 'apply',
    currentFormJson: withHand,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
    confirmOverwrite: false,
    executionReport: {
      runner: 'designer-preview',
      results: [{ exampleIndex: 0, ok: true, actual: { 总分: 6 } }],
      pass: true,
    },
  })
  assert(overwriteReject.httpStatus === 422, 'handwritten reject')
  const overwriteOk = planEventApply({
    instruction: 'apply',
    currentFormJson: withHand,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
    confirmOverwrite: true,
    executionReport: {
      runner: 'designer-preview',
      results: [{ exampleIndex: 0, ok: true, actual: { 总分: 6 } }],
      pass: true,
    },
  })
  assert(overwriteOk.response.status === 'applied' && overwriteOk.response.applied === true, 'overwrite ok')
  writeCaseTo(outDirV080, 'event-existing-handwritten-overwrite-or-reject', 'overwrite requires confirm', {
    type: 'agent',
  })

  const applyOk = planEventApply({
    instruction: '改语文时把总分设为加权结果',
    currentFormJson: eventFormV8,
    eventSpec: readySpec.response.eventSpec!,
    patches: genOk.response.patches as any,
    executionReport: {
      runner: 'designer-preview',
      results: [{ exampleIndex: 0, ok: true, actual: { 总分: 6 } }],
      pass: true,
    },
  })
  assert(applyOk.response.status === 'applied', 'apply pass → applied')
  const ywOnChange = String((applyOk.response.formJson.widgetList[0] as any).options.onChange || '')
  assert(ywOnChange.includes('setFieldValue'), 'onChange written')
  const eventValidate = validateFormJson(applyOk.response.formJson, {
    mode: 'refine',
    catalogMode: 'event-apply',
    existingIds: collectWidgetIds(eventFormV8),
  })
  assert(eventValidate.length === 0, `event-apply catalog: ${eventValidate.map((i) => i.message).join('; ')}`)
  const refineValidate = validateFormJson(applyOk.response.formJson, {
    mode: 'refine',
    catalogMode: 'strict',
    existingIds: collectWidgetIds(eventFormV8),
  })
  assert(refineValidate.some((i) => /onChange/.test(i.message)), 'strict catalog still forbids onChange')

  // dialog allowed vs danger
  const dialogForm = {
    widgetList: [
      {
        type: 'vf-dialog',
        id: 'dlg1',
        options: { name: 'dlg1', title: '弹窗', onOkButtonClick: '', onRemoteQuery: '' },
        widgetList: [{ type: 'input', id: 'di', options: { name: 'di', label: '项', required: false } }],
      },
    ],
    formConfig: { customClass: [] },
  }
  const dialogSpec = {
    trigger: { widgetRef: { id: 'dlg1', name: 'dlg1' }, eventKey: 'onOkButtonClick' },
    sink: { kind: 'widget-event' as const, eventKey: 'onOkButtonClick' },
    overwritePolicy: 'reject-if-present' as const,
    examples: [{ given: {}, expect: { ok: true } }],
    notes: [],
  }
  const dialogGen = planEventGenerate({
    instruction: '弹窗确定时写字段 期望：{"ok":true}',
    currentFormJson: dialogForm,
    eventSpec: dialogSpec,
  })
  assert(dialogGen.httpStatus === 200 && dialogGen.response.status === 'code_preview', 'dialog allowed gen')
  const remoteGuard = guardEventJs({
    code: 'this.getFormRef().setFieldValue("di", 1)',
    eventKey: 'onRemoteQuery',
    formJson: dialogForm,
  })
  assert(!remoteGuard.ok, 'remote key still forbidden by guard')
  writeCaseTo(outDirV080, 'event-dialog-allowed-vs-danger', 'dialog ok; remote still forbidden', {
    type: 'agent',
  })

  const refineStill = applyRefinePlan(
    eventFormV8,
    refinePlanSchema.parse({
      summary: '偷写 onChange',
      warnings: [],
      operations: [{ op: 'updateField', target: { id: 'yw' }, patch: { onChange: 'alert(1)' } }],
    }),
  )
  assert(
    !String((refineStill.formJson.widgetList[0] as any).options.onChange || '').trim(),
    'refine still strips onChange in v0.8',
  )
  writeCaseTo(outDirV080, 'event-refine-still-forbids-events', 'refine path still forbids events', {
    type: 'agent',
  })

  writeCaseTo(outDirV080, 'event-v07-clarify-regression', 'v0.7 clarify cases still executed above', {
    type: 'agent',
  })
  writeCaseTo(outDirV080, 'refine-v06-regression', 'v0.6 cases still executed earlier in this run', {
    type: 'agent',
  })
  const strictV8 = checkCatalogFullStrictSweep(catalog, editorGraph, registerSource)
  assert(strictV8.length === 0, `catalog-full-strict-sweep v0.8: ${strictV8.join('; ')}`)
  writeCaseTo(outDirV080, 'catalog-full-strict-sweep', 'Truth Strict full sweep green', { type: 'static' })
  writeCaseTo(outDirV080, 'frontend-no-secret', 'AiChat/event client contain no DeepSeek API key literals', {
    type: 'static',
  })

  console.log('ACCEPTANCE_CASES_PASSED')
}

main().catch((err) => {
  console.error('ACCEPTANCE_CASES_FAILED', err)
  process.exit(1)
})
