import type { FormJson, RefineOperation, RefinePlan } from '../schemas/refinePlan.js'
import { buildFormSummary } from './formSummary.js'

/** 标签/选项/题干重叠、错位等布局问题 */
export const OVERLAP_INTENT =
  /重叠|挤在一起|挤在|盖住|遮挡|overlap|错位|排版|题干.*选项|标签.*选项|选项.*标签|label.*option|option.*label/i

/** 广义布局/样式诉求（不含纯对齐——对齐走 refineAlignPolicy） */
export const LAYOUT_STYLE_INTENT =
  /样式|布局|间距|换行|溢出|排版|错位|重叠|挤|overlap|layout|margin|padding|美观|显示问题/i

export const EXPLICIT_CSS_INTENT = /cssCode|用CSS|受控样式|css修复/i

export const LAYOUT_PROPERTY_KEYS = [
  'labelWrap',
  'displayStyle',
  'labelWidth',
  'labelPosition',
  'labelAlign',
] as const

const CHOICE_TYPES = new Set(['radio', 'checkbox', 'select'])

export function instructionHasOverlapIntent(instruction: string): boolean {
  return OVERLAP_INTENT.test(instruction)
}

export function instructionHasLayoutStyleIntent(instruction: string): boolean {
  return LAYOUT_STYLE_INTENT.test(instruction)
}

function opTouchesLayout(op: RefineOperation): boolean {
  if (op.op === 'setCssCode' || op.op === 'setCustomClass') return true
  if (op.op === 'updateField' || op.op === 'patchFormConfig' || op.op === 'updateFieldsInScope') {
    return Object.keys(op.patch || {}).some((k) =>
      (LAYOUT_PROPERTY_KEYS as readonly string[]).includes(k),
    )
  }
  return false
}

export function planHasLayoutResolution(plan: Pick<RefinePlan, 'operations'>): boolean {
  return plan.operations.some(opTouchesLayout)
}

function parseLabelWidthFromInstruction(instruction: string): number | undefined {
  const m =
    instruction.match(/(?:标签宽|labelWidth|宽度)[^\d]*(\d+)/i) ||
    instruction.match(/(\d+)\s*(?:px|像素)?(?:宽|的标签)/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function wantsBlockDisplay(instruction: string): boolean {
  return /竖排|block|换行|overlap|重叠|挤|选项.*换行/i.test(instruction)
}

function wantsLabelWrap(instruction: string): boolean {
  return /换行|溢出|长.*标签|长.*题干|labelWrap|wrap/i.test(instruction) || instructionHasOverlapIntent(instruction)
}

export function buildOverlapPropertyPatch(instruction: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (wantsLabelWrap(instruction)) patch.labelWrap = true
  if (wantsBlockDisplay(instruction) || instructionHasOverlapIntent(instruction)) {
    patch.displayStyle = 'block'
  }
  const lw = parseLabelWidthFromInstruction(instruction)
  if (lw !== undefined) patch.labelWidth = lw
  else if (instructionHasOverlapIntent(instruction)) {
    patch.labelWidth = 280
  }
  return patch
}

export function pickOverlapTargets(
  formJson: FormJson,
  instruction: string,
): Array<{ id?: string; name?: string; label?: string; type?: string }> {
  const flat = buildFormSummary(formJson, instruction)
  const typeFilter = /radio|单选/.test(instruction)
    ? 'radio'
    : /checkbox|多选/.test(instruction)
      ? 'checkbox'
      : /select|下拉/.test(instruction)
        ? 'select'
        : null

  let candidates = flat.filter((f) => f.type && CHOICE_TYPES.has(f.type))
  if (typeFilter) candidates = candidates.filter((f) => f.type === typeFilter)

  const longLabel = candidates.filter((f) => (f.label?.length || 0) >= 8)
  if (longLabel.length > 0) candidates = longLabel

  const inlineFields = candidates.filter((f) => {
    const ds = f.writableSnapshot?.displayStyle
    return ds === 'inline' || ds === undefined
  })
  if (inlineFields.length > 0) candidates = inlineFields

  if (candidates.length === 0) {
    candidates = flat.filter((f) => f.type && CHOICE_TYPES.has(f.type))
  }

  return candidates.slice(0, 20).map((f) => ({
    id: f.id,
    name: f.name,
    label: f.label,
    type: f.type,
  }))
}

/**
 * 重叠/布局诉求但规划未产出属性或 CSS 时，自动补充属性优先修复（labelWrap + displayStyle:block + labelWidth）。
 */
export function enrichLayoutPlan(
  instruction: string,
  plan: RefinePlan,
  formJson: FormJson,
): { plan: RefinePlan; warnings: string[] } {
  const warnings: string[] = []
  if (!instructionHasOverlapIntent(instruction) && !instructionHasLayoutStyleIntent(instruction)) {
    return { plan, warnings }
  }
  if (planHasLayoutResolution(plan)) {
    return { plan, warnings }
  }
  if (EXPLICIT_CSS_INTENT.test(instruction) && !instructionHasOverlapIntent(instruction)) {
    return { plan, warnings }
  }

  const targets = pickOverlapTargets(formJson, instruction)
  if (targets.length === 0) return { plan, warnings }

  const patch = buildOverlapPropertyPatch(instruction)
  if (Object.keys(patch).length === 0) return { plan, warnings }

  const newOps: RefineOperation[] = [...plan.operations]
  const flat = buildFormSummary(formJson, instruction)

  if (targets.length >= 2 && targets.every((t) => t.type === targets[0]?.type)) {
    const parentKeys = new Set(
      targets
        .map((t) => {
          const f = flat.find((x) => x.id === t.id || x.name === t.name)
          return f?.parent?.label || f?.parent?.name
        })
        .filter(Boolean),
    )
    if (parentKeys.size === 1) {
      const sample = flat.find((f) => targets.some((t) => t.id === f.id))
      const parent = sample?.parent
      if (parent?.label || parent?.name) {
        newOps.push({
          op: 'updateFieldsInScope',
          parent: parent.label ? { label: parent.label } : { name: parent.name! },
          filterType: targets[0]?.type,
          patch,
        })
        warnings.push('布局专项：已自动补充 labelWrap/displayStyle/labelWidth 属性修复（属性优先于 CSS）')
        return {
          plan: { ...plan, operations: newOps, warnings: [...plan.warnings, ...warnings] },
          warnings,
        }
      }
    }
  }

  for (const target of targets) {
    const targetRef = target.id ? { id: target.id } : target.name ? { name: target.name } : null
    if (!targetRef) continue
    newOps.push({
      op: 'updateField',
      target: targetRef,
      patch: { ...patch },
    })
  }

  if (newOps.length > plan.operations.length) {
    warnings.push('布局专项：已自动补充 labelWrap/displayStyle/labelWidth 属性修复（属性优先于 CSS）')
  }

  return {
    plan: { ...plan, operations: newOps, warnings: [...plan.warnings, ...warnings] },
    warnings,
  }
}

function readLayoutSnapshot(formJson: FormJson): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  for (const f of buildFormSummary(formJson)) {
    const key = f.id || f.name || f.path
    const snap: Record<string, unknown> = {}
    for (const k of LAYOUT_PROPERTY_KEYS) {
      const v = f.writableSnapshot?.[k]
      if (v !== undefined) snap[k] = v
    }
    map.set(key, snap)
  }
  return map
}

function countLayoutPropertyChanges(before: FormJson, after: FormJson): number {
  const beforeMap = readLayoutSnapshot(before)
  const afterMap = readLayoutSnapshot(after)
  let changes = 0
  for (const [key, afterSnap] of afterMap) {
    const beforeSnap = beforeMap.get(key) || {}
    for (const k of LAYOUT_PROPERTY_KEYS) {
      if (JSON.stringify(beforeSnap[k]) !== JSON.stringify(afterSnap[k])) {
        changes += 1
        break
      }
    }
  }
  const beforeForm = before.formConfig || {}
  const afterForm = after.formConfig || {}
  for (const k of ['labelWidth', 'labelPosition', 'labelAlign'] as const) {
    if (JSON.stringify(beforeForm[k]) !== JSON.stringify(afterForm[k])) changes += 1
  }
  return changes
}

/** 重叠诉求必须产生属性或 cssCode 实际变化，禁止半成功 */
export function layoutIntentUnfulfilled(
  instruction: string,
  plan: RefinePlan,
  before: FormJson,
  after: FormJson,
  mergeWarnings: string[],
): { reject: boolean; message?: string } {
  if (!instructionHasOverlapIntent(instruction)) return { reject: false }

  const layoutOps = plan.operations.filter(opTouchesLayout)
  if (layoutOps.length === 0) {
    return {
      reject: true,
      message:
        '布局重叠诉求未落地：请通过 labelWrap、displayStyle:block、labelWidth 等属性，或受控 cssCode 修复，禁止改文案规避',
    }
  }

  const propertyChanges = countLayoutPropertyChanges(before, after)
  const cssChanged =
    String(before.formConfig?.cssCode || '') !== String(after.formConfig?.cssCode || '')
  const customClassChanged =
    JSON.stringify(before.formConfig?.customClass || []) !==
    JSON.stringify(after.formConfig?.customClass || [])

  if (propertyChanges === 0 && !cssChanged && !customClassChanged) {
    const stripped = mergeWarnings.some(
      (w) =>
        /labelWrap|displayStyle|labelWidth|labelAlign|labelPosition/.test(w) &&
        (w.includes('类型或枚举不匹配') ||
          w.includes('未知键') ||
          w.includes('无可应用') ||
          w.includes('禁写键')),
    )
    if (stripped || layoutOps.length > 0) {
      return {
        reject: true,
        message:
          '布局重叠诉求未落地：属性写入未通过 Catalog 校验或未产生变化，请调整描述后重试',
      }
    }
  }

  return { reject: false }
}
