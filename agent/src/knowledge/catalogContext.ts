import { getWidgetCatalog } from './widgetCatalogStore.js'
import type { OptionConstraint, WidgetCatalog } from './widgetCatalog.js'
import type { FormFieldSummary } from '../services/formSummary.js'

const MAX_TYPES = 12
const MAX_WRITABLE_PER_TYPE = 24
const MAX_CONSTRAINT_KEYS = 16

export type CatalogSnippetConstraint = Pick<
  OptionConstraint,
  | 'valueType'
  | 'valueKind'
  | 'nullable'
  | 'enum'
  | 'source'
  | 'strict'
  | 'inheritEmpty'
  | 'unit'
  | 'editor'
  | 'compositeSchema'
  | 'propertyScope'
  | 'dualTrack'
  | 'writable'
  | 'forbiddenReason'
  | 'identityRole'
  | 'renderConvention'
>

export type CatalogSnippet = {
  type: string
  writableKeys: string[]
  forbiddenKeys: string[]
  structureSurgery?: string
  /** 相关约束（instruction 命中键优先；含 valueKind/enum/inherit） */
  constraints?: Record<string, CatalogSnippetConstraint>
  notes?: string[]
}

function toSnippetConstraint(constraint: OptionConstraint): CatalogSnippetConstraint {
  return {
    valueType: constraint.valueType,
    ...(constraint.valueKind ? { valueKind: constraint.valueKind } : {}),
    nullable: constraint.nullable,
    ...(constraint.enum ? { enum: constraint.enum } : {}),
    ...(constraint.source ? { source: constraint.source } : {}),
    ...(constraint.strict ? { strict: constraint.strict } : {}),
    ...(constraint.inheritEmpty ? { inheritEmpty: constraint.inheritEmpty } : {}),
    ...(constraint.unit ? { unit: constraint.unit } : {}),
    ...(constraint.editor ? { editor: constraint.editor } : {}),
    ...(constraint.compositeSchema ? { compositeSchema: constraint.compositeSchema } : {}),
    ...(constraint.propertyScope ? { propertyScope: constraint.propertyScope } : {}),
    ...(constraint.dualTrack ? { dualTrack: constraint.dualTrack } : {}),
    ...(constraint.writable !== undefined ? { writable: constraint.writable } : {}),
    ...(constraint.forbiddenReason ? { forbiddenReason: constraint.forbiddenReason } : {}),
    ...(constraint.identityRole ? { identityRole: constraint.identityRole } : {}),
    ...(constraint.renderConvention ? { renderConvention: constraint.renderConvention } : {}),
  }
}

function pickConstraints(
  all: Record<string, OptionConstraint>,
  writableKeys: string[],
  preferKeys: string[] = [],
): Record<string, CatalogSnippetConstraint> {
  const prefer = new Set(preferKeys)
  const keys = [
    ...writableKeys.filter((k) => prefer.has(k)),
    ...writableKeys.filter((k) => all[k]?.enum?.length || all[k]?.strict || all[k]?.valueKind),
    ...writableKeys.filter((k) => !prefer.has(k) && !all[k]?.enum?.length && !all[k]?.strict && !all[k]?.valueKind),
  ]
  const seen = new Set<string>()
  const out: Record<string, CatalogSnippetConstraint> = {}
  for (const key of keys) {
    if (seen.has(key) || !all[key]) continue
    seen.add(key)
    out[key] = toSnippetConstraint(all[key])
    if (Object.keys(out).length >= MAX_CONSTRAINT_KEYS) break
  }
  return out
}

function constraintNotes(key: string, constraint: CatalogSnippetConstraint | undefined): string[] {
  if (!constraint) return []
  const notes: string[] = []
  if (constraint.valueKind) {
    notes.push(`${key}.valueKind=${constraint.valueKind}${constraint.unit ? ` (存储为 number，渲染 +${constraint.unit})` : ''}`)
  }
  if (constraint.inheritEmpty) {
    notes.push(`${key} 空字符串/null 表示继承 formConfig.${key}`)
  }
  if (constraint.enum?.length) {
    notes.push(`${key} 合法 enum 见 constraints.${key}.enum`)
  }
  if (constraint.renderConvention) {
    notes.push(`render: ${constraint.renderConvention.effect}`)
  }
  if (constraint.dualTrack) {
    notes.push(
      `${key} 双轨：${constraint.dualTrack.note}（pairedScope=${constraint.dualTrack.pairedScope}, pairedValueKind=${constraint.dualTrack.pairedValueKind}）`,
    )
  }
  if (constraint.compositeSchema?.presets?.length) {
    notes.push(`${key} 预设见 constraints.${key}.compositeSchema.presets`)
  }
  if (constraint.compositeSchema?.requiredItemKeys?.length) {
    notes.push(
      `${key} item 必填字段: ${constraint.compositeSchema.requiredItemKeys.join(', ')}`,
    )
  }
  if (key === 'rows' && constraint.editor === 'rows-editor') {
    notes.push('autosize=true 时 rows 不可用（rows-editor 隐藏）')
  }
  return notes
}

/** 从自然语言粗提可能改写的属性键，优先保留进 snippet */
export function inferPreferredKeysFromInstruction(instruction?: string): string[] {
  if (!instruction) return []
  const keys: string[] = []
  if (/对齐|居中|靠右|靠左|labelAlign|右对齐|左对齐/i.test(instruction)) keys.push('labelAlign')
  if (/横排|竖排|inline|block|displayStyle|选项.*排/i.test(instruction)) keys.push('displayStyle')
  if (/标签宽|labelWidth/i.test(instruction)) keys.push('labelWidth')
  if (/占位|placeholder/i.test(instruction)) keys.push('placeholder')
  if (/字号|大小|size/i.test(instruction)) keys.push('size')
  if (/列宽|columnWidth/i.test(instruction)) keys.push('columnWidth')
  if (/换行|labelWrap|重叠|挤|overflow/i.test(instruction)) keys.push('labelWrap')
  if (/重叠|挤|overlap|排版|错位|选项.*排|横排|竖排|inline|block|displayStyle/i.test(instruction)) {
    keys.push('displayStyle', 'labelWrap', 'labelWidth')
  }
  if (/选项值类型|optionValueType|数值类型/i.test(instruction)) keys.push('optionValueType')
  if (/选项|optionItems|分值/i.test(instruction)) keys.push('optionItems')
  if (/默认|defaultValue/i.test(instruction)) keys.push('defaultValue')
  if (/行数|rows|autosize|自适应/i.test(instruction)) keys.push('rows', 'autosize')
  if (/页签|tab-pane|tab pane|标签页/i.test(instruction)) keys.push('label', 'active')
  if (/栅格|列宽|span|offset|responsive|grid-col/i.test(instruction)) {
    keys.push('span', 'offset', 'push', 'pull', 'responsive', 'md', 'sm', 'xs')
  }
  return keys
}

export function buildCatalogSnippets(
  fields: FormFieldSummary[],
  catalog: WidgetCatalog = getWidgetCatalog(),
  instruction?: string,
): CatalogSnippet[] {
  const types = [...new Set(fields.map((f) => f.type).filter(Boolean) as string[])].slice(0, MAX_TYPES)
  const preferKeys = inferPreferredKeysFromInstruction(instruction)
  return types.map((type) => {
    const entry = catalog.widgets.find((w) => w.type === type)
    if (!entry) {
      return { type, writableKeys: [], forbiddenKeys: [], structureSurgery: 'unknown', constraints: {} }
    }
    const writableKeys = [
      ...entry.writableKeys.filter((k) => preferKeys.includes(k)),
      ...entry.writableKeys.filter((k) => !preferKeys.includes(k)),
    ].slice(0, MAX_WRITABLE_PER_TYPE)
    const constraints = pickConstraints(entry.constraints, entry.writableKeys, preferKeys)
    const notes: string[] = []
    for (const key of preferKeys.length ? preferKeys : ['labelAlign', 'labelWidth', 'size', 'displayStyle']) {
      notes.push(...constraintNotes(key, constraints[key]))
    }
    if (constraints.labelAlign && !notes.some((n) => n.includes('labelAlign'))) {
      notes.push('labelAlign 空字符串表示继承 formConfig.labelAlign；合法值见 constraints.labelAlign.enum')
    }
    if (constraints.labelWidth && !notes.some((n) => n.includes('labelWidth'))) {
      notes.push('labelWidth 必须为数字（设计器渲染时自动加 px）；null 表示继承 formConfig.labelWidth；禁止 "450px"')
    }
    if (constraints.size && !notes.some((n) => n.includes('size'))) {
      notes.push('size 合法值见 constraints.size.enum；"" 表示默认尺寸，禁止写入 "default" 字面量')
    }
    if (constraints.columnWidth) {
      notes.push('columnWidth 为 css 文本（如 "200px"），与 labelWidth 数字不同')
    }
    if (constraints.labelWrap) {
      notes.push('labelWrap=true 时标签可换行（form-item-wrapper .label-wrap）；长题干与选项重叠时优先开启')
    }
    if (constraints.displayStyle && !notes.some((n) => n.includes('displayStyle'))) {
      notes.push('displayStyle=block 时选项竖排；inline 时横排易与长标签重叠，重叠类诉求优先 block')
    }
    if (constraints.optionValueType || preferKeys.includes('optionValueType')) {
      notes.push(
        'optionValueType 只能是 "" / "String" / "Number"（设计器字面量，禁止 number/string 小写）；整表批量可用 updateFieldsInScope + parent.pathPrefix="widgetList"',
      )
    }
    if (constraints.customClass) {
      notes.push(
        '字段 customClass：计划为 string，写出 formJson 为 string[]（对齐 v-form）；表单 formConfig.customClass 为 string[]',
      )
    }
    if (entry.forbiddenKeys.length) {
      notes.push(
        `forbiddenKeys 可见但禁写: ${entry.forbiddenKeys.slice(0, 8).join(', ')}${entry.forbiddenKeys.length > 8 ? '…' : ''}`,
      )
    }
    for (const rule of catalog.identity?.rules || []) {
      notes.push(`identity ${rule.id}: ${rule.note}`)
    }
    return {
      type,
      writableKeys,
      forbiddenKeys: entry.forbiddenKeys.slice(0, 12),
      structureSurgery: entry.notes?.structureSurgery,
      constraints,
      notes: notes.length ? [...new Set(notes)] : undefined,
    }
  })
}
