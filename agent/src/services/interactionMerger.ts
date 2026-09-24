import { createHash } from 'node:crypto'
import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput, InteractionScenario, InteractionStructureOp } from '../schemas/interactionOutput.js'
import { buildWidgetFromCatalogDefaults } from '../knowledge/widgetDefaults.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'
import { isInterfaceEventKey } from '../knowledge/eventAllowlist.js'
import { INTERACTION_EVENT_KEYS } from './interactionValidate.js'

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: WidgetNode[]
}

function cloneForm(formJson: FormJson): FormJson {
  return JSON.parse(JSON.stringify(formJson)) as FormJson
}

function walkWidgets(nodes: WidgetNode[] | undefined, out: WidgetNode[] = []): WidgetNode[] {
  if (!nodes) return out
  for (const n of nodes) {
    out.push(n)
    walkWidgets(n.widgetList, out)
    walkWidgets(n.tabs, out)
    walkWidgets(n.cols, out)
    if (Array.isArray(n.rows)) {
      for (const row of n.rows) walkWidgets((row as WidgetNode).cols || (row as WidgetNode).widgetList, out)
    }
  }
  return out
}

function findByNameOrId(formJson: FormJson, hint: string): WidgetNode | undefined {
  const h = String(hint || '').trim()
  if (!h) return undefined
  const all = walkWidgets(formJson.widgetList as WidgetNode[])
  return (
    all.find((w) => String(w.options?.name || '') === h) ||
    all.find((w) => w.id === h) ||
    all.find((w) => String(w.options?.label || '') === h)
  )
}

/** 匹配 target：精确 name，或 eachTabPane 派生名 `base__paneName` */
export function resolveHandlerTargets(formJson: FormJson, target: string): WidgetNode[] {
  if (target === 'form') return []
  const all = walkWidgets(formJson.widgetList as WidgetNode[])
  const exact = all.filter((w) => String(w.options?.name || '') === target || w.id === target)
  if (exact.length) return exact
  const prefix = `${target}__`
  return all.filter((w) => String(w.options?.name || '').startsWith(prefix))
}

function slugName(label: string, fallback: string): string {
  const raw = String(label || '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!raw) return fallback
  if (/^[a-zA-Z_]/.test(raw)) return raw.slice(0, 48)
  return `${fallback}_${raw}`.slice(0, 48)
}

function uniqueButtonName(formJson: FormJson, base: string): string {
  const used = new Set(
    walkWidgets(formJson.widgetList as WidgetNode[]).map((w) => String(w.options?.name || '')),
  )
  if (!used.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const n = `${base}_${i}`
    if (!used.has(n)) return n
  }
  return `${base}_${Date.now()}`
}

function makeButton(formJson: FormJson, label: string, nameHint: string, overrides?: Record<string, unknown>) {
  const name = uniqueButtonName(formJson, nameHint)
  const id = `btn_${name}`
  return buildWidgetFromCatalogDefaults('button', {
    id,
    name,
    label,
    optionOverrides: {
      ...(overrides || {}),
      name,
      label,
    },
  }) as WidgetNode
}

function findTabPanes(formJson: FormJson): WidgetNode[] {
  return walkWidgets(formJson.widgetList as WidgetNode[]).filter((w) => w.type === 'tab-pane')
}

function appendToList(list: WidgetNode[] | undefined, node: WidgetNode): WidgetNode[] {
  const next = list ? [...list] : []
  next.push(node)
  return next
}

function applyAddButton(
  formJson: FormJson,
  op: Extract<InteractionStructureOp, { op: 'addButton' }>,
  warnings: string[],
): { error?: string } {
  const label = op.label
  const baseName = op.name || slugName(label, 'btn')
  const overrides = op.optionOverrides

  if (op.eachTabPane) {
    const panes = findTabPanes(formJson)
    if (!panes.length) return { error: 'addButton eachTabPane: 表单中没有 tab-pane' }
    for (const pane of panes) {
      const paneName = String(pane.options?.name || pane.id || 'pane')
      const btnName = `${baseName}__${paneName}`
      const btn = makeButton(formJson, label, btnName, overrides)
      // makeButton already uniquified; force exact derived name if free
      const forcedName = uniqueButtonName(formJson, btnName)
      ;(btn.options as Record<string, unknown>).name = forcedName
      btn.id = `btn_${forcedName}`
      pane.widgetList = appendToList(pane.widgetList, btn)
      warnings.push(`addButton:${forcedName}@${paneName}`)
    }
    return {}
  }

  if (op.parent) {
    const parentHint = op.parent.id || op.parent.name || op.parent.label
    if (!parentHint) return { error: 'addButton parent 缺少 id/name/label' }
    const parent = findByNameOrId(formJson, parentHint)
    if (!parent) return { error: `addButton parent 未找到: ${parentHint}` }
    const btn = makeButton(formJson, label, baseName, overrides)
    parent.widgetList = appendToList(parent.widgetList, btn)
    warnings.push(`addButton:${btn.options?.name}@${parentHint}`)
    return {}
  }

  const btn = makeButton(formJson, label, baseName, overrides)
  formJson.widgetList = appendToList(formJson.widgetList as WidgetNode[], btn)
  warnings.push(`addButton:${btn.options?.name}@root`)
  return {}
}

function writeHandler(
  formJson: FormJson,
  target: string,
  eventKey: string,
  code: string,
  opts?: { confirmOverwrite?: boolean },
): { error?: string; warnings: string[] } {
  const warnings: string[] = []
  if (isInterfaceEventKey(eventKey) || !INTERACTION_EVENT_KEYS.has(eventKey)) {
    return { error: `禁写事件键：${eventKey}`, warnings }
  }

  if (target === 'form') {
    const existing = String((formJson.formConfig || {})[eventKey] || '')
    if (existing.trim() && !opts?.confirmOverwrite) {
      return { error: `form.${eventKey} 已有代码，需 confirmOverwrite`, warnings }
    }
    if (existing.trim()) warnings.push(`overwrite:form.${eventKey}`)
    formJson.formConfig = { ...(formJson.formConfig || {}), [eventKey]: code }
    return { warnings }
  }

  const targets = resolveHandlerTargets(formJson, target)
  if (!targets.length) return { error: `handler target 未找到: ${target}`, warnings }

  for (const w of targets) {
    const existing = String((w.options || {})[eventKey] || '')
    if (existing.trim() && !opts?.confirmOverwrite) {
      return {
        error: `${w.options?.name || w.id}.${eventKey} 已有代码，需 confirmOverwrite`,
        warnings,
      }
    }
    if (existing.trim()) warnings.push(`overwrite:${w.options?.name}.${eventKey}`)
    w.options = { ...(w.options || {}), [eventKey]: code }
  }
  return { warnings }
}

export type InteractionMergeResult =
  | { ok: true; formJson: FormJson; warnings: string[] }
  | { ok: false; error: string; httpStatus: 422 }

/**
 * 结构 + 事件同一事务：任一步失败则整单失败（调用方丢弃候选，保留原 formJson）。
 * 不走 v0.8 eventJsGuard 白名单，仅网络静态检查。
 */
export function applyInteractionOutput(
  currentFormJson: FormJson,
  output: InteractionOutput,
  opts?: { confirmOverwrite?: boolean },
): InteractionMergeResult {
  if (output.intent !== 'interaction' && output.intent !== 'mixed') {
    return { ok: false, error: `intent=${output.intent} 不可合入`, httpStatus: 422 }
  }

  const net = checkHandlersNetworkStatic(output.handlers)
  if (!net.ok) {
    return { ok: false, error: net.message, httpStatus: 422 }
  }

  const next = cloneForm(currentFormJson)
  const warnings: string[] = []

  for (const op of output.structure) {
    if (op.op === 'addButton') {
      const r = applyAddButton(next, op as Extract<InteractionStructureOp, { op: 'addButton' }>, warnings)
      if (r.error) return { ok: false, error: r.error, httpStatus: 422 }
    } else {
      return {
        ok: false,
        error: `交互合入暂不支持 structure.op=${op.op}（仅 addButton；纯结构请走 /refine）`,
        httpStatus: 422,
      }
    }
  }

  for (const h of output.handlers) {
    const r = writeHandler(next, h.target, h.eventKey, h.code, opts)
    if (r.error) return { ok: false, error: r.error, httpStatus: 422 }
    warnings.push(...r.warnings)
  }

  return { ok: true, formJson: next, warnings }
}

/** 场景指纹：修正轮不得改动断言 */
export function scenarioFingerprint(scenarios: InteractionScenario[]): string {
  const normalized = scenarios.map((s) => ({
    id: s.id,
    handlerRefs: [...s.handlerRefs].sort(),
    arrange: s.arrange,
    act: s.act,
    assert: s.assert,
  }))
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
