import type { TargetRef } from '../schemas/refinePlan.js'

/** parentScope 解析结果（tab-pane/label、type#name、path:…） */
export type ParsedParentScope = {
  containerType?: string
  id?: string
  name?: string
  label?: string
  pathPrefix?: string
}

/**
 * 解析 parentScope 路径语法：
 * - `tab-pane/基本信息` → containerType + label
 * - `tab-pane#paneA` → containerType + name
 * - `path:widgetList[0].tabs[0]` → 精确 path 前缀
 * - 纯字符串 → 视为 label（兼容旧 parent TargetRef）
 */
export function parseParentScope(input: string): ParsedParentScope {
  const trimmed = input.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('path:')) {
    return { pathPrefix: trimmed.slice(5).trim() }
  }
  const slash = trimmed.match(/^([^/#]+)\/(.+)$/)
  if (slash) {
    return { containerType: slash[1].trim(), label: slash[2].trim() }
  }
  const hash = trimmed.match(/^([^/#]+)#(.+)$/)
  if (hash) {
    return { containerType: hash[1].trim(), name: hash[2].trim() }
  }
  return { label: trimmed }
}

export function looksLikeParentScope(input: string): boolean {
  const s = input.trim()
  return s.startsWith('path:') || s.includes('/') || s.includes('#')
}

/** 将 parentScope 语法展开为 TargetRef 字段（保留已有 id/name/label） */
export function expandParentScope(parsed: ParsedParentScope, base: TargetRef = {}): TargetRef {
  return {
    ...base,
    ...(parsed.id ? { id: parsed.id } : {}),
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.label ? { label: parsed.label } : {}),
    ...(parsed.containerType ? { containerType: parsed.containerType } : {}),
    ...(parsed.pathPrefix ? { pathPrefix: parsed.pathPrefix } : {}),
  }
}

/** 归一化 target：字符串 parentScope / parentScope 字段 / 纯 id 字符串 */
export function normalizeTargetRef(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return raw
    if (looksLikeParentScope(s)) {
      return expandParentScope(parseParentScope(s))
    }
    return { id: s, name: s }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.parentScope === 'string' && obj.parentScope.trim()) {
      const expanded = expandParentScope(parseParentScope(obj.parentScope), obj as TargetRef)
      const { parentScope: _drop, ...rest } = expanded as TargetRef & { parentScope?: string }
      return rest
    }
  }
  return raw
}
