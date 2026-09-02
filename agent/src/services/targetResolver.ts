import type { FormJson, RefineOperation, TargetRef } from '../schemas/refinePlan.js'
import { indexFormFields, type FormFieldSummary } from './formSummary.js'

export type TargetResolveResult = {
  matches: FormFieldSummary[]
  ambiguous: boolean
  reason?: string
}

function matchById(fields: FormFieldSummary[], id: string): FormFieldSummary[] {
  return fields.filter((f) => f.id === id)
}

function matchByName(fields: FormFieldSummary[], name: string): FormFieldSummary[] {
  return fields.filter((f) => f.name === name)
}

function matchByPath(fields: FormFieldSummary[], path: string): FormFieldSummary[] {
  return fields.filter((f) => f.path === path)
}

function matchByLabel(fields: FormFieldSummary[], label: string): FormFieldSummary[] {
  return fields.filter((f) => f.label === label)
}

export function resolveTarget(formJson: FormJson, target: TargetRef): TargetResolveResult {
  const fields = indexFormFields(formJson)
  if (target.id) {
    const byId = matchById(fields, target.id)
    if (byId.length === 1) return { matches: byId, ambiguous: false }
    if (byId.length > 1) {
      return { matches: byId, ambiguous: true, reason: `id "${target.id}" 命中多个控件` }
    }
  }
  if (target.name) {
    const byName = matchByName(fields, target.name)
    if (byName.length === 1) return { matches: byName, ambiguous: false }
    if (byName.length > 1) {
      return { matches: byName, ambiguous: true, reason: `name "${target.name}" 命中多个控件` }
    }
    // id/name 同字符串时的 coerce 路径：若 id 未命中而 name 也未唯一命中，不再随机 fallback
  }
  return { matches: [], ambiguous: false, reason: '未找到匹配控件' }
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
            `目标 ${target.id || target.name} 存在歧义，请提供更明确的 id、name 或路径描述`,
        }
      }
      if (result.matches.length === 0 && (target.id || target.name)) {
        warnings.push(`规划目标未在表单中找到: ${target.id || target.name}`)
      }
    }
  }
  return { ok: true, warnings }
}
