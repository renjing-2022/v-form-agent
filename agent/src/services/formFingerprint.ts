import { createHash } from 'node:crypto'

/** 纯客户端临时字段；rev2 初始为空，日后追加 */
export const VOLATILE_FORM_KEYS = new Set<string>([])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function stripVolatileKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileKeys)
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (VOLATILE_FORM_KEYS.has(key)) continue
    out[key] = stripVolatileKeys(value[key])
  }
  return out
}

/** 对象键排序的稳定 JSON，用于指纹 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function computeFormFingerprint(formJson: unknown): string {
  const normalized = stripVolatileKeys(formJson)
  return createHash('sha256').update(stableStringify(normalized)).digest('hex')
}
