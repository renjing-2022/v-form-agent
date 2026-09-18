import type { RefinePlan, RefineOperation } from '../schemas/refinePlan.js'

const ALIGN_INTENT =
  /对齐|居中|靠右|靠左|右对齐|左对齐|labelAlign|label-right-align|label-left-align|label-center-align/i

const ALIGN_KEYS = new Set(['labelAlign'])

function isAlignPatch(op: RefineOperation): boolean {
  if (op.op === 'updateField') {
    return Object.keys(op.patch || {}).some((k) => ALIGN_KEYS.has(k))
  }
  if (op.op === 'patchFormConfig') {
    return Object.keys(op.patch || {}).some((k) => ALIGN_KEYS.has(k))
  }
  return false
}

export function instructionHasAlignIntent(instruction: string): boolean {
  return ALIGN_INTENT.test(instruction)
}

/**
 * 用户明确要求对齐，但合入后没有任何合法 labelAlign 落地时，应 422，避免半成功。
 */
export function alignIntentUnfulfilled(
  instruction: string,
  plan: RefinePlan,
  mergeWarnings: string[],
): { reject: boolean; message?: string } {
  if (!instructionHasAlignIntent(instruction)) return { reject: false }

  const alignOps = plan.operations.filter(isAlignPatch)
  if (alignOps.length === 0) {
    // 规划未产出对齐 op：仍允许走 CSS 等其他路径，不在此强制 422
    return { reject: false }
  }

  const strippedAlign = mergeWarnings.some(
    (w) =>
      /labelAlign/.test(w) &&
      (w.includes('类型或枚举不匹配') || w.includes('未知键') || w.includes('禁写键')),
  )

  // 若所有对齐 patch 都被剥掉，warnings 会留下枚举不匹配
  if (strippedAlign) {
    const stillHasAlignOpWithValue = alignOps.some((op) => {
      if (op.op === 'updateField' || op.op === 'patchFormConfig') {
        const v = op.patch.labelAlign
        return (
          v === 'label-left-align' ||
          v === 'label-center-align' ||
          v === 'label-right-align' ||
          v === ''
        )
      }
      return false
    })
    // 合入前 plan 可能已是非法值；sanitize 后 patch 变空。用 warnings 判断更可靠。
    if (!stillHasAlignOpWithValue || strippedAlign) {
      return {
        reject: true,
        message:
          '对齐诉求未落地：labelAlign 必须使用 label-left-align / label-center-align / label-right-align（字段级可用空字符串表示继承），禁止 right/left/center 等简称',
      }
    }
  }

  return { reject: false }
}

/** 检查合入后的 formJson 是否相对入参在 labelAlign 上发生了合法变化或已是目标值 */
export function formHasAnyLabelAlign(
  formJson: { widgetList?: unknown[]; formConfig?: Record<string, unknown> },
  expected?: string,
): boolean {
  const formAlign = formJson.formConfig?.labelAlign
  if (typeof formAlign === 'string' && (!expected || formAlign === expected)) {
    if (!expected) {
      /* form level presence ok */
    } else if (formAlign === expected) return true
  }
  const walk = (widgets: unknown[]): boolean => {
    for (const item of widgets) {
      const w = item as {
        options?: Record<string, unknown>
        widgetList?: unknown[]
        tabs?: unknown[]
        cols?: Array<{ widgetList?: unknown[] }>
      }
      if (!w || typeof w !== 'object') continue
      const align = w.options?.labelAlign
      if (typeof align === 'string') {
        if (!expected && (align === 'label-left-align' || align === 'label-center-align' || align === 'label-right-align')) {
          return true
        }
        if (expected && align === expected) return true
      }
      if (Array.isArray(w.widgetList) && walk(w.widgetList)) return true
      if (Array.isArray(w.tabs) && walk(w.tabs)) return true
      if (Array.isArray(w.cols)) {
        for (const col of w.cols) {
          if (Array.isArray(col?.widgetList) && walk(col.widgetList)) return true
        }
      }
    }
    return false
  }
  return walk(formJson.widgetList || [])
}
