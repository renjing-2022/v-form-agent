/**
 * 交互预览观测：按控件真实存储读取「可断言」展示值。
 * static-text / html-text 的 formItemFlag=false，setValue/getValue 无效，须读 textContent/htmlContent。
 */
export type WidgetRefLike = {
  field?: {
    type?: string
    formItemFlag?: boolean
    options?: Record<string, unknown>
  }
  options?: Record<string, unknown>
  getValue?: () => unknown
}

export function isNonFormItemDisplayWidget(widgetRef: WidgetRefLike | null | undefined): boolean {
  if (!widgetRef) return false
  const field = widgetRef.field
  const type = field?.type
  if (type === 'static-text' || type === 'html-text') return true
  if (field && field.formItemFlag === false) return true
  return false
}

/** 读断言用值：表单项走 getValue；展示控件走 textContent/htmlContent */
export function readWidgetDisplayValue(widgetRef: WidgetRefLike | null | undefined): unknown {
  if (!widgetRef) return undefined
  const field = widgetRef.field
  const type = field?.type
  const opts = field?.options || widgetRef.options || {}

  if (type === 'html-text' || (field?.formItemFlag === false && 'htmlContent' in opts)) {
    return opts.htmlContent
  }
  if (type === 'static-text' || field?.formItemFlag === false) {
    return opts.textContent
  }
  if (typeof widgetRef.getValue === 'function') {
    return widgetRef.getValue()
  }
  return undefined
}
