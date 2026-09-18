import type { CompositeSchema, OptionConstraint, ValueKind, WidgetCatalog } from './widgetCatalog.js'

export type CompositeItemField = {
  valueKind: ValueKind
  required?: boolean
}

/** validation-editor.vue fieldValidators */
export const VALIDATION_PRESETS = [
  'number',
  'letter',
  'letterAndNumber',
  'mobilePhone',
  'email',
  'url',
  'noChinese',
  'chinese',
] as const

/** 全局 prop → compositeSchema（按 widgetsConfig + property-editor 真源） */
export const COMPOSITE_SCHEMA_BY_PROP: Record<string, CompositeSchema> = {
  optionItems: {
    id: 'option-item',
    requiredItemKeys: ['label', 'value'],
    itemFields: {
      label: { valueKind: 'string', required: true },
      value: { valueKind: 'string', required: true },
    },
    nestedKey: 'children',
    minItems: 1,
  },
  validation: {
    id: 'validation-preset',
    presets: [...VALIDATION_PRESETS],
  },
  treeData: {
    id: 'tree-node',
    requiredItemKeys: ['label'],
    itemFields: {
      label: { valueKind: 'string', required: true },
    },
    nestedKey: 'children',
  },
  tableColumns: {
    id: 'data-table-column',
    requiredItemKeys: ['columnId', 'prop', 'label'],
    itemFields: {
      columnId: { valueKind: 'number', required: true },
      prop: { valueKind: 'string', required: true },
      label: { valueKind: 'string', required: true },
      width: { valueKind: 'cssText' },
      show: { valueKind: 'boolean' },
      align: { valueKind: 'string' },
      fixed: { valueKind: 'string' },
      sortable: { valueKind: 'boolean' },
      headerFlag: { valueKind: 'boolean' },
    },
    nestedKey: 'children',
  },
  operationButtons: {
    id: 'data-table-operation-button',
    requiredItemKeys: ['name', 'label'],
    itemFields: {
      name: { valueKind: 'string', required: true },
      label: { valueKind: 'string', required: true },
      type: { valueKind: 'string' },
      size: { valueKind: 'string' },
      round: { valueKind: 'boolean' },
      hidden: { valueKind: 'boolean' },
      disabled: { valueKind: 'boolean' },
    },
  },
  buttons: {
    id: 'button-group-item',
    requiredItemKeys: ['name', 'label'],
    itemFields: {
      name: { valueKind: 'string', required: true },
      label: { valueKind: 'string', required: true },
      icon: { valueKind: 'string' },
      type: { valueKind: 'string' },
      round: { valueKind: 'boolean' },
      hidden: { valueKind: 'boolean' },
      disabled: { valueKind: 'boolean' },
    },
  },
  pagination: {
    id: 'data-table-pagination',
    requiredItemKeys: ['currentPage', 'pageSize', 'pageSizes', 'total'],
    itemFields: {
      currentPage: { valueKind: 'number', required: true },
      pageSize: { valueKind: 'number', required: true },
      pageSizes: { valueKind: 'array', required: true },
      total: { valueKind: 'number', required: true },
    },
  },
}

/** widget type 必须登记 compositeSchema 的 (type, prop) */
export const COMPOSITE_SCHEMA_REQUIRED: Array<{ type: string; prop: string }> = [
  { type: 'radio', prop: 'optionItems' },
  { type: 'checkbox', prop: 'optionItems' },
  { type: 'select', prop: 'optionItems' },
  { type: 'cascader', prop: 'optionItems' },
  { type: 'input', prop: 'validation' },
  { type: 'textarea', prop: 'validation' },
  { type: 'tree', prop: 'treeData' },
  { type: 'data-table', prop: 'tableColumns' },
  { type: 'data-table', prop: 'operationButtons' },
  { type: 'data-table', prop: 'pagination' },
  { type: 'button-group', prop: 'buttons' },
]

export function compositeSchemaForProp(prop: string): CompositeSchema | undefined {
  return COMPOSITE_SCHEMA_BY_PROP[prop]
}

export function applyCompositeSchemaToConstraint(
  prop: string,
  constraint: OptionConstraint,
): OptionConstraint {
  const schema = compositeSchemaForProp(prop)
  if (!schema) return constraint
  return { ...constraint, compositeSchema: schema }
}

export function checkCompositeSchemaParity(catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const byType = new Map(catalog.widgets.map((w) => [w.type, w]))

  for (const [prop, schema] of Object.entries(COMPOSITE_SCHEMA_BY_PROP)) {
    if (!schema.id) issues.push(`composite schema missing id for prop: ${prop}`)
    if (schema.requiredItemKeys?.length && !schema.itemFields) {
      issues.push(`composite ${prop} has requiredItemKeys but no itemFields`)
    }
  }

  for (const { type, prop } of COMPOSITE_SCHEMA_REQUIRED) {
    const entry = byType.get(type)
    if (!entry) {
      issues.push(`composite required type missing from catalog: ${type}`)
      continue
    }
    if (!entry.applicableKeys?.includes(prop)) {
      issues.push(`${type}.${prop} not in applicableKeys`)
      continue
    }
    const constraint = entry.constraints[prop]
    if (!constraint?.compositeSchema) {
      issues.push(`${type}.${prop} missing compositeSchema in catalog constraints`)
      continue
    }
    if (constraint.compositeSchema.id !== COMPOSITE_SCHEMA_BY_PROP[prop]?.id) {
      issues.push(`${type}.${prop} compositeSchema.id mismatch`)
    }
    if (prop === 'validation') {
      const presets = constraint.compositeSchema.presets || []
      if (presets.length !== VALIDATION_PRESETS.length) {
        issues.push(`${type}.validation presets count expected ${VALIDATION_PRESETS.length} got ${presets.length}`)
      }
    }
  }

  return issues
}
