import type { FormJson, RefineOperation, TargetRef } from '../schemas/refinePlan.js'
import { indexFormFields, type FormFieldSummary } from './formSummary.js'

export type TargetResolveResult = {
  matches: FormFieldSummary[]
  ambiguous: boolean
  reason?: string
}

function filterByContainerType(fields: FormFieldSummary[], containerType?: string): FormFieldSummary[] {
  if (!containerType) return fields
  return fields.filter((f) => f.type === containerType)
}

function matchByPathPrefix(fields: FormFieldSummary[], pathPrefix: string): FormFieldSummary[] {
  const exact = fields.filter((f) => f.path === pathPrefix)
  if (exact.length) return exact
  return fields.filter((f) => f.path.startsWith(`${pathPrefix}.`) || f.path.startsWith(`${pathPrefix}[`))
}

function matchById(fields: FormFieldSummary[], id: string): FormFieldSummary[] {
  return fields.filter((f) => f.id === id)
}

function matchByName(fields: FormFieldSummary[], name: string): FormFieldSummary[] {
  return fields.filter((f) => f.name === name)
}

function matchByLabel(fields: FormFieldSummary[], label: string): FormFieldSummary[] {
  return fields.filter((f) => f.label === label)
}

function resolveFromFields(fields: FormFieldSummary[], target: TargetRef): TargetResolveResult {
  if (target.pathPrefix) {
    const byPath = matchByPathPrefix(fields, target.pathPrefix)
    const scoped = filterByContainerType(byPath, target.containerType)
    if (scoped.length === 1) return { matches: scoped, ambiguous: false }
    if (scoped.length > 1) {
      return { matches: scoped, ambiguous: true, reason: `pathPrefix "${target.pathPrefix}" 命中多个节点` }
    }
    return { matches: [], ambiguous: false, reason: `未找到 pathPrefix: ${target.pathPrefix}` }
  }
  if (target.id) {
    const byId = filterByContainerType(matchById(fields, target.id), target.containerType)
    if (byId.length === 1) return { matches: byId, ambiguous: false }
    if (byId.length > 1) {
      return { matches: byId, ambiguous: true, reason: `id "${target.id}" 命中多个控件` }
    }
  }
  if (target.name) {
    const byName = filterByContainerType(matchByName(fields, target.name), target.containerType)
    if (byName.length === 1) return { matches: byName, ambiguous: false }
    if (byName.length > 1) {
      return { matches: byName, ambiguous: true, reason: `name "${target.name}" 命中多个控件` }
    }
  }
  if (target.label) {
    const byLabel = filterByContainerType(matchByLabel(fields, target.label), target.containerType)
    if (byLabel.length === 1) return { matches: byLabel, ambiguous: false }
    if (byLabel.length > 1) {
      return { matches: byLabel, ambiguous: true, reason: `label "${target.label}" 命中多个控件` }
    }
  }
  return { matches: [], ambiguous: false, reason: '未找到匹配控件' }
}

export function resolveTarget(formJson: FormJson, target: TargetRef): TargetResolveResult {
  const fields = indexFormFields(formJson)
  return resolveFromFields(fields, target)
}

export function validatePlanTargets(
  formJson: FormJson,
  operations: RefineOperation[],
): { ok: boolean; warnings: string[]; rejectMessage?: string } {
  const warnings: string[] = []
  for (const op of operations) {
    const targets: TargetRef[] = []
    if ('target' in op && op.target) targets.push(op.target)
    if ('parent' in op && op.parent) targets.push(op.parent)
    if (op.op === 'wrapInTabs') {
      for (const pane of op.panes) targets.push(...pane.targets)
    }
    for (const target of targets) {
      const result = resolveTarget(formJson, target)
      if (result.ambiguous) {
        return {
          ok: false,
          warnings,
          rejectMessage:
            result.reason ||
            `目标 ${target.id || target.name || target.label || target.pathPrefix} 存在歧义，请提供更明确的 id、name、label 或 parentScope`,
        }
      }
      if (result.matches.length === 0 && (target.id || target.name || target.label || target.pathPrefix)) {
        warnings.push(`规划目标未在表单中找到: ${target.id || target.name || target.label || target.pathPrefix}`)
      }
    }
    if (op.op === 'updateFieldsInScope') {
      const parentResult = resolveTarget(formJson, op.parent)
      if (parentResult.ambiguous) {
        return {
          ok: false,
          warnings,
          rejectMessage: parentResult.reason || 'parent 容器存在歧义',
        }
      }
      if (parentResult.matches.length === 0) {
        return {
          ok: false,
          warnings,
          rejectMessage: `未找到 parent 容器: ${op.parent.id || op.parent.name || op.parent.label || op.parent.pathPrefix}`,
        }
      }
    }
  }
  return { ok: true, warnings }
}

/** 解析 parent 容器 path 前缀，用于 scope 批量（支持 parentScope path: 语法） */
export function resolveScopeFields(
  formJson: FormJson,
  parent: TargetRef,
  filterType?: string,
): FormFieldSummary[] {
  const fields = indexFormFields(formJson)
  if (parent.pathPrefix) {
    const prefix = parent.pathPrefix.endsWith('.') ? parent.pathPrefix : `${parent.pathPrefix}.`
    return fields.filter((f) => {
      if (!f.path.startsWith(prefix)) return false
      if (filterType && f.type !== filterType) return false
      return Boolean(f.id || f.name)
    })
  }
  const parentResult = resolveTarget(formJson, parent)
  if (parentResult.matches.length !== 1) return []
  const parentPath = parentResult.matches[0].path
  const prefix = `${parentPath}.`
  return fields.filter((f) => {
    if (!f.path.startsWith(prefix)) return false
    if (filterType && f.type !== filterType) return false
    return Boolean(f.id || f.name)
  })
}