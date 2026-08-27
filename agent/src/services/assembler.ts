import type { FieldPlan } from '../schemas/fieldPlan.js'
import { getDefaultFormConfig, widgetTemplates } from '../knowledge/widgetWhitelist.js'

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
      const dividerTpl = widgetTemplates.divider
      const dividerName = uniqueName(slugify(section.title, 'section') + '_div')
      widgetList.push({
        type: dividerTpl.type,
        icon: dividerTpl.icon,
        formItemFlag: false,
        options: {
          ...structuredClone(dividerTpl.options),
          name: dividerName,
          label: section.title,
        },
        id: nextId('divider', seq++),
      })
    }

    for (const field of section.fields) {
      const tpl = widgetTemplates[field.type]
      if (!tpl) continue
      const name = uniqueName(slugify(field.key || field.label, `field_${seq}`))
      const options: Record<string, unknown> = {
        ...structuredClone(tpl.options),
        name,
        label: field.label,
        required: Boolean(field.required),
      }

      if (field.type === 'radio' || field.type === 'select') {
        options.optionItems = (field.options || []).map((o) => ({
          label: o.label,
          value: o.value,
        }))
      }
      if (field.type === 'static-text') {
        options.textContent = field.textContent || field.label
      }
      if (field.type === 'divider') {
        options.label = field.label
      }

      widgetList.push({
        type: tpl.type,
        icon: tpl.icon,
        formItemFlag: tpl.formItemFlag ?? false,
        options,
        id: nextId(field.type.replace('-', ''), seq++),
      })
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
