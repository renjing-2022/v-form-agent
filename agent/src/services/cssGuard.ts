export const CSS_MAX_LENGTH = 8000

const DANGEROUS_CSS =
  /@import\b|expression\s*\(|javascript\s*:|-moz-binding\b|\bbehavior\s*:/i

const BROAD_SELECTOR = /(^|}|,)\s*(\*|html|body)(\s*[,{])/i

export type CssGuardResult = {
  ok: boolean
  warnings: string[]
  message?: string
}

export function validateCssCode(css: string): CssGuardResult {
  const warnings: string[] = []
  if (css.length > CSS_MAX_LENGTH) {
    return {
      ok: false,
      warnings,
      message: `cssCode 超过 ${CSS_MAX_LENGTH} 字符上限`,
    }
  }
  if (DANGEROUS_CSS.test(css)) {
    return {
      ok: false,
      warnings,
      message: 'cssCode 包含危险构造（如 @import、expression、javascript:）',
    }
  }
  if (BROAD_SELECTOR.test(css)) {
    warnings.push('cssCode 含过宽全局选择器（html/body/*），可能影响整表，已保留但请确认作用域')
  }
  return { ok: true, warnings }
}

export function mergeCssCode(existing: unknown, incoming: string, mode: 'append' | 'replace' = 'append'): string {
  const current = typeof existing === 'string' ? existing.trim() : ''
  const next = incoming.trim()
  if (mode === 'replace' || !current) return next
  if (current.includes(next)) return current
  return `${current}\n${next}`
}
