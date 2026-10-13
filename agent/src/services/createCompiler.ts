/**
 * v0.12 统一创建编译器：Catalog defaults + optionOverrides 消毒 +
 * 复合模板展开 + 确定性子树 id/name + tempRef 同事务解析 + parent/position 插入。
 */
import {
  createNonGoalReason,
  createRejectMessageForType,
  isCreateAllowedType,
} from '../knowledge/createWhitelistPolicy.js'
import {
  EXTENSION_CREATE_TYPES,
  getCompositeTemplate,
  resolveChildSlotKey,
  type TemplateChildSpec,
} from '../knowledge/compositeTemplatePolicy.js'
import {
  assertManagedPreviewIsolation,
  compileManagedNetworkOverrides,
  MANAGED_PRIVILEGED_OPTION_KEYS,
} from '../knowledge/managedNetworkPolicy.js'
import {
  assertExtensionPreviewSafe,
  buildWidgetFromExtensionManifest,
  getExtensionManifest,
  isExtensionManifestCreatable,
  isRuntimeOnlyExtensionType,
  resolveExtensionForCreate,
  sanitizeExtensionOptionOverrides,
} from '../knowledge/extensionManifestPolicy.js'
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
  rows?: CreateWidgetNode[]
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
  /** 受管 mock dataSources，apply 时注入 formConfig（预览隔离） */
  formDataSources: Array<Record<string, unknown>>
}

function isTypeCreatable(type: string, opts?: CompileCreateOptions): boolean {
  if (isCreateAllowedType(type)) return true
  if (isExtensionManifestCreatable(type)) return true
  return Boolean(opts?.extraAllowedTypes?.includes(type))
}

function extensionCreateRejectMessage(type: string): string | null {
  if (EXTENSION_CREATE_TYPES.has(type) || isRuntimeOnlyExtensionType(type) || !isCreateAllowedType(type)) {
    const resolved = resolveExtensionForCreate(type)
    if (!resolved.ok) return resolved.message
  }
  return null
}

export type ApplyCreateBatchResult = {
  ok: boolean
  formJson: FormJson
  tempRefMap: Map<string, TempRefBinding>
  warnings: string[]
  errors: CompileCreateIssue[]
}

function applyPrivilegedManagedPatch(
  node: CreateWidgetNode,
  privilegedPatch: Record<string, unknown>,
): void {
  if (!privilegedPatch || Object.keys(privilegedPatch).length === 0) return
  if (!node.options || typeof node.options !== 'object') node.options = {}
  for (const [key, value] of Object.entries(privilegedPatch)) {
    if (!MANAGED_PRIVILEGED_OPTION_KEYS.has(key)) continue
    node.options[key] = value
  }
}

function mergeManagedDataSources(
  formJson: FormJson,
  sources: Array<Record<string, unknown>>,
): string[] {
  if (!sources.length) return []
  const warnings: string[] = []
  const formConfig = { ...(formJson.formConfig || {}) } as Record<string, unknown>
  const existing = Array.isArray(formConfig.dataSources)
    ? [...(formConfig.dataSources as Record<string, unknown>[])]
    : []
  const byName = new Set(
    existing.map((s) => String((s as { uniqueName?: string }).uniqueName || '')).filter(Boolean),
  )
  for (const src of sources) {
    const name = String(src.uniqueName || '')
    if (!name) continue
    if (byName.has(name)) {
      warnings.push(`managed-datasource already present: ${name}`)
      continue
    }
    existing.push(src)
    byName.add(name)
    warnings.push(`managed-datasource injected: ${name}`)
  }
  formConfig.dataSources = existing
  formJson.formConfig = formConfig
  const isolation = assertManagedPreviewIsolation(formConfig)
  if (isolation.length) {
    warnings.push(...isolation.map((m) => `preview-isolation: ${m}`))
  }
  return warnings
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
    if (Array.isArray(w.rows)) {
      for (const row of w.rows) {
        visit(row)
        if (Array.isArray(row.cols)) {
          for (const cell of row.cols) {
            visit(cell)
            if (Array.isArray(cell.widgetList)) walkWidgets(cell.widgetList, visit)
          }
        }
        if (Array.isArray(row.widgetList)) walkWidgets(row.widgetList, visit)
      }
    }
  }
}

function appendToSlot(parent: CreateWidgetNode, slotKey: string, child: CreateWidgetNode) {
  const existing = parent[slotKey]
  if (Array.isArray(existing)) {
    existing.push(child)
    return
  }
  parent[slotKey] = [child]
}

type TableRowNode = CreateWidgetNode & { cols?: CreateWidgetNode[]; merged?: boolean }

/** 按版本化 minPreset/optionPreset/matrixPreset 展开复合子树 */
function expandCompositePreset(
  rootType: string,
  rootNode: CreateWidgetNode,
  usedNames: Set<string>,
  usedIds: Set<string>,
): { ok: true } | { ok: false; message: string } {
  const tmpl = getCompositeTemplate(rootType)
  if (!tmpl) return { ok: true }

  type BuildChildResult =
    | { ok: true; node: CreateWidgetNode }
    | { ok: false; error: string }

  const buildChild = (spec: TemplateChildSpec, parentType: string): BuildChildResult => {
    void parentType
    if (!getWidgetDefaultSchema(spec.type)) {
      return { ok: false, error: `复合模板子节点 type="${spec.type}" 缺少 Catalog defaults` }
    }
    const baseName = slugify(spec.label || spec.type, spec.type)
    const name = uniqueName(baseName, usedNames)
    const id = nextId(spec.type.replace(/-/g, ''), usedIds)
    const child = buildWidgetFromCatalogDefaults(spec.type, {
      id,
      name,
      label: spec.label,
      optionOverrides: spec.optionOverrides,
    }) as CreateWidgetNode
    if (spec.children?.length) {
      for (const nested of spec.children) {
        const nestedNode = buildChild(nested, spec.type)
        if (!nestedNode.ok) return nestedNode
        const nestedSlot = resolveChildSlotKey(spec.type, nested.type) || nested.slot
        appendToSlot(child, nestedSlot, nestedNode.node)
      }
    }
    return { ok: true, node: child }
  }

  // table 矩阵：rows[] → { cols: table-cell[] }
  if (tmpl.matrixPreset) {
    const { rows, cols } = tmpl.matrixPreset
    const matrix: TableRowNode[] = []
    for (let r = 0; r < rows; r += 1) {
      const rowId = nextId('tablerow', usedIds)
      const row: TableRowNode = { id: rowId, merged: false, cols: [] }
      for (let c = 0; c < cols; c += 1) {
        const cell = buildChild(
          {
            type: 'table-cell',
            slot: 'rows',
            label: `单元格${r + 1}-${c + 1}`,
          },
          rootType,
        )
        if (!cell.ok) return { ok: false, message: cell.error }
        row.cols!.push(cell.node)
      }
      matrix.push(row)
    }
    rootNode.rows = matrix
  }

  for (const preset of tmpl.minPreset) {
    const child = buildChild(preset, rootType)
    if (!child.ok) return { ok: false, message: child.error }
    const slotKey = resolveChildSlotKey(rootType, preset.type) || preset.slot
    appendToSlot(rootNode, slotKey, child.node)
  }

  // requiredChildren 存在性
  const present = new Set<string>()
  walkWidgets([rootNode], (w) => {
    if (w !== rootNode && typeof w.type === 'string') present.add(w.type)
  })
  for (const required of tmpl.requiredChildren) {
    if (!present.has(required)) {
      return { ok: false, message: `复合模板展开后缺少 requiredChild "${required}"` }
    }
  }
  return { ok: true }
}

function getOrCreateChildCollection(
  parent: CreateWidgetNode,
  childType: string,
): { ok: true; list: CreateWidgetNode[]; key: string } | { ok: false; message: string } {
  const parentType = String(parent.type || '')

  // table-cell 挂在 rows[i].cols，而非扁平 rows
  if (parentType === 'table' && childType === 'table-cell') {
    if (!Array.isArray(parent.rows)) parent.rows = []
    const rows = parent.rows as TableRowNode[]
    if (rows.length === 0) {
      const usedRowIds = new Set(rows.map((r) => String(r.id || '')))
      let i = 1
      while (usedRowIds.has(`tablerow${i}`)) i += 1
      rows.push({ id: `tablerow${i}`, merged: false, cols: [] })
    }
    const last = rows[rows.length - 1]
    if (!Array.isArray(last.cols)) last.cols = []
    return { ok: true, list: last.cols, key: 'rows.cols' }
  }

  const slotKey = resolveChildSlotKey(parentType, childType)
  if (!slotKey) {
    return {
      ok: false,
      message: `parent type="${parentType}" 无法接收 child type="${childType}"（无匹配 childSlot）`,
    }
  }
  const existing = parent[slotKey]
  if (!Array.isArray(existing)) {
    parent[slotKey] = []
  }
  return { ok: true, list: parent[slotKey] as CreateWidgetNode[], key: slotKey }
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
  if (isRuntimeOnlyExtensionType(type) || EXTENSION_CREATE_TYPES.has(type)) {
    const manifest = getExtensionManifest(type)
    const allowed = manifest?.allowedParents || ['root']
    if (!allowed.includes(parentType)) {
      return `type "${type}" 不允许 parent=${parentType}（allowedParents=${allowed.join(',')})`
    }
    return null
  }
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
  const formDataSources: Array<Record<string, unknown>> = []
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
    const runtimeOnly = isRuntimeOnlyExtensionType(spec.type)
    const entry = catalog.widgets.find((w) => w.type === spec.type)
    if (!entry && !runtimeOnly) {
      const extMsg = extensionCreateRejectMessage(spec.type)
      errors.push({
        path: `${path}.type`,
        message: extMsg || `未知 type "${spec.type}"（不在 Catalog）`,
      })
      return
    }
    if (!isTypeCreatable(spec.type, opts)) {
      const extMsg = extensionCreateRejectMessage(spec.type)
      const reason = createNonGoalReason(spec.type)
      errors.push({
        path: `${path}.type`,
        message:
          extMsg ||
          (reason
            ? createRejectMessageForType(spec.type)
            : `type "${spec.type}" 不在 refine create whitelist`),
      })
      return
    }
    // 静态 adjacent / runtime-only：须 manifest 通过
    if (EXTENSION_CREATE_TYPES.has(spec.type) || runtimeOnly) {
      const resolved = resolveExtensionForCreate(spec.type)
      if (!resolved.ok) {
        errors.push({ path: `${path}.type`, message: resolved.message })
        return
      }
      const previewIssues = assertExtensionPreviewSafe(spec.type)
      if (previewIssues.length) {
        errors.push({ path: `${path}.type`, message: previewIssues.join('; ') })
        return
      }
    }
    if (!runtimeOnly && !getWidgetDefaultSchema(spec.type, catalog)) {
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

    // 显式 name 保持原样（仅截断/去重），避免 slugify 改变 handler 引用
    const baseName = spec.name?.trim()
      ? spec.name.trim().slice(0, 64)
      : slugify(spec.label || spec.tempRef || spec.type, spec.type)
    const name = uniqueName(baseName, usedNames)
    const id = nextId(spec.type.replace(/-/g, ''), usedIds)

    let node: CreateWidgetNode

    if (runtimeOnly) {
      const extSanitized = sanitizeExtensionOptionOverrides(spec.type, spec.optionOverrides)
      if (!extSanitized.ok) {
        for (const message of extSanitized.errors) {
          errors.push({ path: `${path}.optionOverrides`, message })
        }
        return
      }
      const built = buildWidgetFromExtensionManifest(spec.type, {
        id,
        name,
        label: spec.label,
        optionOverrides: extSanitized.patch,
      })
      if (!built.ok) {
        errors.push({ path: `${path}.type`, message: built.message })
        return
      }
      node = built.node as CreateWidgetNode
      warnings.push(`extension:${spec.type}:Runtime-ready`)
    } else {
      // 受管上传/远程引用：先编译再 sanitize（managed*Ref 不入 Catalog）
      const managed = compileManagedNetworkOverrides(spec.type, spec.optionOverrides)
      if (!managed.ok) {
        for (const issue of managed.errors) {
          errors.push({ path: `${path}.${issue.path}`, message: issue.message })
        }
        return
      }
      warnings.push(...managed.warnings)
      formDataSources.push(...managed.formDataSources)

      const rawOverrides = mergeCreateLabelOverrides(spec.type, spec.label, managed.publicOverrides)
      const sanitized = sanitizeCreateOptionOverrides(spec.type, rawOverrides)
      if (!sanitized.ok) {
        for (const message of sanitized.errors) {
          errors.push({ path: `${path}.optionOverrides`, message })
        }
        return
      }
      warnings.push(...sanitized.warnings)

      // Catalog defaults → 模板 optionPreset → 用户消毒 patch
      const tmpl = getCompositeTemplate(spec.type)
      const optionOverrides: Record<string, unknown> = {
        ...(tmpl?.optionPreset ? structuredClone(tmpl.optionPreset) : {}),
        ...sanitized.patch,
      }
      const labelForNode =
        typeof optionOverrides.label === 'string' ? optionOverrides.label : undefined

      node = buildWidgetFromCatalogDefaults(spec.type, {
        id,
        name,
        label: labelForNode,
        optionOverrides,
      }) as CreateWidgetNode
      applyPrivilegedManagedPatch(node, managed.privilegedPatch)

      const expanded = expandCompositePreset(spec.type, node, usedNames, usedIds)
      if (!expanded.ok) {
        errors.push({ path: `${path}.type`, message: expanded.message })
        return
      }
    }

    // 子树内身份冲突：与表单其余节点 + 本批已编译节点不得重复
    const subtreeIds = new Set<string>()
    const subtreeNames = new Set<string>()
    let identityConflict: string | null = null
    walkWidgets([node], (w) => {
      if (identityConflict) return
      if (typeof w.id === 'string' && w.id) {
        if (subtreeIds.has(w.id)) identityConflict = `子树内重复 id "${w.id}"`
        subtreeIds.add(w.id)
      }
      const childName = w.options?.name
      if (typeof childName === 'string' && childName) {
        if (subtreeNames.has(childName)) identityConflict = `子树内重复 name "${childName}"`
        subtreeNames.add(childName)
      }
    })
    if (identityConflict) {
      errors.push({ path, message: identityConflict })
      return
    }

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
    formDataSources,
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
      const collection = getOrCreateChildCollection(host, item.type)
      if (!collection.ok) {
        errors.push({ path: `specs[${item.specIndex}].parent`, message: collection.message })
        continue
      }
      list = collection.list
    } else {
      const host = findWidgetByTarget(root, parent as TargetRef) as CreateWidgetNode | null
      if (!host) {
        errors.push({
          path: `specs[${item.specIndex}].parent`,
          message: `parent 未找到`,
        })
        continue
      }
      const collection = getOrCreateChildCollection(host, item.type)
      if (!collection.ok) {
        errors.push({ path: `specs[${item.specIndex}].parent`, message: collection.message })
        continue
      }
      list = collection.list
    }

    const inserted = insertIntoList(list, item.node, item.position, compiled.tempRefMap, root)
    if (!inserted.ok) {
      errors.push({
        path: `specs[${item.specIndex}].position`,
        message: inserted.message || '插入失败',
      })
    }
  }

  if (errors.length === 0 && compiled.formDataSources.length) {
    const injected = mergeManagedDataSources(formJson, compiled.formDataSources)
    const isolationFails = injected.filter((w) => w.startsWith('preview-isolation:'))
    warnings.push(...injected.filter((w) => !w.startsWith('preview-isolation:')))
    for (const msg of isolationFails) {
      errors.push({ path: 'formConfig.dataSources', message: msg })
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
  if (type === 'vf-dialog' || type === 'vf-drawer') {
    if (next.title == null) next.title = label
    return next
  }
  if (next.label == null) {
    const catalog = getWidgetCatalog()
    const entry = catalog.widgets.find((w) => w.type === type)
    // grid/table 等容器无 label 可写键时跳过，避免消毒失败
    if (!entry || entry.writableKeys.includes('label')) {
      next.label = label
    }
  }
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
