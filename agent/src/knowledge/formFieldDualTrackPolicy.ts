import type { OptionConstraint, OptionValueType, ValueKind, WidgetCatalog } from './widgetCatalog.js'

export type DualTrackSide = {
  valueKind: ValueKind
  valueType: OptionValueType
  nullable: boolean
  inheritEmpty?: boolean
  unit?: string
}

export type FormFieldDualTrackSpec = {
  key: string
  field: DualTrackSide
  form: DualTrackSide
  note: string
}

/** 同键名在 field options vs formConfig 下形态/语义不同 */
export const FORM_FIELD_DUAL_TRACK_REGISTRY: Record<string, FormFieldDualTrackSpec> = {
  customClass: {
    key: 'customClass',
    field: { valueKind: 'string', valueType: 'string', nullable: false },
    form: { valueKind: 'array', valueType: 'array', nullable: false },
    note: '字段 options.customClass 为 string；formConfig.customClass 为 string[]',
  },
  labelWidth: {
    key: 'labelWidth',
    field: { valueKind: 'number', valueType: 'number', nullable: true, inheritEmpty: true, unit: 'px' },
    form: { valueKind: 'number', valueType: 'number', nullable: false, unit: 'px' },
    note: '字段 labelWidth 为 number，null 继承 formConfig.labelWidth；表单为必填 number，渲染时 +px',
  },
  labelAlign: {
    key: 'labelAlign',
    field: { valueKind: 'enum', valueType: 'string', nullable: false, inheritEmpty: true },
    form: { valueKind: 'enum', valueType: 'string', nullable: false, inheritEmpty: false },
    note: '字段 labelAlign="" 继承 formConfig；表单 labelAlign 必须显式 enum（无空串）',
  },
  size: {
    key: 'size',
    field: { valueKind: 'enum', valueType: 'string', nullable: false },
    form: { valueKind: 'enum', valueType: 'string', nullable: false },
    note: '控件/表单 size 共用 ""|large|small；禁止字面量 "default"',
  },
}

export const FORM_FIELD_DUAL_TRACK_KEYS = Object.keys(FORM_FIELD_DUAL_TRACK_REGISTRY)

export type DualTrackMeta = NonNullable<OptionConstraint['dualTrack']>

function dualTrackMetaForSide(
  scope: 'field' | 'form',
  spec: FormFieldDualTrackSpec,
): DualTrackMeta {
  const paired = scope === 'field' ? spec.form : spec.field
  const pairedScope = scope === 'field' ? 'form' : 'field'
  return {
    pairedScope,
    pairedValueKind: paired.valueKind,
    pairedValueType: paired.valueType,
    pairedNullable: paired.nullable,
    ...(paired.inheritEmpty !== undefined ? { pairedInheritEmpty: paired.inheritEmpty } : {}),
    ...(paired.unit ? { pairedUnit: paired.unit } : {}),
    note: spec.note,
  }
}

function sideSpec(scope: 'field' | 'form', spec: FormFieldDualTrackSpec): DualTrackSide {
  return scope === 'field' ? spec.field : spec.form
}

/** 按 scope 校正 inheritEmpty / valueKind，并写入 dualTrack 元数据 */
export function applyFormFieldDualTrack(
  scope: 'field' | 'form',
  key: string,
  constraint: OptionConstraint,
): OptionConstraint {
  const spec = FORM_FIELD_DUAL_TRACK_REGISTRY[key]
  if (!spec) return constraint
  const side = sideSpec(scope, spec)
  const { inheritEmpty: _dropInherit, ...rest } = constraint
  return {
    ...rest,
    valueKind: side.valueKind,
    strict: true,
    ...(side.unit ? { unit: side.unit } : {}),
    ...(side.inheritEmpty ? { inheritEmpty: true } : {}),
    dualTrack: dualTrackMetaForSide(scope, spec),
  }
}

function sideMatches(
  constraint: OptionConstraint,
  side: DualTrackSide,
  scopeLabel: string,
  key: string,
): string[] {
  const issues: string[] = []
  if (constraint.valueType !== side.valueType) {
    issues.push(`${scopeLabel}.${key} valueType expected ${side.valueType} got ${constraint.valueType}`)
  }
  if (constraint.valueKind !== side.valueKind) {
    issues.push(`${scopeLabel}.${key} valueKind expected ${side.valueKind} got ${constraint.valueKind}`)
  }
  if (constraint.nullable !== side.nullable) {
    issues.push(`${scopeLabel}.${key} nullable expected ${side.nullable} got ${constraint.nullable}`)
  }
  if (side.inheritEmpty && !constraint.inheritEmpty) {
    issues.push(`${scopeLabel}.${key} must declare inheritEmpty`)
  }
  if (!side.inheritEmpty && constraint.inheritEmpty) {
    issues.push(`${scopeLabel}.${key} must not declare inheritEmpty on ${scopeLabel}`)
  }
  if (side.unit && constraint.unit !== side.unit) {
    issues.push(`${scopeLabel}.${key} unit expected ${side.unit}`)
  }
  if (!constraint.dualTrack) {
    issues.push(`${scopeLabel}.${key} missing dualTrack metadata`)
    return issues
  }
  const pairedScope = scopeLabel === 'field' ? 'form' : 'field'
  if (constraint.dualTrack.pairedScope !== pairedScope) {
    issues.push(`${scopeLabel}.${key} dualTrack.pairedScope expected ${pairedScope}`)
  }
  if (constraint.dualTrack.note !== FORM_FIELD_DUAL_TRACK_REGISTRY[key]?.note) {
    issues.push(`${scopeLabel}.${key} dualTrack.note mismatch`)
  }
  return issues
}

export function checkFormFieldDualTrackParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const referenceTypes = ['input', 'radio'] as const

  for (const key of FORM_FIELD_DUAL_TRACK_KEYS) {
    const spec = FORM_FIELD_DUAL_TRACK_REGISTRY[key]
    if (!spec) {
      issues.push(`missing dual track spec: ${key}`)
      continue
    }
    if (!catalog.form.constraints[key]) {
      issues.push(`form.constraints missing dual-track key: ${key}`)
    } else {
      issues.push(...sideMatches(catalog.form.constraints[key], spec.form, 'form', key))
    }
    for (const type of referenceTypes) {
      const widget = catalog.widgets.find((w) => w.type === type)
      const constraint = widget?.constraints[key]
      if (!constraint) {
        if (key === 'size' || key === 'labelWidth' || key === 'labelAlign' || key === 'customClass') {
          issues.push(`${type}.${key} missing constraint for dual-track parity`)
        }
        continue
      }
      issues.push(...sideMatches(constraint, spec.field, 'field', key))
    }
  }

  const input = catalog.widgets.find((w) => w.type === 'input')
  const formCustom = catalog.form.constraints.customClass
  const fieldCustom = input?.constraints.customClass
  if (fieldCustom?.dualTrack?.pairedValueKind !== 'array') {
    issues.push('input.customClass dualTrack must point to form array')
  }
  if (formCustom?.dualTrack?.pairedValueKind !== 'string') {
    issues.push('form.customClass dualTrack must point to field string')
  }

  return issues
}
