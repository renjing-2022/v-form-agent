/**
 * v0.9 交互场景真实预览执行器。
 * 验证期拦截网络 API；副作用桩；报告只含观测值。
 */
import { valuesMatch } from './eventPreviewRunner'

export type InteractionScenario = {
  id: string
  handlerRefs: string[]
  title: string
  arrange?: { values?: Record<string, unknown>; activeTab?: string | number }
  act?: Array<Record<string, unknown>>
  assert: Array<Record<string, unknown>>
}

export type InteractionScenarioResult = {
  scenarioId: string
  ok: boolean
  actual?: Record<string, unknown>
  error?: string
  unverifiable?: boolean
}

export type InteractionVerificationReport = {
  runner: 'designer-preview' | 'playwright'
  results: InteractionScenarioResult[]
  pass: boolean
  networkHits?: string[]
  errors?: string[]
}

type VFormLike = {
  getFieldValue?: (name: string) => unknown
  setFieldValue?: (name: string, value: unknown, disableChangeEvent?: boolean) => void
  getWidgetRef?: (name: string) => any
  validateForm?: (callback: (valid: boolean) => void) => void
  showDialog?: (name: string) => unknown
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function installNetworkTraps(): { hits: string[]; restore: () => void } {
  const hits: string[] = []
  const w = window as any
  const originals = {
    fetch: w.fetch,
    XHROpen: XMLHttpRequest.prototype.open,
    WebSocket: w.WebSocket,
    EventSource: w.EventSource,
    sendBeacon: navigator.sendBeacon?.bind(navigator),
  }

  w.fetch = function trappedFetch(...args: unknown[]) {
    hits.push(`fetch:${String(args[0])}`)
    return Promise.reject(new Error('network blocked in interaction verification'))
  }
  XMLHttpRequest.prototype.open = function trappedOpen(this: XMLHttpRequest, ...args: any[]) {
    hits.push(`xhr:${String(args[1] || '')}`)
    throw new Error('network blocked in interaction verification')
  } as any
  w.WebSocket = function trappedWs() {
    hits.push('WebSocket')
    throw new Error('network blocked')
  }
  w.EventSource = function trappedEs() {
    hits.push('EventSource')
    throw new Error('network blocked')
  }
  if (navigator.sendBeacon) {
    ;(navigator as any).sendBeacon = function trappedBeacon() {
      hits.push('sendBeacon')
      return false
    }
  }

  return {
    hits,
    restore() {
      w.fetch = originals.fetch
      XMLHttpRequest.prototype.open = originals.XHROpen
      w.WebSocket = originals.WebSocket
      w.EventSource = originals.EventSource
      if (originals.sendBeacon) (navigator as any).sendBeacon = originals.sendBeacon
    },
  }
}

function installSideEffectStubs(): { restore: () => void; clearTimers: () => void } {
  const w = window as any
  const timers: number[] = []
  const originalOpen = w.open
  const originalSetTimeout = w.setTimeout
  const originalSetInterval = w.setInterval
  w.open = function stubOpen() {
    return null
  }
  w.setTimeout = function (fn: TimerHandler, ms?: number, ...rest: any[]) {
    const id = originalSetTimeout(fn, ms, ...rest)
    timers.push(id as number)
    return id
  } as any
  w.setInterval = function (fn: TimerHandler, ms?: number, ...rest: any[]) {
    const id = originalSetInterval(fn, ms, ...rest)
    timers.push(id as number)
    return id
  } as any
  return {
    clearTimers() {
      timers.forEach((id) => {
        clearTimeout(id)
        clearInterval(id)
      })
      timers.length = 0
    },
    restore() {
      w.open = originalOpen
      w.setTimeout = originalSetTimeout
      w.setInterval = originalSetInterval
    },
  }
}

function codeLooksLikeLocationAssign(handlers: Array<{ code?: string }>): boolean {
  return handlers.some((h) => /location\s*(\.|\[)|location\s*=/.test(String(h.code || '')))
}

async function settle(extraMs = 0) {
  await Promise.resolve()
  await sleep(Math.min(extraMs || 120, 5000))
}

function readActual(formRef: VFormLike, asserts: Array<Record<string, unknown>>, valid?: boolean) {
  const actual: Record<string, unknown> = { noError: true, noNetwork: true }
  const missing: string[] = []
  for (const a of asserts) {
    if ('noNetwork' in a || 'noError' in a) continue
    if ('field' in a && 'value' in a) {
      const name = String(a.field)
      if (!formRef.getWidgetRef?.(name)) missing.push(name)
      else actual[`field:${name}`] = formRef.getFieldValue?.(name)
    } else if ('field' in a && 'hidden' in a) {
      const ref = formRef.getWidgetRef?.(String(a.field))
      const v = ref?.field?.options?.hidden ?? ref?.options?.hidden
      if (typeof v !== 'boolean') missing.push(`hidden:${a.field}`)
      else actual[`hidden:${a.field}`] = v
    } else if ('field' in a && 'disabled' in a) {
      const ref = formRef.getWidgetRef?.(String(a.field))
      const v = ref?.field?.options?.disabled ?? ref?.options?.disabled
      if (typeof v !== 'boolean') missing.push(`disabled:${a.field}`)
      else actual[`disabled:${a.field}`] = v
    } else if ('field' in a && 'required' in a) {
      const ref = formRef.getWidgetRef?.(String(a.field))
      const v = ref?.field?.options?.required ?? ref?.options?.required
      if (typeof v !== 'boolean') missing.push(`required:${a.field}`)
      else actual[`required:${a.field}`] = v
    } else if ('field' in a && 'label' in a) {
      const ref = formRef.getWidgetRef?.(String(a.field))
      const v = ref?.field?.options?.label ?? ref?.options?.label
      if (v === undefined) missing.push(`label:${a.field}`)
      else actual[`label:${a.field}`] = v
    } else if ('activeTab' in a) {
      // try common tab widget names
      const tab =
        formRef.getWidgetRef?.('wizardTab') ||
        formRef.getWidgetRef?.('tab') ||
        null
      if (tab && typeof tab.getActiveTabIndex === 'function') {
        actual.activeTab = tab.getActiveTabIndex()
      } else missing.push('activeTab')
    } else if ('focused' in a) {
      const el = document.activeElement as HTMLElement | null
      // best-effort: data-name or closest field
      const name =
        el?.getAttribute?.('name') ||
        el?.closest?.('[name]')?.getAttribute('name') ||
        null
      actual.focused = name
      if (!name) missing.push('focused')
    } else if ('valid' in a) {
      if (valid === undefined) missing.push('valid')
      else actual.valid = valid
    } else if ('dialogVisible' in a) {
      const name = String(a.dialogVisible)
      // showDialog 创建的是动态 el-dialog，不在 widgetRef 上；用 DOM 观测
      const open =
        !!document.querySelector(`[id^="vf-dynamic-dialog-wrapper"]`) ||
        !!document.querySelector('.el-overlay.is-message-box, .el-overlay .el-dialog')
      actual[`dialog:${name}`] = open
    } else if ('subFormRows' in a) {
      const sf = formRef.getWidgetRef?.(String(a.subFormRows))
      const rows = sf?.getRowIdData?.()
      if (!Array.isArray(rows)) missing.push(`subFormRows:${a.subFormRows}`)
      else actual[`subFormRows:${a.subFormRows}`] = rows.length
    }
  }
  return { actual, missing }
}

export async function runInteractionScenariosOnPreview(params: {
  formRef: VFormLike
  formJson: { widgetList?: any[]; formConfig?: Record<string, any> }
  scenarios: InteractionScenario[]
  handlers?: Array<{ code?: string }>
  runner?: InteractionVerificationReport['runner']
}): Promise<InteractionVerificationReport> {
  const runner = params.runner || 'designer-preview'
  const results: InteractionScenarioResult[] = []
  const allErrors: string[] = []

  if (params.handlers && codeLooksLikeLocationAssign(params.handlers)) {
    return {
      runner,
      pass: false,
      results: params.scenarios.map((s) => ({
        scenarioId: s.id,
        ok: false,
        unverifiable: true,
        error: 'location 赋值无法在验证期安全拦截，判不可验证',
      })),
      errors: ['unverifiable:location'],
    }
  }

  const net = installNetworkTraps()
  const side = installSideEffectStubs()

  try {
    for (const sc of params.scenarios) {
      try {
        // arrange
        const values = sc.arrange?.values || {}
        for (const [name, val] of Object.entries(values)) {
          params.formRef.setFieldValue?.(name, val, true)
        }
        if (sc.arrange?.activeTab !== undefined) {
          const tab = params.formRef.getWidgetRef?.('wizardTab')
          if (tab?.activeTab) {
            const idx =
              typeof sc.arrange.activeTab === 'number'
                ? sc.arrange.activeTab
                : tab.widget?.tabs?.findIndex((t: any) => t.options?.name === sc.arrange?.activeTab)
            if (typeof idx === 'number' && idx >= 0) tab.activeTab(idx)
          }
        }

        let valid: boolean | undefined
        for (const step of sc.act || []) {
          if ('input' in step) {
            params.formRef.setFieldValue?.(String(step.input), step.value, false)
          } else if ('click' in step) {
            const btn = params.formRef.getWidgetRef?.(String(step.click))
            if (!btn?.handleButtonWidgetClick) throw new Error(`按钮不可点: ${step.click}`)
            btn.handleButtonWidgetClick()
          } else if ('switchTab' in step) {
            const tab = params.formRef.getWidgetRef?.('wizardTab')
            if (!tab?.activeTab) throw new Error('无 tab')
            if (typeof step.switchTab === 'number') tab.activeTab(step.switchTab)
            else {
              const idx = tab.widget?.tabs?.findIndex((t: any) => t.options?.name === step.switchTab)
              tab.activeTab(idx)
            }
          } else if ('submit' in step) {
            valid = await new Promise<boolean>((resolve, reject) => {
              if (!params.formRef.validateForm) return reject(new Error('无 validateForm'))
              params.formRef.validateForm((v) => resolve(!!v))
            })
          } else if ('addSubFormRow' in step) {
            const sf = params.formRef.getWidgetRef?.(String(step.addSubFormRow))
            if (!sf?.addSubFormRow) throw new Error(`无子表 ${step.addSubFormRow}`)
            sf.addSubFormRow()
          } else if ('wait' in step) {
            await settle(Number(step.wait) || 0)
          } else if ('mount' in step) {
            await settle(50)
          }
          await settle(80)
        }

        if (net.hits.length) {
          results.push({
            scenarioId: sc.id,
            ok: false,
            actual: { noNetwork: false, noError: true },
            error: `network hits: ${net.hits.join(',')}`,
          })
          continue
        }

        const { actual, missing } = readActual(params.formRef, sc.assert, valid)
        const failed: string[] = []
        for (const a of sc.assert) {
          if ('noNetwork' in a) continue
          if ('noError' in a) continue
          if ('field' in a && 'value' in a) {
            if (!valuesMatch(actual[`field:${a.field}`], a.value)) failed.push(String(a.field))
          } else if ('activeTab' in a) {
            if (!valuesMatch(actual.activeTab, a.activeTab)) failed.push('activeTab')
          } else if ('valid' in a) {
            if (!valuesMatch(actual.valid, a.valid)) failed.push('valid')
          } else if ('field' in a && 'hidden' in a) {
            if (!valuesMatch(actual[`hidden:${a.field}`], a.hidden)) failed.push(`hidden:${a.field}`)
          } else if ('field' in a && 'disabled' in a) {
            if (!valuesMatch(actual[`disabled:${a.field}`], a.disabled)) failed.push(`disabled:${a.field}`)
          } else if ('field' in a && 'required' in a) {
            if (!valuesMatch(actual[`required:${a.field}`], a.required)) failed.push(`required:${a.field}`)
          }
        }

        results.push({
          scenarioId: sc.id,
          ok: failed.length === 0 && missing.length === 0,
          actual,
          ...(missing.length
            ? { error: `无法观察：${missing.join(',')}` }
            : failed.length
              ? { error: `断言失败：${failed.join(',')}` }
              : {}),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        allErrors.push(msg)
        results.push({ scenarioId: sc.id, ok: false, actual: { noError: false }, error: msg })
      } finally {
        side.clearTimers()
      }
    }
  } finally {
    net.restore()
    side.restore()
  }

  return {
    runner,
    results,
    pass: results.length === params.scenarios.length && results.every((r) => r.ok),
    networkHits: net.hits.length ? [...net.hits] : undefined,
    errors: allErrors.length ? allErrors : undefined,
  }
}
