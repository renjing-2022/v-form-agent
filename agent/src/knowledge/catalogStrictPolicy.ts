import {
  deriveValueKind,
  parsePropertyRegister,
  propertyRegisterEditorFor,
  resolveEffectiveEditorName,
  type PropertyRegisterMaps,
} from './catalogPolicy.js'
import type { DesignTruthGraph } from './designTruthGraph.js'
import type { OptionConstraint, WidgetCatalog } from './widgetCatalog.js'

/** applicable 键无 editor 且暂无法从 graph 解析时的登记 gap（须随 Compiler 收敛而缩小） */
export const CATALOG_STRICT_KNOWN_GAPS: ReadonlyArray<{
  scope: 'widget' | 'form'
  type: string
  prop: string
  reason: string
}> = []

/** 出厂指纹为 null/undefined 的多态键：A2 不强制 strict（defaultValue 可为 number/string/array） */
export const A2_NON_STRICT_PROPS = new Set(['defaultValue'])

export type CatalogStrictGap = {
  scope: 'widget' | 'form'
  type: string
  prop: string
  reason: string
}

function finalizeStrictConstraint(key: string, constraint: OptionConstraint): OptionConstraint {
  const valueKind = constraint.valueKind ?? deriveValueKind(key, constraint)
  if (A2_NON_STRICT_PROPS.has(key)) {
    return { ...constraint, valueKind, strict: false }
  }
  return {
    ...constraint,
    valueKind,
    strict: true,
  }
}

/** v0.5 A2：全部 applicable / form 可见键 strict + valueKind（enum 由 withEnumsAndSources / enrich 已写入，此处不重复解析） */
export function applyA2StrictConstraints(
  constraints: Record<string, OptionConstraint>,
): Record<string, OptionConstraint> {
  return Object.fromEntries(
    Object.entries(constraints).map(([key, constraint]) => [key, finalizeStrictConstraint(key, constraint)]),
  )
}

export function applyA2StrictWidgetConstraints(
  _type: string,
  constraints: Record<string, OptionConstraint>,
  _editorGraph: DesignTruthGraph,
  _editorMap: PropertyRegisterMaps,
): Record<string, OptionConstraint> {
  return applyA2StrictConstraints(constraints)
}

export function applyA2StrictFormConstraints(
  constraints: Record<string, OptionConstraint>,
  _editorGraph: DesignTruthGraph,
  _editorMap: PropertyRegisterMaps,
): Record<string, OptionConstraint> {
  return applyA2StrictConstraints(constraints)
}

function isKnownGap(scope: 'widget' | 'form', type: string, prop: string): boolean {
  return CATALOG_STRICT_KNOWN_GAPS.some(
    (g) => g.scope === scope && g.type === type && g.prop === prop,
  )
}

export function collectCatalogStrictGaps(
  catalog: WidgetCatalog,
  _editorGraph: DesignTruthGraph,
  _registerSource: string,
): CatalogStrictGap[] {
  const gaps: CatalogStrictGap[] = []

  const pushIf = (gap: CatalogStrictGap) => {
    if (!isKnownGap(gap.scope, gap.type, gap.prop)) gaps.push(gap)
  }

  for (const widget of catalog.widgets) {
    for (const prop of widget.applicableKeys || []) {
      const constraint = widget.constraints[prop]
      if (!constraint) {
        pushIf({ scope: 'widget', type: widget.type, prop, reason: 'missing constraint' })
        continue
      }
      if (!constraint.valueKind) {
        pushIf({ scope: 'widget', type: widget.type, prop, reason: 'missing valueKind' })
      }
      if (!constraint.strict && !A2_NON_STRICT_PROPS.has(prop)) {
        pushIf({ scope: 'widget', type: widget.type, prop, reason: 'missing strict' })
      }
      if (constraint.valueKind === 'enum' && !constraint.enum?.length) {
        pushIf({ scope: 'widget', type: widget.type, prop, reason: 'enum valueKind without enum' })
      }
    }
  }

  for (const prop of [...catalog.form.writableKeys, ...catalog.form.forbiddenKeys]) {
    const constraint = catalog.form.constraints[prop]
    if (!constraint) {
      pushIf({ scope: 'form', type: 'form', prop, reason: 'missing constraint' })
      continue
    }
    if (!constraint.valueKind) {
      pushIf({ scope: 'form', type: 'form', prop, reason: 'missing valueKind' })
    }
    if (!constraint.strict && !A2_NON_STRICT_PROPS.has(prop)) {
      pushIf({ scope: 'form', type: 'form', prop, reason: 'missing strict' })
    }
    if (constraint.valueKind === 'enum' && !constraint.enum?.length) {
      pushIf({ scope: 'form', type: 'form', prop, reason: 'enum valueKind without enum' })
    }
  }

  return gaps
}

/** 未挂 property-editor 的 applicable 键（known-gap 输入；不阻塞 strict sweep） */
export function collectCatalogStrictEditorGaps(
  catalog: WidgetCatalog,
  editorGraph: DesignTruthGraph,
  registerSource: string,
): CatalogStrictGap[] {
  const gaps: CatalogStrictGap[] = []
  const register = parsePropertyRegister(registerSource)

  for (const widget of catalog.widgets) {
    for (const prop of widget.applicableKeys || []) {
      if (isKnownGap('widget', widget.type, prop)) continue
      const constraint = widget.constraints[prop]
      if (!constraint || constraint.compositeSchema) continue
      const editor = resolveEffectiveEditorName(widget.type, prop, register, editorGraph)
      if (!editor) {
        gaps.push({ scope: 'widget', type: widget.type, prop, reason: 'no resolved editor' })
      }
    }
  }

  for (const prop of [...catalog.form.writableKeys, ...catalog.form.forbiddenKeys]) {
    if (isKnownGap('form', 'form', prop)) continue
    const constraint = catalog.form.constraints[prop]
    if (!constraint || constraint.compositeSchema) continue
    const editor = propertyRegisterEditorFor(register, prop)
    if (!editor && constraint.source !== 'render-convention' && constraint.source !== 'policy') {
      gaps.push({ scope: 'form', type: 'form', prop, reason: 'no resolved editor' })
    }
  }

  return gaps
}

export function checkCatalogFullStrictSweep(
  catalog: WidgetCatalog,
  editorGraph: DesignTruthGraph,
  registerSource: string,
): string[] {
  return collectCatalogStrictGaps(catalog, editorGraph, registerSource).map(
    (g) => `${g.scope}:${g.type}.${g.prop} — ${g.reason}`,
  )
}

export function formatCatalogStrictGapReport(gaps: CatalogStrictGap[]): string {
  if (gaps.length === 0) return 'catalog-full-strict-sweep: pass (0 gaps)'
  const lines = gaps.map((g) => `- ${g.scope}:${g.type}.${g.prop} — ${g.reason}`)
  return [`catalog-full-strict-sweep: ${gaps.length} gap(s)`, ...lines].join('\n')
}
