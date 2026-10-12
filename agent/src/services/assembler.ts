import type { FieldPlan } from '../schemas/fieldPlan.js'
import { getDefaultFormConfig } from '../knowledge/widgetWhitelist.js'
import { applyCreateBatch, buildOrdinaryFieldOverrides } from './createCompiler.js'
import type { CreateWidgetSpec } from '../schemas/createWidget.js'

function slugify(input: string, fallback: string) {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (raw || fallback).slice(0, 40)
}

/** generate：经统一 createCompiler 组装（Catalog defaults + 严格 optionOverrides） */
export function assembleFormJson(plan: FieldPlan) {
  const specs: CreateWidgetSpec[] = []

  for (const section of plan.sections) {
    if (plan.layout === 'sectioned') {
      specs.push({
        type: 'divider',
        name: slugify(section.title, 'section') + '_div',
        label: section.title,
        parent: { kind: 'root' },
        optionOverrides: buildOrdinaryFieldOverrides({
          type: 'divider',
          label: section.title,
        }),
      })
    }

    for (const field of section.fields) {
      specs.push({
        type: field.type,
        name: slugify(field.key || field.label, 'field'),
        label: field.label,
        parent: { kind: 'root' },
        optionOverrides: buildOrdinaryFieldOverrides(field),
      })
    }
  }

  const empty = { widgetList: [] as unknown[], formConfig: getDefaultFormConfig() }
  const result = applyCreateBatch(empty, specs)
  if (!result.ok) {
    const detail = result.errors.map((e) => e.message).join('; ')
    throw new Error(`assembleFormJson createCompiler failed: ${detail}`)
  }

  return {
    widgetList: result.formJson.widgetList,
    formConfig: {
      ...getDefaultFormConfig(),
      ...(result.formJson.formConfig || {}),
    },
  }
}
