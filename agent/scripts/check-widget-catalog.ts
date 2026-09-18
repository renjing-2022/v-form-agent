import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkWidgetCatalogSync } from '../src/knowledge/widgetCatalogStore.js'
import {
  assertEditorEnumsMatchDesignTruth,
  checkApplicableKeysParity,
  checkCreateWhitelistPolicy,
  checkFormFieldDualTrackParity,
  checkHighPrecisionCoverage,
  checkIdentityForbiddenParity,
  checkRenderConventionParity,
  checkExtensionBoundaryParity,
  checkCatalogSampleParity,
  checkPolicyEnumConvergence,
  checkPropertyRegisterParity,
  checkWidgetsConfigCatalogTypeParity,
  listWidgetsConfigUniqueTypes,
} from '../src/knowledge/generateWidgetCatalog.js'
import { checkDesignTruthGraphParity } from '../src/knowledge/compileDesignTruthGraph.js'

import { checkContainerRefinePolicyParity } from '../src/knowledge/containerRefinePolicy.js'
import { checkCompositeSchemaParity } from '../src/knowledge/compositeSchemaPolicy.js'
import { checkContainerLevelPropertyParity } from '../src/knowledge/containerLevelPolicy.js'
import { REFINE_CREATE_WHITELIST, CREATE_NON_GOAL } from '../src/knowledge/createWhitelistPolicy.js'
import { PROPERTY_REGISTER_REL } from '../src/knowledge/catalogPolicy.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const editorIssues = assertEditorEnumsMatchDesignTruth(root)
if (editorIssues.length) {
  console.error('DESIGN_TRUTH_EDITOR_MISMATCH')
  for (const issue of editorIssues) console.error(`- ${issue}`)
  process.exit(1)
}

const { catalog, editorGraph, catalogDiffs, graphDiffs } = await checkWidgetCatalogSync(root)
if (catalogDiffs.length > 0) {
  console.error('WIDGET_CATALOG_DRIFT')
  for (const diff of catalogDiffs) console.error(`- ${diff}`)
  process.exit(1)
}
if (graphDiffs.length > 0) {
  console.error('DESIGN_TRUTH_GRAPH_DRIFT')
  for (const diff of graphDiffs) console.error(`- ${diff}`)
  process.exit(1)
}

const coverage = checkHighPrecisionCoverage(catalog)
if (coverage.length) {
  console.error('HIGH_PRECISION_COVERAGE_FAILED')
  for (const issue of coverage) console.error(`- ${issue}`)
  process.exit(1)
}

const applicable = checkApplicableKeysParity(catalog)
if (applicable.length) {
  console.error('APPLICABLE_KEYS_PARITY_FAILED')
  for (const issue of applicable) console.error(`- ${issue}`)
  process.exit(1)
}

const wcTypes = await listWidgetsConfigUniqueTypes(root)
const wcParity = checkWidgetsConfigCatalogTypeParity(catalog, wcTypes)
if (wcParity.length) {
  console.error('WIDGETS_CONFIG_CATALOG_TYPE_PARITY_FAILED')
  for (const issue of wcParity) console.error(`- ${issue}`)
  process.exit(1)
}

const createWhitelist = checkCreateWhitelistPolicy(catalog)
if (createWhitelist.length) {
  console.error('CREATE_WHITELIST_CATALOG_PARITY_FAILED')
  for (const issue of createWhitelist) console.error(`- ${issue}`)
  process.exit(1)
}

const registerParity = checkPropertyRegisterParity(root, catalog)
if (registerParity.length) {
  console.error('PROPERTY_REGISTER_PARITY_FAILED')
  for (const issue of registerParity) console.error(`- ${issue}`)
  process.exit(1)
}

const editorGraphParity = checkDesignTruthGraphParity(root, editorGraph)
if (editorGraphParity.length) {
  console.error('DESIGN_TRUTH_GRAPH_PARITY_FAILED')
  for (const issue of editorGraphParity) console.error(`- ${issue}`)
  process.exit(1)
}

const containerRefine = checkContainerRefinePolicyParity(catalog)
if (containerRefine.length) {
  console.error('CONTAINER_REFINE_POLICY_FAILED')
  for (const issue of containerRefine) console.error(`- ${issue}`)
  process.exit(1)
}

const compositeSchema = checkCompositeSchemaParity(catalog)
if (compositeSchema.length) {
  console.error('COMPOSITE_SCHEMA_PARITY_FAILED')
  for (const issue of compositeSchema) console.error(`- ${issue}`)
  process.exit(1)
}

const containerLevel = checkContainerLevelPropertyParity(catalog)
if (containerLevel.length) {
  console.error('CONTAINER_LEVEL_PROPERTY_FAILED')
  for (const issue of containerLevel) console.error(`- ${issue}`)
  process.exit(1)
}

const dualTrack = checkFormFieldDualTrackParity(catalog)
if (dualTrack.length) {
  console.error('FORM_FIELD_DUAL_TRACK_FAILED')
  for (const issue of dualTrack) console.error(`- ${issue}`)
  process.exit(1)
}

const identityForbidden = checkIdentityForbiddenParity(catalog)
if (identityForbidden.length) {
  console.error('IDENTITY_FORBIDDEN_PARITY_FAILED')
  for (const issue of identityForbidden) console.error(`- ${issue}`)
  process.exit(1)
}

const renderConvention = checkRenderConventionParity(root, catalog)
if (renderConvention.length) {
  console.error('RENDER_CONVENTION_PARITY_FAILED')
  for (const issue of renderConvention) console.error(`- ${issue}`)
  process.exit(1)
}

const extensionBoundary = checkExtensionBoundaryParity(root, catalog)
if (extensionBoundary.length) {
  console.error('EXTENSION_BOUNDARY_POLICY_FAILED')
  for (const issue of extensionBoundary) console.error(`- ${issue}`)
  process.exit(1)
}

const enumConvergence = checkPolicyEnumConvergence()
if (enumConvergence.length) {
  console.error('POLICY_ENUM_CONVERGENCE_FAILED')
  for (const issue of enumConvergence) console.error(`- ${issue}`)
  process.exit(1)
}

const registerSource = fs.readFileSync(path.join(root, PROPERTY_REGISTER_REL), 'utf8')
const catalogSample = checkCatalogSampleParity(catalog, editorGraph, registerSource)
if (catalogSample.length) {
  console.error('CATALOG_SAMPLE_PARITY_FAILED')
  for (const issue of catalogSample) console.error(`- ${issue}`)
  process.exit(1)
}

console.log(
  `WIDGET_CATALOG_SYNC widgetTypes=${catalog.widgets.length} widgetsConfigTypes=${wcTypes.length} createAllowed=${REFINE_CREATE_WHITELIST.length} createNonGoal=${Object.keys(CREATE_NON_GOAL).length} editors=${editorGraph.source.editorFileCount} typeOverrides=${editorGraph.typeOverrides.length} fingerprint=${catalog.source.fingerprint} graphFingerprint=${editorGraph.source.fingerprint}`,
)
console.log('DESIGN_TRUTH_CATALOG_SYNC_OK')
