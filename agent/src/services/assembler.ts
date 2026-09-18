import type { FieldPlan } from '../schemas/fieldPlan.js'
import { getDefaultFormConfig } from '../knowledge/widgetWhitelist.js'
import { buildWidgetFromCatalogDefaults, getWidgetDefaultSchema } from '../knowledge/widgetDefaults.js'

function slugify(input: string, fallback: string) {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (raw || fallback).slice(0, 40)
}

function nextId(prefix: string, seq: number) {
  return `${prefix}${seq}`
}

export function assembleFormJson(plan: FieldPlan) {
  const widgetList: Record<string, unknown>[] = []
  let seq = 1
  const usedNames = new Set<string>()

  const uniqueName = (base: string) => {
    let name = base
    let i = 1
    while (usedNames.has(name)) {
      name = `${base}_${i++}`
    }
    usedNames.add(name)
    return name
  }

  for (const section of plan.sections) {
    if (plan.layout === 'sectioned') {
      const dividerSchema = getWidgetDefaultSchema('divider')
      if (!dividerSchema) throw new Error('Catalog 缺少 divider 默认项')
      const dividerName = uniqueName(slugify(section.title, 'section') + '_div')
      widgetList.push(
        buildWidgetFromCatalogDefaults('divider', {
          id: nextId('divider', seq++),
          name: dividerName,
          label: section.title,
        }),
      )
    }

    for (const field of section.fields) {
      const schema = getWidgetDefaultSchema(field.type)
      if (!schema) continue
      const name = uniqueName(slugify(field.key || field.label, `field_${seq}`))
      const optionOverrides: Record<string, unknown> = {
        label: field.label,
        required: Boolean(field.required),
      }

      if (field.type === 'radio' || field.type === 'select') {
        optionOverrides.optionItems = (field.options || []).map((o) => ({
          label: o.label,
          value: o.value,
        }))
      }
      if (field.type === 'static-text') {
        optionOverrides.textContent = field.textContent || field.label
      }
      if (field.type === 'divider') {
        optionOverrides.label = field.label
      }

      widgetList.push(
        buildWidgetFromCatalogDefaults(field.type, {
          id: nextId(field.type.replace('-', ''), seq++),
          name,
          optionOverrides,
        }),
      )
    }
  }

  const formConfig = {
    ...getDefaultFormConfig(),
    // keep title hint in functions comment-free; consumers can read summary
  }

  return {
    widgetList,
    formConfig,
  }
}
