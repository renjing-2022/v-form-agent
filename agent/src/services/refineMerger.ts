import { widgetTemplates, containerTemplates } from '../knowledge/widgetWhitelist.js'
import type { RefineOperation, RefinePlan, TargetRef, FormJson } from '../schemas/refinePlan.js'
import type { FieldType } from '../schemas/fieldPlan.js'

type WidgetNode = Record<string, unknown> & {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
}

export type MergeResult = {
  formJson: FormJson
  warnings: string[]
}

function slugify(input: string, fallback: string) {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (raw || fallback).slice(0, 40)
}

function deepClone<T>(value: T): T {
  return structuredClone(value)
}

function childCollections(widget: WidgetNode): WidgetNode[][] {
  const lists: WidgetNode[][] = []
  if (Array.isArray(widget.widgetList)) lists.push(widget.widgetList)
  if (Array.isArray(widget.tabs)) lists.push(widget.tabs)
  if (Array.isArray(widget.cols)) {
    for (const col of widget.cols) {
      if (Array.isArray(col.widgetList)) lists.push(col.widgetList)
    }
  }
  return lists
}

function matchesTarget(widget: WidgetNode, target: TargetRef): boolean {
  if (target.id && widget.id === target.id) return true
  const name = typeof widget.options?.name === 'string' ? widget.options.name : ''
  if (target.name && name === target.name) return true
  return false
}

function findWidget(root: WidgetNode[], target: TargetRef): WidgetNode | null {
  for (const w of root) {
    if (matchesTarget(w, target)) return w
    for (const list of childCollections(w)) {
      const found = findWidget(list, target)
      if (found) return found
    }
  }
  return null
}

function collectAllNames(root: WidgetNode[], into = new Set<string>()) {
  for (const w of root) {
    const name = typeof w.options?.name === 'string' ? w.options.name : ''
    if (name) into.add(name)
    for (const list of childCollections(w)) collectAllNames(list, into)
  }
  return into
}

function collectAllIds(root: WidgetNode[], into = new Set<string>()) {
  for (const w of root) {
    if (typeof w.id === 'string' && w.id) into.add(w.id)
    for (const list of childCollections(w)) collectAllIds(list, into)
  }
  return into
}

function uniqueName(base: string, used: Set<string>) {
  let name = base
  let i = 1
  while (used.has(name)) name = `${base}_${i++}`
  used.add(name)
  return name
}

function nextId(prefix: string, used: Set<string>) {
  let seq = used.size + 1
  let id = `${prefix}${seq}`
  while (used.has(id)) {
    seq += 1
    id = `${prefix}${seq}`
  }
  used.add(id)
  return id
}

function removeTargetsFromList(list: WidgetNode[], targets: TargetRef[]): WidgetNode[] {
  const removed: WidgetNode[] = []
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i]
    if (targets.some((t) => matchesTarget(w, t))) {
      removed.unshift(w)
      list.splice(i, 1)
    }
  }
  return removed
}

function extractTargetsFromTree(root: WidgetNode[], targets: TargetRef[]): WidgetNode[] {
  const extracted: WidgetNode[] = []
  const direct = removeTargetsFromList(root, targets)
  extracted.push(...direct)
  for (const w of root) {
    for (const list of childCollections(w)) {
      extracted.push(...extractTargetsFromTree(list, targets))
    }
  }
  return extracted
}

function formulaRef(widget: WidgetNode): string {
  const id = String(widget.id || '')
  const label = String(widget.options?.label || widget.options?.name || id)
  return `{{${id}.[${label}].field}}`
}

function compileFormula(raw: string, root: WidgetNode[]): { formula: string; warnings: string[] } {
  const warnings: string[] = []
  if (raw.includes('{{')) return { formula: raw, warnings }

  // 支持简单 name / name+name / name + name
  const names = collectAllNames(root)
  const tokens = raw.match(/[A-Za-z_][\w]*|[\u4e00-\u9fa5]+|[+\-*/()]/g) || []
  let out = ''
  for (const token of tokens) {
    if (/^[+\-*/()]$/.test(token) || /^\d+(\.\d+)?$/.test(token)) {
      out += token
      continue
    }
    if (names.has(token)) {
      const widget = findWidget(root, { name: token })
      if (widget) {
        out += formulaRef(widget)
      } else {
        warnings.push(`公式引用字段「${token}」未找到`)
        out += token
      }
      continue
    }
    // 尝试按 label 找
    const byLabel = findByLabel(root, token)
    if (byLabel) {
      out += formulaRef(byLabel)
      continue
    }
    out += token
  }
  if (!out.includes('{{')) {
    warnings.push('公式未能编译为平台字段引用，已原样写入，请人工核对')
  }
  return { formula: out || raw, warnings }
}

function findByLabel(root: WidgetNode[], label: string): WidgetNode | null {
  for (const w of root) {
    if (String(w.options?.label || '') === label) return w
    for (const list of childCollections(w)) {
      const found = findByLabel(list, label)
      if (found) return found
    }
  }
  return null
}

function createFieldWidget(
  field: {
    key: string
    label: string
    type: FieldType
    required?: boolean
    options?: Array<{ label: string; value: string | number }>
    textContent?: string
    formula?: string
    formulaEnabled?: boolean
  },
  usedNames: Set<string>,
  usedIds: Set<string>,
): WidgetNode {
  const tpl = widgetTemplates[field.type]
  const name = uniqueName(slugify(field.key || field.label, 'field'), usedNames)
  const options: Record<string, unknown> = {
    ...deepClone(tpl.options),
    name,
    label: field.label,
    required: Boolean(field.required),
  }
  if (field.type === 'radio' || field.type === 'select') {
    options.optionItems = (field.options || []).map((o) => ({ label: o.label, value: o.value }))
  }
  if (field.type === 'static-text') {
    options.textContent = field.textContent || field.label
  }
  if (field.type === 'number' && (field.formula || field.formulaEnabled)) {
    options.formulaEnabled = field.formulaEnabled !== false
    options.formula = field.formula || ''
  }
  const idPrefix = field.type.replace(/-/g, '')
  return {
    type: tpl.type,
    icon: tpl.icon,
    formItemFlag: tpl.formItemFlag ?? false,
    options,
    id: nextId(idPrefix, usedIds),
  }
}

function applyUpdateField(root: WidgetNode[], op: Extract<RefineOperation, { op: 'updateField' }>, warnings: string[]) {
  const widget = findWidget(root, op.target)
  if (!widget) {
    warnings.push(`updateField 未找到目标 ${op.target.id || op.target.name}`)
    return
  }
  widget.options = widget.options || {}
  if (op.patch.label !== undefined) widget.options.label = op.patch.label
  if (op.patch.required !== undefined) widget.options.required = op.patch.required
  if (op.patch.textContent !== undefined) widget.options.textContent = op.patch.textContent
  if (op.patch.optionItems) {
    if (widget.type !== 'radio' && widget.type !== 'select') {
      warnings.push(`目标 ${widget.options.name} 非 radio/select，已忽略 optionItems`)
    } else {
      widget.options.optionItems = op.patch.optionItems.map((o) => ({
        label: o.label,
        value: o.value,
      }))
    }
  }
}

function applySetFormula(root: WidgetNode[], op: Extract<RefineOperation, { op: 'setFormula' }>, warnings: string[]) {
  const widget = findWidget(root, op.target)
  if (!widget) {
    warnings.push(`setFormula 未找到目标 ${op.target.id || op.target.name}`)
    return
  }
  if (widget.type !== 'number') {
    warnings.push(`setFormula 目标必须是 number，当前为 ${widget.type}`)
    return
  }
  const compiled = compileFormula(op.formula, root)
  warnings.push(...compiled.warnings)
  widget.options = widget.options || {}
  widget.options.formulaEnabled = op.formulaEnabled !== false
  widget.options.formula = compiled.formula
}

function applyAddField(root: WidgetNode[], op: Extract<RefineOperation, { op: 'addField' }>, warnings: string[]) {
  const usedNames = collectAllNames(root)
  const usedIds = collectAllIds(root)
  const widget = createFieldWidget(op.field, usedNames, usedIds)
  if (widget.type === 'number' && typeof widget.options?.formula === 'string' && widget.options.formula) {
    const compiled = compileFormula(String(widget.options.formula), root)
    warnings.push(...compiled.warnings)
    widget.options.formula = compiled.formula
    widget.options.formulaEnabled = true
  }
  if (op.parent) {
    const parent = findWidget(root, op.parent)
    if (!parent) {
      warnings.push(`addField parent 未找到，已追加到根节点`)
      root.push(widget)
      return
    }
    if (!Array.isArray(parent.widgetList)) parent.widgetList = []
    parent.widgetList.push(widget)
    return
  }
  root.push(widget)
}

function applyWrapInTabs(root: WidgetNode[], op: Extract<RefineOperation, { op: 'wrapInTabs' }>, warnings: string[]) {
  if (root.some((w) => w.type === 'tab')) {
    warnings.push('根节点已存在 tab，跳过 wrapInTabs')
    return
  }
  const usedNames = collectAllNames(root)
  const usedIds = collectAllIds(root)
  const assigned = new Set<string>()
  const panes: WidgetNode[] = []

  for (const paneSpec of op.panes) {
    let moved: WidgetNode[] = []
    if (paneSpec.targets.length > 0) {
      moved = extractTargetsFromTree(root, paneSpec.targets)
      for (const w of moved) {
        if (typeof w.id === 'string') assigned.add(w.id)
      }
    }
    const paneName = uniqueName(slugify(paneSpec.label, 'pane'), usedNames)
    panes.push({
      type: 'tab-pane',
      category: 'container',
      icon: containerTemplates['tab-pane'].icon,
      options: {
        ...deepClone(containerTemplates['tab-pane'].options),
        name: paneName,
        label: paneSpec.label,
        active: panes.length === 0,
      },
      id: nextId('tabpane', usedIds),
      widgetList: moved,
    })
  }

  // 未指定 targets 的 pane：把剩余顶层塞进第一个空 pane；否则新建「其他」
  const leftovers = [...root]
  root.length = 0
  if (leftovers.length > 0) {
    const emptyPane = panes.find((p) => Array.isArray(p.widgetList) && p.widgetList.length === 0)
    if (emptyPane && Array.isArray(emptyPane.widgetList)) {
      emptyPane.widgetList.push(...leftovers)
    } else if (panes[0] && Array.isArray(panes[0].widgetList)) {
      panes[0].widgetList.push(...leftovers)
      warnings.push('未匹配到空 pane，剩余控件已放入第一个 tab')
    } else {
      const otherName = uniqueName('other_pane', usedNames)
      panes.push({
        type: 'tab-pane',
        category: 'container',
        icon: containerTemplates['tab-pane'].icon,
        options: {
          ...deepClone(containerTemplates['tab-pane'].options),
          name: otherName,
          label: '其他',
        },
        id: nextId('tabpane', usedIds),
        widgetList: leftovers,
      })
    }
  }

  const tabName = uniqueName(slugify(op.tabName || 'main_tabs', 'tabs'), usedNames)
  root.push({
    type: 'tab',
    category: 'container',
    icon: containerTemplates.tab.icon,
    options: {
      ...deepClone(containerTemplates.tab.options),
      name: tabName,
    },
    id: nextId('tab', usedIds),
    tabs: panes,
  })
}

export function applyRefinePlan(current: FormJson, plan: RefinePlan): MergeResult {
  const formJson = deepClone(current)
  const warnings = [...(plan.warnings || [])]
  const root = formJson.widgetList as WidgetNode[]

  for (const op of plan.operations) {
    switch (op.op) {
      case 'updateField':
        applyUpdateField(root, op, warnings)
        break
      case 'setFormula':
        applySetFormula(root, op, warnings)
        break
      case 'addField':
        applyAddField(root, op, warnings)
        break
      case 'wrapInTabs':
        applyWrapInTabs(root, op, warnings)
        break
      default:
        warnings.push(`未知操作已忽略`)
    }
  }

  return { formJson, warnings }
}
