import {
  DISPLAY_STYLE_ENUM,
  FIELD_LABEL_ALIGN_ENUM,
  FORM_LABEL_ALIGN_ENUM,
  FORM_SIZE_ENUM,
  WIDGET_SIZE_ENUM,
  enumsEqual,
  parsePropertyRegister,
  propertyRegisterEditorFor,
  resolveEffectiveEditorName,
  type PropertyRegisterMaps,
} from './catalogPolicy.js'
import type { DesignTruthGraph } from './designTruthGraph.js'
import type { OptionConstraint, ValueKind, WidgetCatalog } from './widgetCatalog.js'

/**
 * 复合 editor 内嵌、尚未拆成独立 *-editor 的 enum（policy 层登记）。
 * 主路径：DesignTruthGraph editor.enum；此处仅兜底。
 */
export const POLICY_WIDGET_ENUMS_BY_TYPE: Record<
  string,
  Record<string, Array<string | number | boolean>>
> = {
  'data-table': {
    tableSize: ['large', 'default', 'small'],
    paginationAlign: ['left', 'center', 'right'],
  },
}

/** 表单级 enum（form-setting.vue / 高精度矩阵；非 widgetsConfig 指纹） */
export const FORM_POLICY_ENUMS: Record<string, Array<string | number | boolean>> = {
  labelPosition: ['left', 'right', 'top'],
  labelAlign: FORM_LABEL_ALIGN_ENUM,
  layoutType: ['PC', 'H5', 'Pad'],
  size: FORM_SIZE_ENUM,
}

/** 跨 type 通用 widget enum（property-editor 已验证） */
export const COMMON_WIDGET_POLICY_ENUMS: Record<string, Array<string | number | boolean>> = {
  labelAlign: FIELD_LABEL_ALIGN_ENUM,
  size: WIDGET_SIZE_ENUM,
  displayStyle: DISPLAY_STYLE_ENUM,
}

export function policyWidgetEnumFor(
  type: string,
  prop: string,
): Array<string | number | boolean> | undefined {
  return COMMON_WIDGET_POLICY_ENUMS[prop] ?? POLICY_WIDGET_ENUMS_BY_TYPE[type]?.[prop]
}

export function formPolicyEnumFor(key: string): Array<string | number | boolean> | undefined {
  return FORM_POLICY_ENUMS[key]
}

export function resolveCatalogEnumFromGraph(
  widgetType: string,
  prop: string,
  editorGraph: DesignTruthGraph,
  register: PropertyRegisterMaps,
): Array<string | number | boolean> | undefined {
  const policy = policyWidgetEnumFor(widgetType, prop)
  if (policy) return policy
  const editorName = resolveEffectiveEditorName(widgetType, prop, register, editorGraph)
  return editorName ? editorGraph.editors[editorName]?.enum : undefined
}

export function resolveFormCatalogEnum(
  prop: string,
  editorGraph: DesignTruthGraph,
  register: PropertyRegisterMaps,
): Array<string | number | boolean> | undefined {
  const policy = formPolicyEnumFor(prop)
  if (policy) return policy
  const editorName = propertyRegisterEditorFor(register, prop)
  return editorName ? editorGraph.editors[editorName]?.enum : undefined
}

export function expectedValueKindFromGraph(
  scope: 'widget' | 'form',
  type: string,
  prop: string,
  editorGraph: DesignTruthGraph,
  register: PropertyRegisterMaps,
): ValueKind | undefined {
  if (scope === 'form') {
    const editorName = propertyRegisterEditorFor(register, prop)
    return editorName ? editorGraph.editors[editorName]?.valueKind : undefined
  }
  const editorName = resolveEffectiveEditorName(type, prop, register, editorGraph)
  return editorName ? editorGraph.editors[editorName]?.valueKind : undefined
}

export function expectedEnumForSample(
  scope: 'widget' | 'form',
  type: string,
  prop: string,
  editorGraph: DesignTruthGraph,
  register: PropertyRegisterMaps,
): Array<string | number | boolean> | undefined {
  if (scope === 'form') {
    return resolveFormCatalogEnum(prop, editorGraph, register)
  }
  return resolveCatalogEnumFromGraph(type, prop, editorGraph, register)
}

export type CatalogSamplePair = { scope: 'widget' | 'form'; type: string; prop: string }

export const CATALOG_SAMPLE_SIZE = 50
export const CATALOG_SAMPLE_SEED = 0x4040

export function collectCatalogSampleCandidates(catalog: WidgetCatalog): CatalogSamplePair[] {
  const candidates: CatalogSamplePair[] = []
  for (const widget of catalog.widgets) {
    for (const prop of widget.applicableKeys || []) {
      if (prop === 'customClass') continue
      const constraint = widget.constraints[prop]
      if (!constraint) continue
      if (constraint.editor || constraint.enum?.length || constraint.valueKind === 'enum') {
        candidates.push({ scope: 'widget', type: widget.type, prop })
      }
    }
  }
  for (const prop of [...catalog.form.writableKeys, ...catalog.form.forbiddenKeys]) {
    if (prop === 'customClass') continue
    const constraint = catalog.form.constraints[prop]
    if (!constraint) continue
    if (constraint.editor || constraint.enum?.length || constraint.valueKind === 'enum') {
      candidates.push({ scope: 'form', type: 'form', prop })
    }
  }
  return candidates.sort((a, b) => `${a.type}.${a.prop}`.localeCompare(`${b.type}.${b.prop}`))
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function pickCatalogSamplePairs(
  candidates: CatalogSamplePair[],
  size = CATALOG_SAMPLE_SIZE,
  seed = CATALOG_SAMPLE_SEED,
): CatalogSamplePair[] {
  if (candidates.length <= size) return candidates
  const rng = mulberry32(seed)
  const picked = new Set<number>()
  while (picked.size < size) {
    picked.add(Math.floor(rng() * candidates.length))
  }
  return [...picked]
    .sort((a, b) => a - b)
    .map((i) => candidates[i])
}

export function checkCatalogSampleParity(
  catalog: WidgetCatalog,
  editorGraph: DesignTruthGraph,
  registerSource: string,
): string[] {
  const issues: string[] = []
  const register = parsePropertyRegister(registerSource)
  const candidates = collectCatalogSampleCandidates(catalog)
  if (candidates.length < CATALOG_SAMPLE_SIZE) {
    issues.push(
      `catalog sample candidates too few: ${candidates.length} expected at least ${CATALOG_SAMPLE_SIZE}`,
    )
  }
  const sample = pickCatalogSamplePairs(candidates)
  if (sample.length !== Math.min(CATALOG_SAMPLE_SIZE, candidates.length)) {
    issues.push(`catalog sample size expected ${Math.min(CATALOG_SAMPLE_SIZE, candidates.length)} got ${sample.length}`)
  }

  for (const { scope, type, prop } of sample) {
    const label = scope === 'form' ? `form.${prop}` : `${type}.${prop}`
    const constraint =
      scope === 'form'
        ? catalog.form.constraints[prop]
        : catalog.widgets.find((w) => w.type === type)?.constraints[prop]
    if (!constraint) {
      issues.push(`${label} missing constraint in catalog sample`)
      continue
    }

    const expectedKind = expectedValueKindFromGraph(scope, type, prop, editorGraph, register)
    if (expectedKind && constraint.valueKind && constraint.valueKind !== expectedKind) {
      if (!(constraint.enum?.length && expectedKind === 'enum')) {
        issues.push(`${label} valueKind catalog=${constraint.valueKind} editor=${expectedKind}`)
      }
    }

    const expectedEnum = expectedEnumForSample(scope, type, prop, editorGraph, register)
    if (expectedEnum?.length || constraint.enum?.length) {
      if (!enumsEqual(constraint.enum, expectedEnum)) {
        issues.push(
          `${label} enum mismatch catalog=[${(constraint.enum || []).join(',')}] expected=[${(expectedEnum || []).join(',')}]`,
        )
      }
    }
  }

  return issues
}

export function checkPolicyEnumConvergence(): string[] {
  const issues: string[] = []
  const policyTypeCount = Object.keys(POLICY_WIDGET_ENUMS_BY_TYPE).length
  if (policyTypeCount > 2) {
    issues.push(`POLICY_WIDGET_ENUMS_BY_TYPE should stay minimal; got ${policyTypeCount} types`)
  }
  if (!POLICY_WIDGET_ENUMS_BY_TYPE['data-table']?.tableSize) {
    issues.push('data-table.tableSize policy enum missing')
  }
  return issues
}
