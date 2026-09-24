import type { RefineOperation, RefinePlan } from '../schemas/refinePlan.js'
import {
  DISPLAY_STYLE_ENUM,
  FIELD_LABEL_ALIGN_ENUM,
  FORM_LABEL_ALIGN_ENUM,
  WIDGET_SIZE_ENUM,
} from '../knowledge/catalogPolicy.js'

const LABEL_ALIGN_SYNONYMS: Record<string, string> = {
  right: 'label-right-align',
  left: 'label-left-align',
  center: 'label-center-align',
  middle: 'label-center-align',
  右: 'label-right-align',
  左: 'label-left-align',
  居中: 'label-center-align',
  右对齐: 'label-right-align',
  左对齐: 'label-left-align',
  居中对齐: 'label-center-align',
}

function normalizeLabelAlign(value: unknown, formLevel: boolean): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  const allowed = formLevel ? FORM_LABEL_ALIGN_ENUM : FIELD_LABEL_ALIGN_ENUM
  if (allowed.includes(trimmed)) return trimmed
  const mapped = LABEL_ALIGN_SYNONYMS[trimmed] || LABEL_ALIGN_SYNONYMS[trimmed.toLowerCase()]
  if (mapped) return mapped
  if (!trimmed.includes('label-')) {
    if (/右对齐|靠右|右/.test(trimmed)) return 'label-right-align'
    if (/左对齐|靠左|左/.test(trimmed)) return 'label-left-align'
    if (/居中|居中/.test(trimmed)) return 'label-center-align'
  }
  return value
}

/** 「450px」「450 像素」→ 450；已是 number 则保留 */
export function normalizeLabelWidthValue(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (value === null) return null
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:px|像素)?$/i)
    if (m) return Number(m[1])
  }
  return value
}

function normalizeSize(value: unknown): unknown {
  if (value === 'default' || value === '默认') return ''
  if (typeof value === 'string' && WIDGET_SIZE_ENUM.includes(value)) return value
  return value
}

function normalizeDisplayStyle(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (DISPLAY_STYLE_ENUM.includes(trimmed)) return trimmed
  const lower = trimmed.toLowerCase()
  if (lower === 'inline' || trimmed === '横排') return 'inline'
  if (lower === 'block' || trimmed === '竖排') return 'block'
  return value
}

/** 设计器 optionValueType："" | String | Number（Boolean 仅运行时兼容） */
export function normalizeOptionValueType(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'String' || trimmed === 'Number' || trimmed === 'Boolean') return trimmed
  const lower = trimmed.toLowerCase()
  if (lower === 'string' || trimmed === '字符串' || trimmed === '文本') return 'String'
  if (lower === 'number' || trimmed === '数字' || trimmed === '数字类型' || trimmed === '数值') return 'Number'
  if (lower === 'boolean' || trimmed === '布尔') return 'Boolean'
  return value
}

function normalizePatch(
  patch: Record<string, unknown>,
  formLevel: boolean,
): { patch: Record<string, unknown>; notes: string[] } {
  const notes: string[] = []
  const next = { ...patch }
  if ('labelAlign' in next) {
    const before = next.labelAlign
    next.labelAlign = normalizeLabelAlign(next.labelAlign, formLevel)
    if (JSON.stringify(before) !== JSON.stringify(next.labelAlign)) {
      notes.push(`labelAlign ${JSON.stringify(before)} → ${JSON.stringify(next.labelAlign)}`)
    }
  }
  if ('labelWidth' in next) {
    const before = next.labelWidth
    next.labelWidth = normalizeLabelWidthValue(next.labelWidth)
    if (JSON.stringify(before) !== JSON.stringify(next.labelWidth)) {
      notes.push(`labelWidth ${JSON.stringify(before)} → ${JSON.stringify(next.labelWidth)}`)
    }
  }
  if ('size' in next) {
    const before = next.size
    next.size = normalizeSize(next.size)
    if (JSON.stringify(before) !== JSON.stringify(next.size)) {
      notes.push(`size ${JSON.stringify(before)} → ${JSON.stringify(next.size)}`)
    }
  }
  if ('displayStyle' in next) {
    const before = next.displayStyle
    next.displayStyle = normalizeDisplayStyle(next.displayStyle)
    if (JSON.stringify(before) !== JSON.stringify(next.displayStyle)) {
      notes.push(`displayStyle ${JSON.stringify(before)} → ${JSON.stringify(next.displayStyle)}`)
    }
  }
  if ('optionValueType' in next) {
    const before = next.optionValueType
    next.optionValueType = normalizeOptionValueType(next.optionValueType)
    if (JSON.stringify(before) !== JSON.stringify(next.optionValueType)) {
      notes.push(`optionValueType ${JSON.stringify(before)} → ${JSON.stringify(next.optionValueType)}`)
    }
  }
  return { patch: next, notes }
}

function normalizeOp(op: RefineOperation): { op: RefineOperation; notes: string[] } {
  if (op.op === 'updateField' || op.op === 'updateFieldsInScope') {
    const { patch, notes } = normalizePatch(op.patch || {}, false)
    return { op: { ...op, patch }, notes }
  }
  if (op.op === 'patchFormConfig') {
    const { patch, notes } = normalizePatch(op.patch || {}, true)
    return { op: { ...op, patch }, notes }
  }
  return { op, notes: [] }
}

/**
 * 将 NL/模型输出的口语值归一为 Catalog 合法字面量（合入前）。
 * 例：right → label-right-align；450px → 450；default → ''。
 */
export function normalizeRefinePlanSynonyms(plan: RefinePlan): { plan: RefinePlan; warnings: string[] } {
  const warnings: string[] = []
  const operations: RefineOperation[] = []
  for (const op of plan.operations) {
    const { op: next, notes } = normalizeOp(op)
    operations.push(next)
    for (const note of notes) {
      warnings.push(`NL归一: ${note}`)
    }
  }
  return {
    plan: {
      ...plan,
      operations,
      warnings: [...plan.warnings, ...warnings],
    },
    warnings,
  }
}
