/**
 * v0.11 统一创建编译器：Catalog defaults + optionOverrides 消毒 +
 * 确定性 id/name + tempRef 同事务解析 + parent/position 插入。
 */
import {
  createNonGoalReason,
  createRejectMessageForType,
  isCreateAllowedType,
} from '../knowledge/createWhitelistPolicy.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import { buildWidgetFromCatalogDefaults, getWidgetDefaultSchema } from '../knowledge/widgetDefaults.js'
import { valueMatchesConstraint } from '../knowledge/widgetCatalog.js'
import { isEventKey } from '../knowledge/catalogPolicy.js'
import {
  normalizeCreateParent,
  type CreateParentRef,
  type CreatePosition,
  type CreateWidgetSpec,
} from '../schemas/createWidget.js'
import type { FormJson, TargetRef } from '../schemas/refinePlan.js'
import { findWidgetByTarget } from './containerRefine.js'

export type CreateWidgetNode = Record<string, unknown> & {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: CreateWidgetNode[]
  tabs?: CreateWidgetNode[]
  cols?: CreateWidgetNode[]
}

export type TempRefBinding = {
  tempRef: string
  id: string
  name: string
  type: string
}

export type CompileCreateIssue = {
  path: string
  message: string
}

export type CompiledCreateWidget = {
  specIndex: number
  tempRef?: string
  id: string
  name: string
  type: string
  node: CreateWidgetNode
  parent: CreateParentRef
  position: CreatePosition
}

export type CompileCreateOptions = {
  /** 额外允许的 type（interaction addButton 兼容 button，待 §3 正式开放） */
  extraAllowedTypes?: readonly string[]
}

export type CompileCreateBatchResult = {
  ok: boolean
  widgets: CompiledCreateWidget[]
  tempRefMap: Map<string, TempRefBinding>
  errors: CompileCreateIssue[]
  warnings: string[]
}

function isTypeCreatable(type: string, opts?: CompileCreateOptions): boolean {
  if (isCreateAllowedType(type)) return true
  return Boolean(opts?.extraAllowedTypes?.includes(type))
}

export type ApplyCreateBatchResult = {
  ok: boolean
  formJson: FormJson
  tempRefMap: Map<string, TempRefBinding>
  warnings: string[]
  errors: CompileCreateIssue[]
}

function slugify(input: string, fallback: string) {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (raw || fallback).slice(0, 40)
}

function walkWidgets(list: CreateWidgetNode[] | undefined, visit: (w: CreateWidgetNode) => void) {
  if (!Array.isArray(list)) return
  for (const w of list) {
    visit(w)
    if (Array.isArray(w.widgetList)) walkWidgets(w.widgetList, visit)
    if (Array.isArray(w.tabs)) walkWidgets(w.tabs, visit)
    if (Array.isArray(w.cols)) {
      for (const col of w.cols) {
        visit(col)
        if (Array.isArray(col.widgetList)) walkWidgets(col.widgetList, visit)
      }
    }
  }
}

export function collectIdentitySets(root: CreateWidgetNode[]): { names: Set<string>; ids: Set<string> } {
  const names = new Set<string>()
  const ids = new Set<string>()
  walkWidgets(root, (w) => {
    if (typeof w.id === 'string' && w.id) ids.add(w.id)
    const name = w.options?.name
    if (typeof name === 'string' && name) names.add(name)
  })
  return { names, ids }
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base.slice(0, 64) || 'field'
  let i = 1
  while (used.has(name)) {
    const suffix = `_${i++}`
    name = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`
  }
  used.add(name)
  return name
}

function nextId(prefix: string, used: Set<string>): string {
  const clean = prefix.replace(/-/g, '') || 'w'
  let i = 1
  let id = `${clean}${i}`
  while (used.has(id)) {
    i += 1
    id = `${clean}${i}`
  }
  used.add(id)
  return id
}

/** 严格消毒 optionOverrides：非法键/类型直接错误，不静默忽略 */
export function sanitizeCreateOptionOverrides(
  type: string,
  overrides: Record<string, unknown> | undefined,
): { ok: boolean; patch: Record<string, unknown>; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (!overrides || Object.keys(overrides).length === 0) {
    return { ok: true, patch: {}, errors, warnings }
  }
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === type)
  if (!entry) {
    return { ok: false, patch: {}, errors: [`未知 type "${type}"，无法消毒 optionOverrides`], warnings }
  }
  const defaults = getWidgetDefaultSchema(type, catalog)?.defaultOptions || {}
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'name') {
      // name 由编译器确定性分配；overrides.name 仅作提示，最终仍走 identity 通道
      continue
    }
    if (isEventKey(key)) {
      errors.push(`optionOverrides 禁止写入事件键: ${key}`)
      continue
    }
    if (entry.forbiddenKeys.includes(key)) {
      errors.push(`optionOverrides 禁写键: ${key}`)
      continue
    }
    if (!entry.writableKeys.includes(key)) {
      errors.push(`optionOverrides 未知/不可写键: ${key}`)
      continue
    }
    if (entry.applicableKeys && !entry.applicableKeys.includes(key)) {
      errors.push(`optionOverrides 属性 ${key} 对 type=${type} 不可用`)
      continue
    }
    const constraint = entry.constraints[key]
    if (constraint && !valueMatchesConstraint(constraint, value)) {
      errors.push(`optionOverrides 属性 ${key} 不满足 Catalog 约束`)
      continue
    }
    // linkage：相对 defaults+已接受 patch 做最小校验
    const blockedWhen = constraint?.linkageBlockedWhen
    if (blockedWhen) {
      const effective = { ...defaults, ...patch, [key]: value }
      const current = effective[blockedWhen.key]
      const blocked =
        blockedWhen.truthy === true
          ? Boolean(current)
          : blockedWhen.truthy === false
            ? !current
            : 'equals' in blockedWhen
              ? current === blockedWhen.equals
              : false
      if (blocked) {
        errors.push(`optionOverrides 属性 ${key} 被 linkage 阻止（${blockedWhen.key}）`)
        continue
      }
    }
    patch[key] = value
  }
  return { ok: errors.length === 0, patch, errors, warnings }
}

function parentKindLabel(parent: CreateParentRef): string {
  if (parent.kind === 'root') return 'root'
  if (parent.kind === 'tempRef') return `tempRef:${parent.tempRef}`
  return parent.containerType || parent.name || parent.id || parent.label || 'existing'
}

function resolveAllowedParentType(
  parent: CreateParentRef,
  tempRefMap: Map<string, TempRefBinding>,
  root: CreateWidgetNode[],
): { ok: true; parentType: string; node?: CreateWidgetNode } | { ok: false; message: string } {
  if (parent.kind === 'root') return { ok: true, parentType: 'root' }
  if (parent.kind === 'tempRef') {
    const binding = tempRefMap.get(parent.tempRef)
    if (!binding) return { ok: false, message: `parent tempRef "${parent.tempRef}" 未定义或尚未创建` }
    // 同批节点：从已编译 widgets 无法直接拿 node 容器指针；插入阶段再找
    return { ok: true, parentType: binding.type }
  }
  const target: TargetRef = {
    id: parent.id,
    name: parent.name,
    label: parent.label,
    containerType: parent.containerType,
    pathPrefix: parent.pathPrefix,
  }
  const node = findWidgetByTarget(root, target) as CreateWidgetNode | null
  if (!node) {
    return {
      ok: false,
      message: `parent 未找到: ${parent.id || parent.name || parent.label || parent.pathPrefix}`,
    }
  }
  return { ok: true, parentType: String(node.type || ''), node }
}

function assertParentAllowed(type: string, parentType: string): string | null {
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === type)
  const allowed = entry?.create?.allowedParents || ['root']
  if (!allowed.includes(parentType)) {
    return `type "${type}" 不允许 parent=${parentType}（allowedParents=${allowed.join(',')})`
  }
  return null
}

function findInTreeByTempOrTarget(
  root: CreateWidgetNode[],
  ref: { tempRef?: string } | TargetRef,
  tempRefMap: Map<string, TempRefBinding>,
): CreateWidgetNode | null {
  if (ref && typeof ref === 'object' && 'tempRef' in ref && ref.tempRef) {
    const binding = tempRefMap.get(ref.tempRef)
    if (!binding) return null
    let found: CreateWidgetNode | null = null
    walkWidgets(root, (w) => {
      if (found) return
      if (w.id === binding.id || w.options?.name === binding.name) found = w
    })
    return found
  }
  return findWidgetByTarget(root, ref as TargetRef) as CreateWidgetNode | null
}

function insertIntoList(
  list: CreateWidgetNode[],
  node: CreateWidgetNode,
  position: CreatePosition,
  tempRefMap: Map<string, TempRefBinding>,
  root: CreateWidgetNode[],
): { ok: boolean; message?: string } {
  if (position.kind === 'last' || !position) {
    list.push(node)
    return { ok: true }
  }
  if (position.kind === 'first') {
    list.unshift(node)
    return { ok: true }
  }
  const sibling = findInTreeByTempOrTarget(root, position.sibling as never, tempRefMap)
  if (!sibling) return { ok: false, message: `position sibling 未找到` }
  // sibling 必须在同一 list
  const idx = list.indexOf(sibling)
  if (idx < 0) return { ok: false, message: `position sibling 不在目标 parent 的 widgetList 中` }
  if (position.kind === 'before') list.splice(idx, 0, node)
  else list.splice(idx + 1, 0, node)
  return { ok: true }
}

function getOrCreateWidgetList(parent: CreateWidgetNode): CreateWidgetNode[] {
  if (!Array.isArray(parent.widgetList)) parent.widgetList = []
  return parent.widgetList
}

/**
 * 编译一批 create 规格：分配确定性 id/name、消毒 overrides、校验 type/parent。
 * 不修改 formJson；applyCreateBatch 负责插入。
 */
export function compileCreateBatch(
  specs: CreateWidgetSpec[],
  currentFormJson: FormJson,
  opts?: CompileCreateOptions,
): CompileCreateBatchResult {
  const errors: CompileCreateIssue[] = []
  const warnings: string[] = []
  const root = (currentFormJson.widgetList || []) as CreateWidgetNode[]
  const { names: usedNames, ids: usedIds } = collectIdentitySets(root)
  const tempRefMap = new Map<string, TempRefBinding>()
  const widgets: CompiledCreateWidget[] = []
  const catalog = getWidgetCatalog()

  // 预登记 tempRef，检测重复
  specs.forEach((spec, index) => {
    if (!spec.tempRef) return
    if (tempRefMap.has(spec.tempRef)) {
      errors.push({ path: `specs[${index}].tempRef`, message: `重复 tempRef "${spec.tempRef}"` })
      return
    }
    // 占位，稍后填 id/name
    tempRefMap.set(spec.tempRef, { tempRef: spec.tempRef, id: '', name: '', type: spec.type })
  })

  specs.forEach((spec, index) => {
    const path = `specs[${index}]`
    const entry = catalog.widgets.find((w) => w.type === spec.type)
    if (!entry) {
      errors.push({ path: `${path}.type`, message: `未知 type "${spec.type}"（不在 Catalog）` })
      return
    }
    if (!isTypeCreatable(spec.type, opts)) {
      const reason = createNonGoalReason(spec.type)
      errors.push({
        path: `${path}.type`,
        message: reason
          ? createRejectMessageForType(spec.type)
          : `type "${spec.type}" 不在 refine create whitelist`,
      })
      return
    }
    if (!getWidgetDefaultSchema(spec.type, catalog)) {
      errors.push({ path: `${path}.type`, message: `Catalog 缺少 type="${spec.type}" 的 defaults` })
      return
    }

    let parent: CreateParentRef
    try {
      parent = normalizeCreateParent(spec.parent)
    } catch (err) {
      errors.push({
        path: `${path}.parent`,
        message: err instanceof Error ? err.message : 'parent 无效',
      })
      return
    }
    const parentResolved = resolveAllowedParentType(parent, tempRefMap, root)
    if (!parentResolved.ok) {
      errors.push({ path: `${path}.parent`, message: parentResolved.message })
      return
    }
    // tempRef parent 必须指向本批更早的 spec
    if (parent.kind === 'tempRef') {
      const earlier = widgets.find((w) => w.tempRef === parent.tempRef)
      if (!earlier) {
        errors.push({
          path: `${path}.parent`,
          message: `parent tempRef "${parent.tempRef}" 必须先于当前节点创建`,
        })
        return
      }
    }
    const parentErr = assertParentAllowed(spec.type, parentResolved.parentType)
    if (parentErr) {
      errors.push({ path: `${path}.parent`, message: parentErr })
      return
    }

    const rawOverrides = mergeCreateLabelOverrides(spec.type, spec.label, spec.optionOverrides)
    const sanitized = sanitizeCreateOptionOverrides(spec.type, rawOverrides)
    if (!sanitized.ok) {
      for (const message of sanitized.errors) {
        errors.push({ path: `${path}.optionOverrides`, message })
      }
      return
    }
    warnings.push(...sanitized.warnings)

    // 显式 name 保持原样（仅截断/去重），避免 slugify 改变 handler 引用
    const baseName = spec.name?.trim()
      ? spec.name.trim().slice(0, 64)
      : slugify(spec.label || spec.tempRef || spec.type, spec.type)
    const name = uniqueName(baseName, usedNames)
    const id = nextId(spec.type.replace(/-/g, ''), usedIds)
    const optionOverrides: Record<string, unknown> = { ...sanitized.patch }
    const labelForNode =
      typeof optionOverrides.label === 'string' ? optionOverrides.label : undefined

    const node = buildWidgetFromCatalogDefaults(spec.type, {
      id,
      name,
      label: labelForNode,
      optionOverrides,
    }) as CreateWidgetNode

    if (spec.tempRef) {
      tempRefMap.set(spec.tempRef, { tempRef: spec.tempRef, id, name, type: spec.type })
    }

    widgets.push({
      specIndex: index,
      tempRef: spec.tempRef,
      id,
      name,
      type: spec.type,
      node,
      parent,
      position: spec.position || { kind: 'last' },
    })
    warnings.push(`createWidget:${name}@${parentKindLabel(parent)}`)
  })

  return {
    ok: errors.length === 0,
    widgets,
    tempRefMap,
    errors,
    warnings,
  }
}

/** 将已编译节点插入 formJson（失败不部分提交：调用方应传入 clone） */
export function applyCompiledCreates(
  formJson: FormJson,
  compiled: CompileCreateBatchResult,
): ApplyCreateBatchResult {
  const errors: CompileCreateIssue[] = [...compiled.errors]
  const warnings = [...compiled.warnings]
  if (!compiled.ok) {
    return {
      ok: false,
      formJson,
      tempRefMap: compiled.tempRefMap,
      warnings,
      errors,
    }
  }

  const root = (formJson.widgetList || []) as CreateWidgetNode[]
  formJson.widgetList = root

  for (const item of compiled.widgets) {
    const parent = item.parent
    let list: CreateWidgetNode[] | null = null

    if (parent.kind === 'root') {
      list = root
    } else if (parent.kind === 'tempRef') {
      const host = findInTreeByTempOrTarget(root, { tempRef: parent.tempRef }, compiled.tempRefMap)
      if (!host) {
        errors.push({
          path: `specs[${item.specIndex}].parent`,
          message: `parent tempRef "${parent.tempRef}" 节点未找到`,
        })
        continue
      }
      list = getOrCreateWidgetList(host)
    } else {
      const host = findWidgetByTarget(root, parent as TargetRef) as CreateWidgetNode | null
      if (!host) {
        errors.push({
          path: `specs[${item.specIndex}].parent`,
          message: `parent 未找到`,
        })
        continue
      }
      list = getOrCreateWidgetList(host)
    }

    const inserted = insertIntoList(list, item.node, item.position, compiled.tempRefMap, root)
    if (!inserted.ok) {
      errors.push({
        path: `specs[${item.specIndex}].position`,
        message: inserted.message || '插入失败',
      })
    }
  }

  return {
    ok: errors.length === 0,
    formJson,
    tempRefMap: compiled.tempRefMap,
    warnings,
    errors,
  }
}

/** 编译并应用到 clone 后的 formJson；任一步失败则 ok=false（调用方可丢弃 clone） */
export function applyCreateBatch(
  currentFormJson: FormJson,
  specs: CreateWidgetSpec[],
  opts?: CompileCreateOptions,
): ApplyCreateBatchResult {
  const formJson = structuredClone(currentFormJson)
  const compiled = compileCreateBatch(specs, formJson, opts)
  if (!compiled.ok) {
    return {
      ok: false,
      formJson: currentFormJson,
      tempRefMap: compiled.tempRefMap,
      warnings: compiled.warnings,
      errors: compiled.errors,
    }
  }
  const applied = applyCompiledCreates(formJson, compiled)
  if (!applied.ok) {
    return {
      ok: false,
      formJson: currentFormJson,
      tempRefMap: applied.tempRefMap,
      warnings: applied.warnings,
      errors: applied.errors,
    }
  }
  return applied
}

/** 就地应用（调用方已 clone）；失败时 errors 非空，formJson 可能被部分修改——调用方应丢弃 */
export function applyCreateBatchInPlace(
  formJson: FormJson,
  specs: CreateWidgetSpec[],
  opts?: CompileCreateOptions,
): ApplyCreateBatchResult {
  const compiled = compileCreateBatch(specs, formJson, opts)
  return applyCompiledCreates(formJson, compiled)
}

/** 将 label/textContent 映射到类型可写键（html-text→htmlContent，static-text→textContent） */
export function mergeCreateLabelOverrides(
  type: string,
  label: string | undefined,
  optionOverrides?: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(optionOverrides || {}) }
  if (label === undefined) return next
  if (type === 'html-text') {
    if (next.htmlContent == null) next.htmlContent = label
    return next
  }
  if (type === 'static-text') {
    if (next.textContent == null) next.textContent = label
    return next
  }
  if (next.label == null) next.label = label
  return next
}

/** 按 Catalog 可写键构造普通字段 overrides（generate/addField 共用） */
export function buildOrdinaryFieldOverrides(field: {
  label: string
  type: string
  required?: boolean
  options?: Array<{ label: string; value: string | number }>
  textContent?: string
  formula?: string
  formulaEnabled?: boolean
}): Record<string, unknown> {
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === field.type)
  const writable = new Set(entry?.writableKeys || [])
  const overrides: Record<string, unknown> = {}

  if (writable.has('required') && field.required !== undefined) {
    overrides.required = Boolean(field.required)
  }
  if (
    (field.type === 'radio' ||
      field.type === 'select' ||
      field.type === 'checkbox' ||
      field.type === 'cascader') &&
    field.options &&
    writable.has('optionItems')
  ) {
    overrides.optionItems = field.options.map((o) => ({ label: o.label, value: o.value }))
  }
  if (field.type === 'static-text' && writable.has('textContent')) {
    overrides.textContent = field.textContent || field.label
  }
  if (field.type === 'html-text' && writable.has('htmlContent')) {
    overrides.htmlContent = field.textContent || field.label
  }
  if (field.type === 'number' && (field.formula || field.formulaEnabled)) {
    if (writable.has('formulaEnabled')) overrides.formulaEnabled = field.formulaEnabled !== false
    if (writable.has('formula')) overrides.formula = field.formula || ''
  }
  return mergeCreateLabelOverrides(field.type, field.label, overrides)
}

/** addField → createWidgetSpec */
export function createSpecFromAddField(op: {
  field: {
    key: string
    label: string
    type: string
    required?: boolean
    options?: Array<{ label: string; value: string | number }>
    textContent?: string
    formula?: string
    formulaEnabled?: boolean
  }
  parent?: TargetRef
}): CreateWidgetSpec {
  return {
    type: op.field.type,
    name: op.field.key,
    label: op.field.label,
    parent: op.parent
      ? { kind: 'existing', ...op.parent }
      : { kind: 'root' },
    optionOverrides: buildOrdinaryFieldOverrides(op.field),
  }
}

/** addButton → createWidgetSpec（兼容） */
export function createSpecFromAddButton(op: {
  label: string
  name?: string
  parent?: TargetRef
  optionOverrides?: Record<string, unknown>
}): CreateWidgetSpec {
  return {
    type: 'button',
    name: op.name,
    label: op.label,
    parent: op.parent ? { kind: 'existing', ...op.parent } : { kind: 'root' },
    optionOverrides: {
      ...(op.optionOverrides || {}),
      label: op.label,
    },
  }
}
