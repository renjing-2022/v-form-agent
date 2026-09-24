/**
 * 在真实 VFormRender（previewState）上按 EventSpec.examples 执行断言，组装 executionReport。
 * 禁止在 designState 下验证；只报告真实读到的状态，读不到即判失败。
 */
import { readWidgetDisplayValue } from './interactionObserve'

export type EventExample = {
  given: Record<string, unknown>
  expect: Record<string, unknown>
  note?: string
}

export type ExecutionReport = {
  runner: 'designer-preview' | 'playwright'
  results: Array<{
    exampleIndex: number
    ok: boolean
    actual?: Record<string, unknown>
    error?: string
  }>
  pass: boolean
}

type WidgetRefLike = {
  field?: { options?: Record<string, unknown> }
  handleButtonWidgetClick?: () => void
  addSubFormRow?: () => void
}

type VFormLike = {
  getFieldValue?: (name: string) => unknown
  setFieldValue?: (name: string, value: unknown, disableChangeEvent?: boolean) => void
  getWidgetRef?: (name: string) => WidgetRefLike | null
  validateForm?: (callback: (valid: boolean) => void) => void
}

const VALUE_TRIGGER_KEYS = new Set(['onChange', 'onInput', 'onBlur', 'onFocus'])
const LIFECYCLE_KEY = /^on(Form)?(Created|Mounted)$/

function resolveName(formJson: { widgetList?: any[] }, hint: string): string {
  const h = String(hint || '').trim()
  const walk = (nodes: any[] | undefined): any | undefined => {
    if (!nodes) return undefined
    for (const n of nodes) {
      if (n?.id === h || n?.options?.name === h || n?.options?.label === h) return n
      const hit =
        walk(n.widgetList) ||
        walk(n.tabs) ||
        walk(n.cols) ||
        (Array.isArray(n.rows)
          ? n.rows.map((r: any) => walk(r.cols || r.widgetList)).find(Boolean)
          : undefined)
      if (hit) return hit
    }
    return undefined
  }
  const w = walk(formJson.widgetList)
  return String(w?.options?.name || w?.id || h)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === undefined || actual === null) return expected === actual
  if (typeof expected === 'boolean') return actual === expected || String(actual) === String(expected)
  if (typeof expected === 'number') {
    return actual !== '' && !Number.isNaN(Number(actual)) && Number(actual) === expected
  }
  return JSON.stringify(actual) === JSON.stringify(expected) || String(actual) === String(expected)
}

function runValidate(formRef: VFormLike): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!formRef.validateForm) {
      reject(new Error('VFormRender 不支持 validateForm'))
      return
    }
    formRef.validateForm((valid) => resolve(!!valid))
  })
}

/**
 * @param formRef VFormRender 组件实例（须 preview-state / 非 designState）
 * @param triggerName 触发控件 name（widget 事件必填）
 */
export async function runEventExamplesOnPreview(params: {
  formRef: VFormLike
  formJson: { widgetList?: any[]; formConfig?: Record<string, any> }
  examples: EventExample[]
  eventKey: string
  triggerName?: string
  runner?: ExecutionReport['runner']
}): Promise<ExecutionReport> {
  const { formRef, formJson, examples, eventKey } = params
  const runner = params.runner || 'designer-preview'
  const triggerName = params.triggerName ? resolveName(formJson, params.triggerName) : ''
  const results: ExecutionReport['results'] = []

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i]
    try {
      const given = Object.entries(ex.given || {})
        .filter(([hint]) => hint !== 'action')
        .map(([hint, val]) => [resolveName(formJson, hint), val] as const)

      if (VALUE_TRIGGER_KEYS.has(eventKey)) {
        const trigger = given.find(([name]) => name === triggerName)
        if (!trigger) throw new Error(`示例未给出触发字段 ${triggerName || '(未知)'} 的取值，无法触发 ${eventKey}`)
        for (const [name, val] of given) {
          if (name !== triggerName) formRef.setFieldValue?.(name, val, true)
        }
        formRef.setFieldValue?.(trigger[0], trigger[1], false)
      } else {
        for (const [name, val] of given) formRef.setFieldValue?.(name, val, true)
      }

      let validResult: boolean | undefined
      if (eventKey === 'onClick') {
        const btn = formRef.getWidgetRef?.(triggerName)
        if (!btn?.handleButtonWidgetClick) throw new Error(`未找到可点击的按钮 ${triggerName}`)
        btn.handleButtonWidgetClick()
      } else if (eventKey === 'onSubFormRowAdd') {
        const sub = formRef.getWidgetRef?.(triggerName)
        if (!sub?.addSubFormRow) throw new Error(`未找到子表 ${triggerName}`)
        sub.addSubFormRow()
      } else if (eventKey === 'onFormValidate') {
        validResult = await runValidate(formRef)
      } else if (!VALUE_TRIGGER_KEYS.has(eventKey) && !LIFECYCLE_KEY.test(eventKey)) {
        throw new Error(`预览验证暂不支持触发 ${eventKey}`)
      }

      await sleep(150)

      const actual: Record<string, unknown> = {}
      const unobservable: string[] = []
      for (const hint of Object.keys(ex.expect || {})) {
        const state = hint.match(/^(.+)\.(hidden|disabled)$/)
        if (state) {
          const ref = formRef.getWidgetRef?.(resolveName(formJson, state[1]))
          const v = ref?.field?.options?.[state[2]]
          if (typeof v === 'boolean') actual[hint] = v
          else unobservable.push(hint)
        } else if (hint === 'valid') {
          if (validResult === undefined) unobservable.push(hint)
          else actual[hint] = validResult
        } else {
          const name = resolveName(formJson, hint)
          const ref = formRef.getWidgetRef?.(name)
          if (!ref) unobservable.push(hint)
          else actual[hint] = readWidgetDisplayValue(ref as any) ?? formRef.getFieldValue?.(name)
        }
      }

      const mismatched = Object.entries(ex.expect || {}).filter(
        ([k, v]) => !(k in actual) || !valuesMatch(actual[k], v),
      )
      results.push({
        exampleIndex: i,
        ok: mismatched.length === 0 && unobservable.length === 0,
        actual,
        ...(unobservable.length
          ? { error: `预览中无法观察：${unobservable.join(', ')}` }
          : mismatched.length
            ? { error: `不一致：${mismatched.map(([k]) => k).join(', ')}` }
            : {}),
      })
    } catch (err) {
      results.push({
        exampleIndex: i,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    runner,
    results,
    pass: results.length === examples.length && results.every((r) => r.ok),
  }
}
