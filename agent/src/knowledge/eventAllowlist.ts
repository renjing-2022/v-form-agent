/**
 * v0.8 纯前端事件 allowlist 与预览执行约束（DeliveryGuard 交付物 0）。
 * 真源：propertyRegister EVENT_PROPERTIES − 接口/上传通道。
 */
import { EVENT_KEYS_NEVER, listEventPropertyKeys } from './eventShapeRegistry.js'

export const FORM_PURE_FRONTEND_EVENT_KEYS = [
  'onFormCreated',
  'onFormMounted',
  'onFormDataChange',
  'onFormValidate',
] as const

/** 预览执行硬约束（非 designState；生命周期=装载 mounted） */
export const PREVIEW_EXECUTION_CONSTRAINTS = {
  runnerAllowed: ['designer-preview', 'playwright'] as const,
  forbidDesignState: true,
  lifecycleTrigger: 'preview-mount-and-wait-mounted',
  note: '验证必须走 VFormRender preview/render；designState 下 onChange 等不触发',
} as const

export function isInterfaceEventKey(key: string): boolean {
  return EVENT_KEYS_NEVER.has(key)
}

export function isPureFrontendEventKey(key: string, root?: string): boolean {
  if (isInterfaceEventKey(key)) return false
  if ((FORM_PURE_FRONTEND_EVENT_KEYS as readonly string[]).includes(key)) return true
  if (key === 'functions') return true
  if (!root) return /^on[A-Z]/.test(key)
  return listEventPropertyKeys(root).includes(key)
}

/** 列出仓库内全部纯前端可写事件键（含 form 级） */
export function listPureFrontendEventKeys(root: string): string[] {
  const widget = listEventPropertyKeys(root).filter((k) => !EVENT_KEYS_NEVER.has(k))
  return [...new Set([...widget, ...FORM_PURE_FRONTEND_EVENT_KEYS])].sort()
}

export function isAllowedEventWriteKey(key: string): boolean {
  if (key === 'functions') return true
  if (isInterfaceEventKey(key)) return false
  return /^on[A-Z]/.test(key)
}
