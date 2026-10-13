/**
 * 事务完整性：指纹再验 + 故障注入（测试用）。
 * 合入失败必须保持原画布不变。
 */
import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import type { EventResolution } from '../schemas/clarification.js'
import { applyInteractionOutput } from './interactionMerger.js'
import {
  computeTransactionFingerprint,
  verifyTransactionFingerprint,
} from './previewProvenance.js'

export type FaultKind =
  | 'none'
  | 'throw-before-merge'
  | 'throw-after-merge'
  | 'fingerprint-drift'
  | 'corrupt-output-handler'

export type TransactionRunResult =
  | {
      ok: true
      formJson: FormJson
      warnings: string[]
      transactionFingerprint: string
      originalUnchanged: true
    }
  | {
      ok: false
      error: string
      formJson: FormJson
      originalUnchanged: boolean
      fault?: FaultKind
    }

function cloneForm(form: FormJson): FormJson {
  return JSON.parse(JSON.stringify(form)) as FormJson
}

function formsEqual(a: FormJson, b: FormJson): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 带故障注入的合入试验：验证失败路径不污染调用方持有的原 form。
 */
export function runTransactionalMerge(params: {
  currentFormJson: FormJson
  output: InteractionOutput
  eventResolutions?: EventResolution[]
  confirmOverwrite?: boolean
  expectedTransactionFingerprint?: string
  fault?: FaultKind
}): TransactionRunResult {
  const original = params.currentFormJson
  const snapshot = cloneForm(original)
  const fault = params.fault || 'none'

  try {
    if (fault === 'throw-before-merge') {
      throw new Error('fault-inject:throw-before-merge')
    }

    let output = params.output
    if (fault === 'corrupt-output-handler') {
      output = {
        ...params.output,
        handlers: [
          ...(params.output.handlers || []),
          {
            id: 'fault',
            target: '__missing_target__',
            eventKey: 'onClick',
            code: '1',
            explain: 'fault',
          },
        ],
      }
    }

    const fpCheck = verifyTransactionFingerprint(
      fault === 'fingerprint-drift' ? 'deadbeef'.repeat(8) : params.expectedTransactionFingerprint,
      original,
      output,
    )
    if (!fpCheck.ok) {
      return {
        ok: false,
        error: fpCheck.error,
        formJson: original,
        originalUnchanged: formsEqual(original, snapshot),
        fault,
      }
    }

    const merged = applyInteractionOutput(original, output, {
      eventResolutions: params.eventResolutions,
      confirmOverwrite: params.confirmOverwrite,
    })

    if (fault === 'throw-after-merge') {
      // 模拟合入后写回前崩溃：丢弃 merged，调用方仍持有原引用
      throw new Error('fault-inject:throw-after-merge')
    }

    if (!merged.ok) {
      return {
        ok: false,
        error: merged.error,
        formJson: original,
        originalUnchanged: formsEqual(original, snapshot),
        fault,
      }
    }

    const txnFp = computeTransactionFingerprint({ formJson: original, output })
    return {
      ok: true,
      formJson: merged.formJson,
      warnings: merged.warnings,
      transactionFingerprint: txnFp,
      originalUnchanged: formsEqual(original, snapshot),
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      formJson: original,
      originalUnchanged: formsEqual(original, snapshot),
      fault,
    }
  }
}

/** 覆盖回滚：用 previousCode 写回候选表单事件键（不触碰未传入的键） */
export function rollbackOverwriteOnCandidate(params: {
  formJson: FormJson
  rollbacks: Array<{ target: string; eventKey: string; previousCode: string }>
}): FormJson {
  const next = cloneForm(params.formJson)
  for (const r of params.rollbacks) {
    if (r.target === 'form') {
      next.formConfig = { ...(next.formConfig || {}), [r.eventKey]: r.previousCode }
      continue
    }
    const walk = (list: any[] | undefined) => {
      if (!list) return
      for (const w of list) {
        if (!w || typeof w !== 'object') continue
        if (String(w.options?.name || '') === r.target || w.id === r.target) {
          w.options = { ...(w.options || {}), [r.eventKey]: r.previousCode }
        }
        walk(w.widgetList)
        walk(w.tabs)
        walk(w.cols)
        if (Array.isArray(w.rows)) {
          for (const row of w.rows) {
            walk(row.cols)
            walk(row.widgetList)
            walk(row.cells)
          }
        }
      }
    }
    walk(next.widgetList as any[])
  }
  return next
}
