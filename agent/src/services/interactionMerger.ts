import { createHash } from 'node:crypto'
import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput, InteractionScenario, InteractionStructureOp } from '../schemas/interactionOutput.js'
import type { EventMergeMode, EventResolution } from '../schemas/clarification.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'
import { isInterfaceEventKey } from '../knowledge/eventAllowlist.js'
import { catalogEventKeysForType, INTERACTION_EVENT_KEYS } from './interactionValidate.js'
import { applyMergeMode, buildEventConflict } from './eventAstMerge.js'
import type { EventConflict } from '../schemas/clarification.js'
import {
  applyCreateBatchInPlace,
  createSpecFromAddButton,
} from './createCompiler.js'
import type { CreateWidgetOp, CreateWidgetSpec } from '../schemas/createWidget.js'

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

function findTabPanes(formJson: FormJson): WidgetNode[] {
  return walkWidgets(formJson.widgetList as WidgetNode[]).filter((w) => w.type === 'tab-pane')
}

function applyCreateWidgetStructure(
  formJson: FormJson,
  specs: CreateWidgetSpec[],
  warnings: string[],
): { error?: string; tempRefMap: Map<string, { tempRef: string; id: string; name: string; type: string }> } {
  const result = applyCreateBatchInPlace(formJson, specs)
  warnings.push(...result.warnings)
  if (!result.ok) {
    return {
      error: result.errors.map((e) => e.message).join('; ') || 'createWidget 失败',
      tempRefMap: result.tempRefMap,
    }
  }
  return { tempRefMap: result.tempRefMap }
}

/** 将 handler/scenario 中的 tempRef 解析为真实 name（结构候选完成后） */
export function rewriteTempRefsInOutput(
  output: InteractionOutput,
  tempRefMap: Map<string, { name: string }>,
): InteractionOutput {
  if (!tempRefMap.size) return output
  const resolve = (hint: string) => tempRefMap.get(hint)?.name || hint
  const handlers = output.handlers.map((h) => ({
    ...h,
    target: resolve(h.target),
  }))
  const scenarios = output.scenarios.map((sc) => ({
    ...sc,
    handlerRefs: sc.handlerRefs.map((ref) => {
      // id / target:eventKey / target
      if (tempRefMap.has(ref)) return resolve(ref)
      const colon = ref.indexOf(':')
      if (colon > 0) {
        const left = ref.slice(0, colon)
        const right = ref.slice(colon + 1)
        if (tempRefMap.has(left)) return `${resolve(left)}:${right}`
      }
      return ref
    }),
    arrange: {
      ...sc.arrange,
      values: sc.arrange?.values
        ? Object.fromEntries(
            Object.entries(sc.arrange.values).map(([k, v]) => [resolve(k), v]),
          )
        : sc.arrange?.values,
    },
    act: sc.act.map((step) => {
      const next: Record<string, unknown> = { ...(step as object) }
      for (const key of [
        'input',
        'clear',
        'select',
        'toggle',
        'rate',
        'slide',
        'pickDate',
        'pickTime',
        'click',
      ]) {
        if (typeof next[key] === 'string') next[key] = resolve(String(next[key]))
      }
      return next
    }) as InteractionOutput['scenarios'][number]['act'],
    assert: sc.assert.map((a) => {
      if ('field' in a && typeof a.field === 'string') {
        return { ...a, field: resolve(a.field) }
      }
      return a
    }),
  }))
  return { ...output, handlers, scenarios }
}

function expandAddButtonSpecs(
  formJson: FormJson,
  op: Extract<InteractionStructureOp, { op: 'addButton' }>,
): { specs?: CreateWidgetSpec[]; error?: string } {
  const label = op.label
  const baseName = op.name || slugName(label, 'btn')

  if (op.eachTabPane) {
    const panes = findTabPanes(formJson)
    if (!panes.length) return { error: 'addButton eachTabPane: 表单中没有 tab-pane' }
    return {
      specs: panes.map((pane) => {
        const paneName = String(pane.options?.name || pane.id || 'pane')
        const parent =
          typeof pane.options?.name === 'string' && pane.options.name
            ? { name: pane.options.name }
            : { id: String(pane.id || '') }
        return createSpecFromAddButton({
          label,
          name: `${baseName}__${paneName}`,
          parent,
          optionOverrides: op.optionOverrides,
        })
      }),
    }
  }

  return {
    specs: [
      createSpecFromAddButton({
        label,
        name: baseName,
        parent: op.parent,
        optionOverrides: op.optionOverrides,
      }),
    ],
  }
}

function writeHandler(
  formJson: FormJson,
  target: string,
  eventKey: string,
  code: string,
  opts?: { confirmOverwrite?: boolean; mergeMode?: 'prepend' | 'append' | 'overwrite' },
): { error?: string; warnings: string[]; skipped?: boolean } {
  const warnings: string[] = []
  if (isInterfaceEventKey(eventKey) || !INTERACTION_EVENT_KEYS.has(eventKey)) {
    return { error: `禁写事件键：${eventKey}`, warnings }
  }
  if (target !== 'form') {
    const nodes = resolveHandlerTargets(formJson, target)
    const type = nodes[0]?.type
    if (type) {
      const allowed = catalogEventKeysForType(String(type))
      if (allowed.length && !allowed.includes(eventKey)) {
        return { error: `eventKey "${eventKey}" 不在 type=${type} 的 Catalog create.eventKeys`, warnings }
      }
    }
  }

  const mode = opts?.mergeMode || (opts?.confirmOverwrite ? 'overwrite' : undefined)

  if (target === 'form') {
    const existing = String((formJson.formConfig || {})[eventKey] || '')
    if (existing.trim()) {
      if (!mode) {
        return { error: `form.${eventKey} 已有代码，需 eventResolutions 或 confirmOverwrite`, warnings }
      }
      if (mode === 'overwrite') {
        warnings.push(`overwrite:form.${eventKey}`)
        formJson.formConfig = { ...(formJson.formConfig || {}), [eventKey]: code }
        return { warnings }
      }
      const merged = applyMergeMode(mode, existing, code)
      if (!merged.ok) {
        if ('skip' in merged && merged.skip) return { warnings, skipped: true }
        return { error: 'error' in merged ? merged.error : 'merge failed', warnings }
      }
      warnings.push(`${mode}:form.${eventKey}`)
      formJson.formConfig = { ...(formJson.formConfig || {}), [eventKey]: merged.code }
      return { warnings }
    }
    formJson.formConfig = { ...(formJson.formConfig || {}), [eventKey]: code }
    return { warnings }
  }

  const targets = resolveHandlerTargets(formJson, target)
  if (!targets.length) return { error: `handler target 未找到: ${target}`, warnings }

  for (const w of targets) {
    const existing = String((w.options || {})[eventKey] || '')
    if (existing.trim()) {
      if (!mode) {
        return {
          error: `${w.options?.name || w.id}.${eventKey} 已有代码，需 eventResolutions 或 confirmOverwrite`,
          warnings,
        }
      }
      if (mode === 'overwrite') {
        warnings.push(`overwrite:${w.options?.name}.${eventKey}`)
        w.options = { ...(w.options || {}), [eventKey]: code }
        continue
      }
      const merged = applyMergeMode(mode, existing, code)
      if (!merged.ok) {
        if ('skip' in merged && merged.skip) {
          warnings.push(`cancel:${w.options?.name}.${eventKey}`)
          continue
        }
        return { error: 'error' in merged ? merged.error : 'merge failed', warnings }
      }
      warnings.push(`${mode}:${w.options?.name}.${eventKey}`)
      w.options = { ...(w.options || {}), [eventKey]: merged.code }
      continue
    }
    w.options = { ...(w.options || {}), [eventKey]: code }
  }
  return { warnings }
}

export type InteractionMergeResult =
  | { ok: true; formJson: FormJson; warnings: string[]; outputResolved: InteractionOutput }
  | { ok: false; error: string; httpStatus: 422 }

/**
 * 结构 + 事件同一事务：
 * 1) 编译并写入全部结构候选；
 * 2) 解析 tempRef → name；
 * 3) 再绑定 handlers。
 * 任一步失败则整单失败（调用方丢弃候选，保留原 formJson）。
 */
export function applyInteractionOutput(
  currentFormJson: FormJson,
  output: InteractionOutput,
  opts?: {
    confirmOverwrite?: boolean
    eventResolutions?: EventResolution[]
    /** 预览：冲突键临时按 overwrite 写入候选，同时仍应下发 eventConflicts */
    previewForceOverwrite?: boolean
  },
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
  const resolutionMap = new Map<string, EventMergeMode>()
  for (const r of opts?.eventResolutions || []) {
    resolutionMap.set(`${r.target}::${r.eventKey}`, r.mode)
  }

  // ---- 1) 结构候选（批量，原子）----
  const structureSpecs: CreateWidgetSpec[] = []
  for (const op of output.structure) {
    if (op.op === 'createWidget') {
      const { op: _discard, ...spec } = op as CreateWidgetOp
      void _discard
      structureSpecs.push(spec)
    } else if (op.op === 'addButton') {
      const expanded = expandAddButtonSpecs(
        next,
        op as Extract<InteractionStructureOp, { op: 'addButton' }>,
      )
      if (expanded.error) return { ok: false, error: expanded.error, httpStatus: 422 }
      structureSpecs.push(...(expanded.specs || []))
    } else {
      return {
        ok: false,
        error: `交互合入暂不支持 structure.op=${op.op}（仅 createWidget/addButton；纯结构请走 /refine）`,
        httpStatus: 422,
      }
    }
  }

  let structureWrote = false
  let tempRefMap = new Map<string, { tempRef: string; id: string; name: string; type: string }>()
  if (structureSpecs.length) {
    const r = applyCreateWidgetStructure(next, structureSpecs, warnings)
    if (r.error) return { ok: false, error: r.error, httpStatus: 422 }
    tempRefMap = r.tempRefMap
    structureWrote = true
  }

  // ---- 2) tempRef 解析后再绑事件 ----
  const resolved = rewriteTempRefsInOutput(output, tempRefMap)
  // eventResolutions 的 target 也可能是 tempRef
  const resolvedResolutionMap = new Map<string, EventMergeMode>()
  for (const [key, mode] of resolutionMap) {
    const [t, ek] = key.split('::')
    const rt = tempRefMap.get(t)?.name || t
    resolvedResolutionMap.set(`${rt}::${ek}`, mode)
  }

  let handlerWrote = false
  let handlerSkippedAll = (resolved.handlers?.length || 0) > 0
  for (const h of resolved.handlers) {
    const key = `${h.target}::${h.eventKey}`
    const existing = readExistingHandlerCode(currentFormJson, h.target, h.eventKey)
    // 也查原始 form 上按 resolved name；tempRef 不会在原 form 上
    let mergeMode: EventMergeMode | undefined = resolvedResolutionMap.get(key)
    if (existing.trim()) {
      if (mergeMode === 'cancel') {
        warnings.push(`cancel:${h.target}.${h.eventKey}`)
        continue
      }
      if (!mergeMode && opts?.confirmOverwrite) mergeMode = 'overwrite'
      if (!mergeMode && opts?.previewForceOverwrite) mergeMode = 'overwrite'
      if (!mergeMode) {
        return {
          ok: false,
          error: `${h.target}.${h.eventKey} 已有代码，需 eventResolutions 或 confirmOverwrite`,
          httpStatus: 422,
        }
      }
    }
    const wr = writeHandler(next, h.target, h.eventKey, h.code, {
      confirmOverwrite: mergeMode === 'overwrite' || opts?.confirmOverwrite,
      mergeMode:
        mergeMode === 'prepend' || mergeMode === 'append' || mergeMode === 'overwrite'
          ? mergeMode
          : undefined,
    })
    if (wr.error) return { ok: false, error: wr.error, httpStatus: 422 }
    if (!wr.skipped) {
      handlerWrote = true
      handlerSkippedAll = false
    }
    warnings.push(...wr.warnings)
  }

  if (handlerSkippedAll && !structureWrote && !handlerWrote) {
    return { ok: false, error: '全部事件冲突已取消，无写入', httpStatus: 422 }
  }

  return { ok: true, formJson: next, warnings, outputResolved: resolved }
}

export function readExistingHandlerCode(formJson: FormJson, target: string, eventKey: string): string {
  if (target === 'form') {
    return String((formJson.formConfig || {})[eventKey] || '')
  }
  const targets = resolveHandlerTargets(formJson, target)
  for (const w of targets) {
    const c = String((w.options || {})[eventKey] || '')
    if (c.trim()) return c
  }
  return ''
}

export function collectEventConflicts(formJson: FormJson, output: InteractionOutput): EventConflict[] {
  const conflicts: EventConflict[] = []
  for (const h of output.handlers || []) {
    const existing = readExistingHandlerCode(formJson, h.target, h.eventKey)
    if (!existing.trim()) continue
    conflicts.push(
      buildEventConflict({
        target: h.target,
        eventKey: h.eventKey,
        existingCode: existing,
        incomingCode: h.code,
      }),
    )
  }
  return conflicts
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
