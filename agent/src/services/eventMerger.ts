import type { FormJson } from '../schemas/refinePlan.js'
import type { EventPatch } from './eventCodegen.js'
import { isAllowedEventWriteKey, isInterfaceEventKey } from '../knowledge/eventAllowlist.js'
import { guardEventJs } from './eventJsGuard.js'

type WidgetNode = {
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: WidgetNode[]
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

function cloneForm(formJson: FormJson): FormJson {
  return JSON.parse(JSON.stringify(formJson)) as FormJson
}

export function readExistingEventCode(formJson: FormJson, patch: EventPatch): string {
  if (patch.kind === 'form-event') {
    return String((formJson.formConfig || {})[patch.eventKey] || '')
  }
  if (patch.kind === 'functions') {
    return String((formJson.formConfig || {}).functions || '')
  }
  const w = walkWidgets(formJson.widgetList as WidgetNode[]).find((n) => n.id === patch.widgetId)
  return String((w?.options || {})[patch.eventKey] || '')
}

export function applyEventPatches(
  formJson: FormJson,
  patches: EventPatch[],
  opts?: { confirmOverwrite?: boolean },
): { formJson: FormJson; warnings: string[] } | { error: string; httpStatus: 422 } {
  const next = cloneForm(formJson)
  const warnings: string[] = []

  for (const patch of patches) {
    const key = patch.kind === 'functions' ? 'functions' : patch.eventKey
    if (!isAllowedEventWriteKey(key) || isInterfaceEventKey(key)) {
      return { error: `禁写事件键：${key}`, httpStatus: 422 }
    }
    const existing = readExistingEventCode(next, patch)
    if (existing.trim() && !opts?.confirmOverwrite) {
      return {
        error: '目标事件键已有手写代码，需 confirmOverwrite=true 才覆盖（无智能合并）',
        httpStatus: 422,
      }
    }
    if (existing.trim() && opts?.confirmOverwrite) {
      warnings.push(`overwrite-confirmed:${key}`)
    }

    const eventKeyForGuard = patch.kind === 'functions' ? 'onChange' : patch.eventKey
    const guarded = guardEventJs({ code: patch.code, eventKey: eventKeyForGuard, formJson: next })
    if (!guarded.ok) {
      return { error: `eventJsGuard: ${guarded.message}`, httpStatus: 422 }
    }

    if (patch.kind === 'form-event') {
      next.formConfig = { ...(next.formConfig || {}), [patch.eventKey]: patch.code }
    } else if (patch.kind === 'functions') {
      next.formConfig = { ...(next.formConfig || {}), functions: patch.code }
    } else {
      const w = walkWidgets(next.widgetList as WidgetNode[]).find((n) => n.id === patch.widgetId)
      if (!w) return { error: `widget not found: ${patch.widgetId}`, httpStatus: 422 }
      w.options = { ...(w.options || {}), [patch.eventKey]: patch.code }
    }
  }

  return { formJson: next, warnings }
}
