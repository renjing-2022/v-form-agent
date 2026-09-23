import type { FormJson } from '../schemas/refinePlan.js'
import type { EventSpec } from '../schemas/eventSpec.js'
import { isInterfaceEventKey } from '../knowledge/eventAllowlist.js'
import { guardEventJs } from './eventJsGuard.js'

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: WidgetNode[]
}

export type EventPatch =
  | {
      kind: 'widget-event'
      widgetId: string
      eventKey: string
      code: string
    }
  | {
      kind: 'form-event'
      eventKey: string
      code: string
    }
  | {
      kind: 'functions'
      code: string
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

function findByHint(formJson: FormJson, hint: string): WidgetNode | undefined {
  const all = walkWidgets(formJson.widgetList as WidgetNode[])
  const h = String(hint || '').trim()
  if (!h) return undefined
  return (
    all.find((w) => w.id === h) ||
    all.find((w) => String(w.options?.name || '') === h) ||
    all.find((w) => String(w.options?.label || '') === h) ||
    all.find((w) => String(w.options?.label || '').includes(h))
  )
}

function resolveFieldName(formJson: FormJson, hint: string): string | undefined {
  const w = findByHint(formJson, hint)
  return w ? String(w.options?.name || w.id || '') || undefined : undefined
}

/** 纯 number 公式意图：应走 /refine + formula，不在此生成事件 */
export function shouldPreferFormula(instruction: string, eventSpec: EventSpec): boolean {
  if (eventSpec.trigger.eventKey !== 'onChange') return false
  if (/事件\s*JS|onChange\s*代码|写事件|交互代码/.test(instruction)) return false
  return /走公式|用公式|setFormula|formulaEnabled|纯公式|优先公式/.test(instruction)
}

function buildSetExpectCode(formJson: FormJson, expect: Record<string, unknown>): string {
  const lines: string[] = ['var form = this.getFormRef();']
  for (const [hint, val] of Object.entries(expect)) {
    if (['initialized', 'ready', 'updated', 'rowTouched', 'ok', 'valid'].includes(hint) && typeof val === 'boolean') {
      continue
    }
    const name = resolveFieldName(formJson, hint) || hint
    const lit = typeof val === 'string' ? JSON.stringify(val) : JSON.stringify(val)
    if (hint === 'hidden' || hint.endsWith('.hidden')) {
      const field = hint.replace(/\.?hidden$/, '') || name
      const fname = resolveFieldName(formJson, field) || field
      lines.push(val ? `form.hideWidgets(['${fname}']);` : `form.showWidgets(['${fname}']);`)
      continue
    }
    if (hint === 'disabled' || hint.endsWith('.disabled')) {
      const field = hint.replace(/\.?disabled$/, '') || name
      const fname = resolveFieldName(formJson, field) || field
      lines.push(val ? `form.disableWidgets(['${fname}']);` : `form.enableWidgets(['${fname}']);`)
      continue
    }
    lines.push(`form.setFieldValue('${name}', ${lit});`)
  }
  if (lines.length === 1) {
    // lifecycle / noop-visible: set a sentinel via first number if present
    const first = walkWidgets(formJson.widgetList as WidgetNode[]).find((w) => w.type === 'number' || w.type === 'input')
    if (first) {
      const n = String(first.options?.name || first.id)
      lines.push(`form.setFieldValue('${n}', form.getFieldValue('${n}'));`)
    }
  }
  return lines.join('\n')
}

function buildSumCode(formJson: FormJson, eventSpec: EventSpec): string | null {
  const expect = eventSpec.examples[0]?.expect || {}
  const given = eventSpec.examples[0]?.given || {}
  const targetHint =
    eventSpec.notes.find((n) => n.startsWith('targetHint='))?.slice('targetHint='.length) ||
    Object.keys(expect).find((k) => !['updated', 'ok'].includes(k))
  if (!targetHint) return null
  const target = resolveFieldName(formJson, targetHint)
  if (!target) return null
  const sources = Object.keys(given)
    .map((h) => resolveFieldName(formJson, h))
    .filter(Boolean) as string[]
  if (sources.length >= 2) {
    const sumExpr = sources.map((s) => `Number(form.getFieldValue('${s}') || 0)`).join(' + ')
    return `var form = this.getFormRef();\nform.setFieldValue('${target}', ${sumExpr});`
  }
  if (sources.length === 1) {
    return `var form = this.getFormRef();\nform.setFieldValue('${target}', Number(value));`
  }
  // fallback: copy value
  return `var form = this.getFormRef();\nform.setFieldValue('${target}', value);`
}

function buildHideShowCode(formJson: FormJson, eventSpec: EventSpec): string | null {
  const expect = eventSpec.examples[0]?.expect || {}
  const lines: string[] = ['var form = this.getFormRef();']
  let used = false
  for (const [hint, val] of Object.entries(expect)) {
    if (String(hint).includes('hidden') || val === 'hidden' || val === 'visible') {
      const fieldHint = String(hint).replace(/\.?hidden$/, '')
      const name = resolveFieldName(formJson, fieldHint) || fieldHint
      if (val === true || val === 'hidden') {
        lines.push(`form.hideWidgets(['${name}']);`)
      } else {
        lines.push(`form.showWidgets(['${name}']);`)
      }
      used = true
    }
    if (String(hint).includes('disabled') || val === 'disabled' || val === 'enabled') {
      const fieldHint = String(hint).replace(/\.?disabled$/, '')
      const name = resolveFieldName(formJson, fieldHint) || fieldHint
      if (val === true || val === 'disabled') {
        lines.push(`form.disableWidgets(['${name}']);`)
      } else {
        lines.push(`form.enableWidgets(['${name}']);`)
      }
      used = true
    }
  }
  return used ? lines.join('\n') : null
}

const VALUE_TRIGGER_KEYS = new Set(['onChange', 'onInput', 'onBlur', 'onFocus'])

function hasStateExpect(expect: Record<string, unknown>): boolean {
  return Object.keys(expect).some((k) => /(^|\.)(hidden|disabled)$/.test(k))
}

const VALIDATE_RULES: Array<{ pattern: RegExp; fail: (v: string, n: string) => string }> = [
  { pattern: /(?:不能|不得|不可)(?:小于|低于)/, fail: (v, n) => `${v} < ${n}` },
  { pattern: /(?:不能|不得|不可)(?:大于|高于|超过)/, fail: (v, n) => `${v} > ${n}` },
  { pattern: /必须(?:大于等于|不小于)/, fail: (v, n) => `${v} < ${n}` },
  { pattern: /必须(?:小于等于|不大于)/, fail: (v, n) => `${v} > ${n}` },
  { pattern: /必须大于/, fail: (v, n) => `${v} <= ${n}` },
  { pattern: /必须小于/, fail: (v, n) => `${v} >= ${n}` },
]

/** 仅支持「字段 + 比较 + 数值」的单条规则；无法确定时返回 null（上层 422） */
function buildValidateCode(formJson: FormJson, instruction: string): string | null {
  const m = instruction.match(
    /([^\s，,。；;：:]+?)\s*((?:不能|不得|不可|必须)(?:大于等于|小于等于|不小于|不大于|小于|低于|大于|高于|超过))\s*(-?\d+(?:\.\d+)?)/,
  )
  if (!m) return null
  const hint = m[1].replace(/^(?:提交前|提交时|校验|检查)+/, '')
  const name = resolveFieldName(formJson, hint)
  if (!name) return null
  const rule = VALIDATE_RULES.find((r) => r.pattern.test(m[2]))
  if (!rule) return null
  return [
    `var v = Number(formModel['${name}']);`,
    `if (isNaN(v) || ${rule.fail('v', m[3])}) { return false; }`,
    'return true;',
  ].join('\n')
}

/**
 * EventSpec → 受约束 JS（mock 确定性；acceptance 不依赖 LLM）。
 */
export function generateEventCode(params: {
  instruction: string
  eventSpec: EventSpec
  formJson: FormJson
}): { code: string; patches: EventPatch[]; message?: string } | { error: string; httpStatus: 422 } {
  const { eventSpec, formJson, instruction } = params
  const eventKey = eventSpec.sink.eventKey || eventSpec.trigger.eventKey

  if (isInterfaceEventKey(eventKey)) {
    return { error: `接口类事件禁止生成：${eventKey}`, httpStatus: 422 }
  }
  if (shouldPreferFormula(instruction, eventSpec)) {
    return {
      error: '该计算可用 formula 表达，请走 /refine + setFormula，不要用事件重复造公式',
      httpStatus: 422,
    }
  }
  if (/fetch\s*\(|XMLHttpRequest|eval\s*\(|new\s+Function|document\.|setTimeout|setInterval/.test(instruction)) {
    return { error: '指令含危险构造，拒绝生成', httpStatus: 422 }
  }

  const firstExpect = eventSpec.examples[0]?.expect || {}
  let code = ''
  if (eventKey === 'onFormValidate') {
    const validate = buildValidateCode(formJson, instruction)
    if (!validate) {
      return {
        error: '无法从描述中确定校验规则，请说明如「总分不能小于0」',
        httpStatus: 422,
      }
    }
    code = validate
  } else if (VALUE_TRIGGER_KEYS.has(eventKey)) {
    code = hasStateExpect(firstExpect)
      ? buildHideShowCode(formJson, eventSpec) || ''
      : buildSumCode(formJson, eventSpec) || ''
  } else {
    code = buildSetExpectCode(formJson, firstExpect)
  }
  if (!code) {
    code = buildSetExpectCode(formJson, firstExpect)
  }

  // inject unknown field for negative tests via instruction marker
  if (/\[guard:unknown-field\]/.test(instruction)) {
    code = `this.getFormRef().setFieldValue('__no_such_field__', 1);`
  }
  if (/\[guard:network\]/.test(instruction)) {
    code = `fetch('https://example.com');`
  }
  if (/\[guard:eval\]/.test(instruction)) {
    code = `eval('1+1');`
  }
  if (/\[guard:dom\]/.test(instruction)) {
    code = `document.body.innerHTML = '';`
  }
  if (/\[guard:timer\]/.test(instruction)) {
    code = `setTimeout(function(){}, 0);`
  }

  const guarded = guardEventJs({ code, eventKey, formJson })
  if (!guarded.ok) {
    return { error: `eventJsGuard: ${guarded.message}`, httpStatus: 422 }
  }

  const patches: EventPatch[] = []
  if (eventSpec.sink.kind === 'form-event') {
    patches.push({ kind: 'form-event', eventKey, code })
  } else if (eventSpec.sink.kind === 'functions') {
    patches.push({ kind: 'functions', code })
  } else {
    const widgetId =
      eventSpec.trigger.widgetRef?.id ||
      findByHint(formJson, eventSpec.trigger.widgetRef?.name || eventSpec.trigger.widgetRef?.label || '')?.id
    if (!widgetId) {
      return { error: '缺少目标控件，无法生成 widget 事件', httpStatus: 422 }
    }
    patches.push({ kind: 'widget-event', widgetId, eventKey, code })
  }

  return { code, patches }
}
