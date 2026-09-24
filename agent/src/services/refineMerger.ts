import { buildWidgetFromCatalogDefaults, getWidgetDefaultSchema } from '../knowledge/widgetDefaults.js'
import type { RefineOperation, RefinePlan, TargetRef, FormJson } from '../schemas/refinePlan.js'
import type { FieldType } from '../schemas/fieldPlan.js'
import {
  sanitizeFormPatch,
  sanitizeWidgetPatch,
  reconcileMultipleDefaultValue,
  reconcileOptionValueType,
  widgetSupportsOptionValueType,
} from './refinePropertyPolicy.js'
import { mergeCssCode, validateCssCode } from './cssGuard.js'
import { isHeavyStructureType } from './catalogValidator.js'
import { resolveScopeFields } from './targetResolver.js'
import {
  findWidgetByTarget,
  preSanitizeContainerPatch,
  reconcileTabPaneActive,
} from './containerRefine.js'
import {
  cloneWidgetWithNewIdentity,
  findWidgetLocation,
  removeWidgetFromTree,
  structureOpNonGoalMessage,
  type ReorderPosition,
  type WidgetNode as StructureWidgetNode,
} from './structureRefine.js'
import {
  applyAddTableColumn,
  applyRemoveTableColumn,
  applyReorderTableColumn,
  applyUpdateTableColumn,
  stripTableColumnsFromPatch,
} from './tableColumnRefine.js'
import {
  normalizeFormJsonWidgetCustomClasses,
  toVFormWidgetCustomClass,
} from './customClassRuntime.js'

/** addField 可作 parent 的重型容器（其余 heavy 仍拒绝） */
const ADD_FIELD_PARENT_ALLOWED_HEAVY = new Set(['sub-form', 'vf-dialog'])

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
  if (Array.isArray(widget.cols)) lists.push(widget.cols)
  if (Array.isArray(widget.cols)) {
    for (const col of widget.cols) {
      if (Array.isArray(col.widgetList)) lists.push(col.widgetList)
    }
  }
  return lists
}

function matchesTarget(widget: WidgetNode, target: TargetRef): boolean {
  if (target.containerType && widget.type !== target.containerType) return false
  if (target.id && widget.id === target.id) return true
  const options = widget.options || {}
  const name = typeof options.name === 'string' ? options.name : ''
  if (target.name && name === target.name) return true
  const label = typeof options.label === 'string' ? options.label : ''
  if (target.label && label === target.label) return true
  return false
}

function findWidget(root: WidgetNode[], target: TargetRef): WidgetNode | null {
  return findWidgetByTarget(root, target)
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
  const schema = getWidgetDefaultSchema(field.type)
  if (!schema) {
    throw new Error(`addField 无法克隆 widgetsConfig 默认项: type="${field.type}" 不在 Catalog`)
  }
  const name = uniqueName(slugify(field.key || field.label, 'field'), usedNames)
  const optionOverrides: Record<string, unknown> = {
    label: field.label,
    required: Boolean(field.required),
  }
  if (field.type === 'radio' || field.type === 'select') {
    optionOverrides.optionItems = (field.options || []).map((o) => ({ label: o.label, value: o.value }))
  }
  if (field.type === 'static-text') {
    optionOverrides.textContent = field.textContent || field.label
  }
  if (field.type === 'number' && (field.formula || field.formulaEnabled)) {
    optionOverrides.formulaEnabled = field.formulaEnabled !== false
    optionOverrides.formula = field.formula || ''
  }
  const idPrefix = field.type.replace(/-/g, '')
  return buildWidgetFromCatalogDefaults(field.type, {
    id: nextId(idPrefix, usedIds),
    name,
    optionOverrides,
  }) as WidgetNode
}

function applyUpdateField(root: WidgetNode[], op: Extract<RefineOperation, { op: 'updateField' }>, warnings: string[]) {
  const widget = findWidget(root, op.target)
  if (!widget) {
    warnings.push(`updateField 未找到目标 ${op.target.id || op.target.name}`)
    return
  }
  widget.options = widget.options || {}
  const type = String(widget.type || '')
  const stripped = stripTableColumnsFromPatch(type, op.patch as Record<string, unknown>)
  warnings.push(...stripped.warnings)
  const containerPre = preSanitizeContainerPatch(type, stripped.patch)
  warnings.push(...containerPre.warnings)
  if (containerPre.blocked || Object.keys(containerPre.patch).length === 0) {
    if (!containerPre.blocked && Object.keys(op.patch as object).length > 0) {
      warnings.push(`updateField 无可应用属性: ${op.target.id || op.target.name || op.target.label}`)
    } else if (containerPre.blocked) {
      warnings.push(`updateField 无可应用属性: ${op.target.id || op.target.name || op.target.label}`)
    }
    return
  }
  const sanitized = sanitizeWidgetPatch(type, containerPre.patch, undefined, widget.options)
  warnings.push(...sanitized.warnings)
  if (Object.keys(sanitized.patch).length === 0) {
    warnings.push(`updateField 无可应用属性: ${op.target.id || op.target.name}`)
    return
  }
  if (sanitized.patch.optionItems) {
    if (widget.type !== 'radio' && widget.type !== 'select' && widget.type !== 'checkbox' && widget.type !== 'cascader') {
      warnings.push(`目标 ${widget.options.name} 不支持 optionItems，已忽略`)
      delete sanitized.patch.optionItems
    }
  }
  Object.assign(widget.options, sanitized.patch)
  if (sanitized.patch.customClass !== undefined) {
    widget.options.customClass = toVFormWidgetCustomClass(widget.options.customClass)
  }
  if (sanitized.patch.optionValueType !== undefined) {
    warnings.push(...reconcileOptionValueType(widget.options, type))
  }
  warnings.push(...reconcileMultipleDefaultValue(widget.options, type))
  reconcileTabPaneActive(root, widget, warnings)
}

function applyPatchFormConfig(formJson: FormJson, op: Extract<RefineOperation, { op: 'patchFormConfig' }>, warnings: string[]) {
  const sanitized = sanitizeFormPatch(op.patch as Record<string, unknown>)
  warnings.push(...sanitized.warnings)
  if (sanitized.patch.cssCode !== undefined) {
    const css = String(sanitized.patch.cssCode)
    const guard = validateCssCode(css)
    warnings.push(...guard.warnings)
    if (!guard.ok) {
      warnings.push(guard.message || 'cssCode 未通过护栏，已忽略')
      delete sanitized.patch.cssCode
    }
  }
  if (Object.keys(sanitized.patch).length === 0) {
    warnings.push('patchFormConfig 无可应用属性')
    return
  }
  formJson.formConfig = { ...(formJson.formConfig || {}), ...sanitized.patch }
}

function applySetCustomClass(root: WidgetNode[], op: Extract<RefineOperation, { op: 'setCustomClass' }>, warnings: string[]) {
  const widget = findWidget(root, op.target)
  if (!widget) {
    warnings.push(`setCustomClass 未找到目标 ${op.target.id || op.target.name}`)
    return
  }
  widget.options = widget.options || {}
  const sanitized = sanitizeWidgetPatch(
    String(widget.type || ''),
    { customClass: op.customClass },
    undefined,
    widget.options,
  )
  warnings.push(...sanitized.warnings)
  if (sanitized.patch.customClass === undefined) {
    warnings.push('setCustomClass 未写入：customClass 不可用')
    return
  }
  // 计划值为 string；写出为 string[]，匹配 v-form el-select multiple / .join
  widget.options.customClass = toVFormWidgetCustomClass(sanitized.patch.customClass)
}

function applySetCssCode(formJson: FormJson, root: WidgetNode[], op: Extract<RefineOperation, { op: 'setCssCode' }>, warnings: string[]) {
  const guard = validateCssCode(op.css)
  warnings.push(...guard.warnings)
  if (!guard.ok) {
    warnings.push(guard.message || 'cssCode 未通过护栏，已忽略')
    return
  }
  if (op.target && op.customClass) {
    applySetCustomClass(root, { op: 'setCustomClass', target: op.target, customClass: op.customClass }, warnings)
  } else if (op.customClass) {
    const current = formJson.formConfig?.customClass
    const next = Array.isArray(current) ? [...current] : typeof current === 'string' && current ? [current] : []
    if (!next.includes(op.customClass)) next.push(op.customClass)
    formJson.formConfig = { ...(formJson.formConfig || {}), customClass: next }
  }
  formJson.formConfig = {
    ...(formJson.formConfig || {}),
    cssCode: mergeCssCode(formJson.formConfig?.cssCode, op.css, op.mode),
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
    const parentType = String(parent.type || '')
    if (isHeavyStructureType(parentType) && !ADD_FIELD_PARENT_ALLOWED_HEAVY.has(parentType)) {
      warnings.push(`父容器 ${parentType} 未纳入结构手术能力，字段已追加到根节点`)
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
    panes.push(
      buildWidgetFromCatalogDefaults('tab-pane', {
        id: nextId('tabpane', usedIds),
        name: paneName,
        label: paneSpec.label,
        optionOverrides: { active: panes.length === 0 },
        widgetList: moved,
      }) as WidgetNode,
    )
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
      panes.push(
        buildWidgetFromCatalogDefaults('tab-pane', {
          id: nextId('tabpane', usedIds),
          name: otherName,
          label: '其他',
          widgetList: leftovers,
        }) as WidgetNode,
      )
    }
  }

  const tabName = uniqueName(slugify(op.tabName || 'main_tabs', 'tabs'), usedNames)
  root.push(
    buildWidgetFromCatalogDefaults('tab', {
      id: nextId('tab', usedIds),
      name: tabName,
      tabs: panes,
    }) as WidgetNode,
  )
}

function applyUpdateFieldsInScope(
  formJson: FormJson,
  root: WidgetNode[],
  op: Extract<RefineOperation, { op: 'updateFieldsInScope' }>,
  warnings: string[],
) {
  let scopeFields = resolveScopeFields(formJson, op.parent, op.filterType)
  // 仅改 optionValueType 时跳过无该属性的控件，避免整表 scope 产生未知键警告
  if (!op.filterType && op.patch && 'optionValueType' in (op.patch as object)) {
    scopeFields = scopeFields.filter((f) => f.type && widgetSupportsOptionValueType(f.type))
  }
  if (scopeFields.length === 0) {
    warnings.push(
      `updateFieldsInScope 未找到 scope 内字段: parent=${op.parent.id || op.parent.name || op.parent.label || op.parent.pathPrefix}${op.filterType ? ` type=${op.filterType}` : ''}`,
    )
    return
  }
  for (const field of scopeFields) {
    const target: TargetRef = field.id ? { id: field.id } : field.name ? { name: field.name } : { label: field.label! }
    applyUpdateField(root, { op: 'updateField', target, patch: op.patch }, warnings)
  }
}

function computeSiblingInsertIndex(
  parentList: WidgetNode[],
  fromIndex: number,
  position: ReorderPosition,
  root: WidgetNode[],
): number | null {
  if (position.kind === 'first') return 0
  if (position.kind === 'last') return parentList.length - 1
  const siblingLoc = findWidgetLocation(root as StructureWidgetNode[], position.sibling)
  if (!siblingLoc || siblingLoc.parentList !== parentList) return null
  return position.kind === 'before' ? siblingLoc.index : siblingLoc.index + 1
}

function collectSubtreeIds(widget: WidgetNode, into = new Set<string>()) {
  if (typeof widget.id === 'string' && widget.id) into.add(widget.id)
  for (const list of childCollections(widget)) {
    for (const child of list) collectSubtreeIds(child, into)
  }
  return into
}

function warnDanglingFormulaRefs(root: WidgetNode[], removedIds: Set<string>, warnings: string[]) {
  if (removedIds.size === 0) return
  for (const w of root) {
    const formula = typeof w.options?.formula === 'string' ? w.options.formula : ''
    if (formula) {
      for (const id of removedIds) {
        if (formula.includes(`{{${id}.`) || formula.includes(id)) {
          warnings.push(`公式引用可能悬空：字段 ${w.options?.name || w.id} 仍引用已删除 id ${id}`)
        }
      }
    }
    for (const list of childCollections(w)) {
      warnDanglingFormulaRefs(list, removedIds, warnings)
    }
  }
}

function applyRemoveField(root: WidgetNode[], op: Extract<RefineOperation, { op: 'removeField' }>, warnings: string[]) {
  const loc = findWidgetLocation(root as StructureWidgetNode[], op.target)
  if (!loc) {
    warnings.push(`removeField 未找到目标 ${op.target.id || op.target.name || op.target.label || ''}`)
    return
  }
  const type = String(loc.widget.type || '')
  const blocked = structureOpNonGoalMessage(type)
  if (blocked) {
    warnings.push(blocked)
    return
  }
  const removedIds = collectSubtreeIds(loc.widget)
  loc.parentList.splice(loc.index, 1)
  if (type === 'tab-pane') {
    warnings.push(`已删除 tab-pane 及其内部控件（${loc.widget.id || op.target.label || ''}）`)
  }
  warnDanglingFormulaRefs(root, removedIds, warnings)
}

function applyRemoveFieldsInScope(
  formJson: FormJson,
  root: WidgetNode[],
  op: Extract<RefineOperation, { op: 'removeFieldsInScope' }>,
  warnings: string[],
) {
  const scopeFields = resolveScopeFields(formJson, op.parent, op.filterType)
  if (scopeFields.length === 0) {
    warnings.push(
      `removeFieldsInScope 未找到 scope 内字段: parent=${op.parent.id || op.parent.name || op.parent.label || ''}`,
    )
    return
  }
  let removed = 0
  const removedIds = new Set<string>()
  for (const field of scopeFields) {
    const target: TargetRef = field.id ? { id: field.id } : field.name ? { name: field.name } : { label: field.label! }
    const before = findWidgetLocation(root as StructureWidgetNode[], target)
    if (!before) continue
    const type = String(before.widget.type || '')
    if (structureOpNonGoalMessage(type)) continue
    collectSubtreeIds(before.widget, removedIds)
    if (removeWidgetFromTree(root as StructureWidgetNode[], target)) removed += 1
  }
  if (removed === 0) {
    warnings.push('removeFieldsInScope 未删除任何控件')
  } else {
    warnings.push(`removeFieldsInScope 已删除 ${removed} 个控件`)
    warnDanglingFormulaRefs(root, removedIds, warnings)
  }
}

function applyReorderField(root: WidgetNode[], op: Extract<RefineOperation, { op: 'reorderField' }>, warnings: string[]) {
  const loc = findWidgetLocation(root as StructureWidgetNode[], op.target)
  if (!loc) {
    warnings.push(`reorderField 未找到目标 ${op.target.id || op.target.name || op.target.label || ''}`)
    return
  }
  const type = String(loc.widget.type || '')
  const blocked = structureOpNonGoalMessage(type)
  if (blocked) {
    warnings.push(blocked)
    return
  }
  let toIndex = computeSiblingInsertIndex(loc.parentList, loc.index, op.position, root as StructureWidgetNode[])
  if (toIndex === null) {
    warnings.push('reorderField 目标与 sibling 不在同一层级')
    return
  }
  const fromIndex = loc.index
  if (toIndex > fromIndex) toIndex -= 1
  if (toIndex < 0 || toIndex >= loc.parentList.length) {
    warnings.push('reorderField 目标位置越界')
    return
  }
  const [item] = loc.parentList.splice(fromIndex, 1)
  loc.parentList.splice(toIndex, 0, item)
}

function applyDuplicateField(root: WidgetNode[], op: Extract<RefineOperation, { op: 'duplicateField' }>, warnings: string[]) {
  const loc = findWidgetLocation(root as StructureWidgetNode[], op.target)
  if (!loc) {
    warnings.push(`duplicateField 未找到目标 ${op.target.id || op.target.name || op.target.label || ''}`)
    return
  }
  const type = String(loc.widget.type || '')
  const blocked = structureOpNonGoalMessage(type)
  if (blocked) {
    warnings.push(blocked)
    return
  }
  const clone = cloneWidgetWithNewIdentity(loc.widget as StructureWidgetNode, root as StructureWidgetNode[])
  let insertAt = loc.index + 1
  if (op.position) {
    const resolved = computeSiblingInsertIndex(loc.parentList, loc.index, op.position, root as StructureWidgetNode[])
    if (resolved === null) {
      warnings.push('duplicateField 插入位置与 sibling 不在同一层级')
      return
    }
    insertAt = resolved
    if (insertAt > loc.index) insertAt -= 0 // duplicate inserts copy; source stays
  }
  loc.parentList.splice(Math.min(insertAt, loc.parentList.length), 0, clone as WidgetNode)
  warnings.push(`duplicateField 已复制 ${type} → ${clone.id}`)
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
      case 'updateFieldsInScope':
        applyUpdateFieldsInScope(formJson, root, op, warnings)
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
      case 'patchFormConfig':
        applyPatchFormConfig(formJson, op, warnings)
        break
      case 'setCustomClass':
        applySetCustomClass(root, op, warnings)
        break
      case 'setCssCode':
        applySetCssCode(formJson, root, op, warnings)
        break
      case 'removeField':
        applyRemoveField(root, op, warnings)
        break
      case 'removeFieldsInScope':
        applyRemoveFieldsInScope(formJson, root, op, warnings)
        break
      case 'reorderField':
        applyReorderField(root, op, warnings)
        break
      case 'duplicateField':
        applyDuplicateField(root, op, warnings)
        break
      case 'addTableColumn': {
        const result = applyAddTableColumn(
          root as StructureWidgetNode[],
          op.table,
          op.column as Record<string, unknown>,
          op.position,
        )
        warnings.push(...result.warnings)
        break
      }
      case 'removeTableColumn': {
        const result = applyRemoveTableColumn(root as StructureWidgetNode[], op.table, op.column)
        warnings.push(...result.warnings)
        break
      }
      case 'reorderTableColumn': {
        const result = applyReorderTableColumn(
          root as StructureWidgetNode[],
          op.table,
          op.column,
          op.position,
        )
        warnings.push(...result.warnings)
        break
      }
      case 'updateTableColumn': {
        const result = applyUpdateTableColumn(
          root as StructureWidgetNode[],
          op.table,
          op.column,
          op.patch as Record<string, unknown>,
        )
        warnings.push(...result.warnings)
        break
      }
      default:
        warnings.push(`未知操作已忽略`)
    }
  }

  const healed = normalizeFormJsonWidgetCustomClasses(formJson)
  if (healed > 0) {
    warnings.push(`已将 ${healed} 处控件 customClass 从 string 规范为 string[]（兼容 v-form 运行时）`)
  }

  return { formJson, warnings }
}
