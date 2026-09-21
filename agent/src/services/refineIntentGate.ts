import type { FormJson, RefineOperation, RefinePlan, TargetRef } from '../schemas/refinePlan.js'
import { sanitizeFormPatch, sanitizeWidgetPatch } from './refinePropertyPolicy.js'
import { countWidgets } from './structureRefine.js'
import {
  instructionHasAlignIntent,
  alignIntentUnfulfilled,
} from './refineAlignPolicy.js'

const LABEL_WIDTH_INTENT = /标签宽|labelWidth|标签.*宽度|宽度.*标签/i
const SIZE_INTENT = /控件大小|组件大小|字号|尺寸|size/i
const REMOVE_INTENT = /删除|删掉|去掉|移除|remove/i
const REORDER_INTENT = /移到|排在|顺序|下面|上面|之前|之后|reorder|排序/i
const DUPLICATE_INTENT = /复制|拷贝|再来一份|duplicate|copy/i

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: Array<{ widgetList?: WidgetNode[] }>
}

function childLists(widget: WidgetNode): WidgetNode[][] {
  const lists: WidgetNode[][] = []
  if (Array.isArray(widget.widgetList)) lists.push(widget.widgetList)
  if (Array.isArray(widget.tabs)) lists.push(widget.tabs)
  if (Array.isArray(widget.cols)) {
    for (const col of widget.cols) {
      if (Array.isArray(col?.widgetList)) lists.push(col.widgetList)
    }
  }
  return lists
}

function matchesTarget(widget: WidgetNode, target: TargetRef): boolean {
  if (target.id && widget.id === target.id) return true
  const options = widget.options || {}
  const name = typeof options.name === 'string' ? options.name : ''
  if (target.name && name === target.name) return true
  const label = typeof options.label === 'string' ? options.label : ''
  if (target.label && label === target.label) return true
  return false
}

function findWidgetType(root: WidgetNode[], target: TargetRef): string | null {
  for (const w of root) {
    if (matchesTarget(w, target)) return typeof w.type === 'string' ? w.type : null
    for (const list of childLists(w)) {
      const found = findWidgetType(list, target)
      if (found) return found
    }
  }
  return null
}

function findWidget(root: WidgetNode[], target: TargetRef): WidgetNode | null {
  for (const w of root) {
    if (matchesTarget(w, target)) return w
    for (const list of childLists(w)) {
      const found = findWidget(list, target)
      if (found) return found
    }
  }
  return null
}

function patchHasKey(op: RefineOperation, key: string): boolean {
  if (op.op === 'updateField' || op.op === 'patchFormConfig') {
    return Boolean(op.patch && key in op.patch)
  }
  return false
}

export function instructionHasLabelWidthIntent(instruction: string): boolean {
  return LABEL_WIDTH_INTENT.test(instruction)
}

export function instructionHasSizeIntent(instruction: string): boolean {
  return SIZE_INTENT.test(instruction)
}

export function instructionHasRemoveIntent(instruction: string): boolean {
  return REMOVE_INTENT.test(instruction)
}

export function instructionHasReorderIntent(instruction: string): boolean {
  return REORDER_INTENT.test(instruction)
}

export function instructionHasDuplicateIntent(instruction: string): boolean {
  return DUPLICATE_INTENT.test(instruction)
}

function structureOpFailed(warnings: string[], opName: string): boolean {
  const failHints = ['未找到', '越界', '同一层级', '未删除', '插入位置', '不在本版 delete/reorder/duplicate']
  return warnings.some((w) => w.includes(opName) && failHints.some((h) => w.includes(h)))
}

/** 规划阶段：某键 patch 是否全部非法（按目标 type 校验，不再硬编码 radio） */
export function planPatchesAllIllegalForKey(
  plan: Pick<RefinePlan, 'operations'>,
  key: string,
  formJson: FormJson,
): boolean {
  let saw = false
  let anyLegal = false
  const root = (formJson.widgetList || []) as WidgetNode[]
  for (const op of plan.operations) {
    if (op.op === 'updateField' && op.patch && key in op.patch) {
      saw = true
      const type = findWidgetType(root, op.target) || 'input'
      const sanitized = sanitizeWidgetPatch(type, { [key]: op.patch[key] })
      if (sanitized.patch[key] !== undefined) anyLegal = true
    }
    if (op.op === 'patchFormConfig' && op.patch && key in op.patch) {
      saw = true
      const sanitized = sanitizeFormPatch({ [key]: op.patch[key] })
      if (sanitized.patch[key] !== undefined) anyLegal = true
    }
  }
  return saw && !anyLegal
}

function keyStrippedInWarnings(key: string, mergeWarnings: string[]): boolean {
  return mergeWarnings.some(
    (w) =>
      w.includes(key) &&
      (w.includes('类型或枚举不匹配') || w.includes('未知键') || w.includes('禁写键') || w.includes('无可应用')),
  )
}

function intentMessageForKey(key: string): string {
  if (key === 'labelAlign') {
    return '对齐诉求未落地：labelAlign 必须使用 label-left-align / label-center-align / label-right-align（字段级可用空字符串表示继承），禁止 right/left/center 等简称'
  }
  if (key === 'labelWidth') {
    return '标签宽度诉求未落地：labelWidth 必须为数字（如 450），禁止 "450px" 等带单位字符串；字段级 null 表示继承表单默认宽度'
  }
  if (key === 'size') {
    return '控件大小诉求未落地：size 必须为 ""（默认）/ large / small，禁止 "default" 等非法字面量'
  }
  return `${key} 诉求未落地：写入值未通过 Catalog 校验`
}

function highPrecisionKeyUnfulfilled(
  instruction: string,
  hasIntent: (s: string) => boolean,
  key: string,
  plan: RefinePlan,
  mergeWarnings: string[],
): { reject: boolean; message?: string } {
  if (!hasIntent(instruction)) return { reject: false }
  const keyOps = plan.operations.filter((op) => patchHasKey(op, key))
  if (keyOps.length === 0) return { reject: false }
  if (keyStrippedInWarnings(key, mergeWarnings)) {
    return { reject: true, message: intentMessageForKey(key) }
  }
  return { reject: false }
}

export function highPrecisionIntentUnfulfilled(
  instruction: string,
  plan: RefinePlan,
  mergeWarnings: string[],
): { reject: boolean; message?: string } {
  const align = alignIntentUnfulfilled(instruction, plan, mergeWarnings)
  if (align.reject) return align

  const gates = [
    highPrecisionKeyUnfulfilled(instruction, instructionHasLabelWidthIntent, 'labelWidth', plan, mergeWarnings),
    highPrecisionKeyUnfulfilled(instruction, instructionHasSizeIntent, 'size', plan, mergeWarnings),
  ]
  for (const gate of gates) {
    if (gate.reject) return gate
  }
  return { reject: false }
}

export function structureIntentUnfulfilled(
  instruction: string,
  plan: RefinePlan,
  mergeWarnings: string[],
): { reject: boolean; message?: string } {
  const hasRemove = plan.operations.some((op) => op.op === 'removeField' || op.op === 'removeFieldsInScope')
  const hasReorder = plan.operations.some((op) => op.op === 'reorderField')
  const hasDuplicate = plan.operations.some((op) => op.op === 'duplicateField')

  if (instructionHasRemoveIntent(instruction) && hasRemove) {
    if (
      mergeWarnings.some((w) => w.startsWith('removeField 未找到') || w.startsWith('removeFieldsInScope 未')) ||
      mergeWarnings.some((w) => w.includes('未删除任何控件'))
    ) {
      return { reject: true, message: '删除诉求未落地：未找到目标或目标不可删除' }
    }
  }
  if (instructionHasReorderIntent(instruction) && hasReorder && structureOpFailed(mergeWarnings, 'reorderField')) {
    return { reject: true, message: '排序诉求未落地：目标未移动或不在同一层级' }
  }
  if (instructionHasDuplicateIntent(instruction) && hasDuplicate && structureOpFailed(mergeWarnings, 'duplicateField')) {
    return { reject: true, message: '复制诉求未落地：未找到目标或目标不可复制' }
  }
  return { reject: false }
}

function readPatchValue(
  formJson: FormJson,
  op: Extract<RefineOperation, { op: 'updateField' } | { op: 'patchFormConfig' }>,
  key: string,
): unknown {
  if (op.op === 'patchFormConfig') {
    return formJson.formConfig?.[key]
  }
  const root = (formJson.widgetList || []) as WidgetNode[]
  const widget = findWidget(root, op.target)
  return widget?.options?.[key]
}

function formatValue(value: unknown): string {
  if (value === '') return '""'
  if (value === null) return 'null'
  return JSON.stringify(value)
}

/** 机器生成 summary：仅描述合入后实际变化；若计划键未变化则 reject */
export function buildHonestSummary(
  plan: RefinePlan,
  before: FormJson,
  after: FormJson,
  mergeWarnings: string[],
): { summary: string; reject: boolean; message?: string } {
  const changes: string[] = []
  let plannedButUnchanged = false

  for (const op of plan.operations) {
    if (op.op === 'setCssCode') {
      const beforeCss = String(before.formConfig?.cssCode || '')
      const afterCss = String(after.formConfig?.cssCode || '')
      if (beforeCss !== afterCss) {
        changes.push('formConfig.cssCode=updated')
      } else if (
        mergeWarnings.some((w) => w.includes('css') || w.includes('CSS') || w.includes('样式'))
      ) {
        plannedButUnchanged = true
      }
      continue
    }
    if (op.op === 'setCustomClass') {
      const root = (after.widgetList || []) as WidgetNode[]
      const widget = findWidget(root, op.target)
      const beforeRoot = (before.widgetList || []) as WidgetNode[]
      const beforeWidget = findWidget(beforeRoot, op.target)
      const beforeCls = beforeWidget?.options?.customClass
      const afterCls = widget?.options?.customClass
      if (JSON.stringify(beforeCls) !== JSON.stringify(afterCls)) {
        const target = op.target.id || op.target.name || 'field'
        changes.push(`${target}.customClass=${formatValue(afterCls)}`)
      }
      continue
    }
    if (op.op === 'removeField' || op.op === 'removeFieldsInScope') {
      if (
        mergeWarnings.some(
          (w) => w.includes('已删除 tab-pane') || w.startsWith('removeFieldsInScope 已删除'),
        )
      ) {
        changes.push('structure=removed')
      } else if (
        mergeWarnings.some(
          (w) =>
            w.startsWith('removeField 未找到') ||
            w.startsWith('removeFieldsInScope 未') ||
            w.includes('未删除任何控件'),
        )
      ) {
        plannedButUnchanged = true
      } else if (
        countWidgets((before.widgetList || []) as WidgetNode[]) >
        countWidgets((after.widgetList || []) as WidgetNode[])
      ) {
        changes.push('structure=removed')
      }
      continue
    }
    if (op.op === 'reorderField') {
      const beforeIds = ((before.widgetList || []) as WidgetNode[]).map((w) => w.id).join(',')
      const afterIds = ((after.widgetList || []) as WidgetNode[]).map((w) => w.id).join(',')
      if (beforeIds !== afterIds) {
        changes.push('structure=reordered')
      } else if (mergeWarnings.some((w) => w.startsWith('reorderField'))) {
        plannedButUnchanged = true
      }
      continue
    }
    if (op.op === 'duplicateField') {
      if (mergeWarnings.some((w) => w.startsWith('duplicateField 已复制'))) {
        changes.push('structure=duplicated')
      } else if (mergeWarnings.some((w) => w.startsWith('duplicateField'))) {
        plannedButUnchanged = true
      } else if (
        countWidgets((after.widgetList || []) as WidgetNode[]) >
        countWidgets((before.widgetList || []) as WidgetNode[])
      ) {
        changes.push('structure=duplicated')
      }
      continue
    }
    if (op.op === 'updateFieldsInScope') {
      const patch = op.patch || {}
      for (const key of Object.keys(patch)) {
        if (
          mergeWarnings.some(
            (w) =>
              w.includes(key) &&
              (w.includes('类型或枚举不匹配') || w.includes('无可应用')),
          )
        ) {
          plannedButUnchanged = true
        }
      }
      if (mergeWarnings.some((w) => w.includes('批量') && w.includes('已更新'))) {
        changes.push(`scope.${op.parent.id || op.parent.name || op.parent.label || 'parent'}=batch-updated`)
      }
      continue
    }
    if (op.op !== 'updateField' && op.op !== 'patchFormConfig') continue
    const patch = op.patch || {}
    for (const key of Object.keys(patch)) {
      const beforeVal = readPatchValue(before, op, key)
      const afterVal = readPatchValue(after, op, key)
      if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) {
        if (
          mergeWarnings.some(
            (w) =>
              w.includes(key) &&
              (w.includes('类型或枚举不匹配') || w.includes('无可应用')),
          )
        ) {
          plannedButUnchanged = true
        }
        continue
      }
      const target =
        op.op === 'patchFormConfig'
          ? 'formConfig'
          : op.target.id || op.target.name || 'field'
      changes.push(`${target}.${key}=${formatValue(afterVal)}`)
    }
  }

  if (plannedButUnchanged && changes.length === 0) {
    return {
      summary: plan.summary,
      reject: true,
      message: '优化未落地：计划修改的属性未写入合法值，请调整描述后重试',
    }
  }

  if (changes.length === 0) {
    return {
      summary: mergeWarnings.length
        ? `未写入画布变更（${mergeWarnings.slice(0, 2).join('；')}）`
        : plan.summary,
      reject: false,
    }
  }

  const prefix = mergeWarnings.length ? `部分警告：${mergeWarnings.slice(0, 2).join('；')}。` : ''
  return {
    summary: `${prefix}已更新：${changes.join('；')}`,
    reject: false,
  }
}

export { instructionHasAlignIntent }
