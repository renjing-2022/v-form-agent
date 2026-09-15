/**
 * Repair Case: REFINE-CATALOG-DEFAULTVALUE-FALSE-POSITIVE
 * 复现：radio 已有合法 defaultValue 时，仅改 labelAlign 不得被 Catalog 误杀。
 */
import { refinePlanSchema } from '../src/schemas/refinePlan.js'
import { getDefaultFormConfig } from '../src/knowledge/widgetWhitelist.js'
import { applyRefinePlan } from '../src/services/refineMerger.js'
import { collectWidgetIds, validateFormJson } from '../src/services/validator.js'

const form = {
  widgetList: [
    {
      type: 'radio',
      id: 'radio1',
      options: {
        name: 'score',
        label: '评分项',
        labelAlign: '',
        defaultValue: 1,
        displayStyle: 'block',
        optionItems: [
          { label: '差', value: 0 },
          { label: '好', value: 1 },
        ],
        onChange: '',
        onCreated: '',
        onMounted: '',
        onValidate: '',
      },
    },
  ],
  formConfig: {
    ...getDefaultFormConfig(),
    labelAlign: 'label-left-align',
  },
}

const merged = applyRefinePlan(
  form,
  refinePlanSchema.parse({
    summary: '字段标签居中对齐',
    warnings: [],
    operations: [
      { op: 'patchFormConfig', patch: { labelAlign: 'label-center-align' } },
      {
        op: 'updateField',
        target: { id: 'radio1' },
        patch: { labelAlign: 'label-center-align' },
      },
    ],
  }),
)

const radio = merged.formJson.widgetList[0] as {
  options: Record<string, unknown>
}
const issues = validateFormJson(merged.formJson, {
  mode: 'refine',
  existingIds: collectWidgetIds(form),
})

const alignFormOk = merged.formJson.formConfig.labelAlign === 'label-center-align'
const alignFieldOk = radio.options.labelAlign === 'label-center-align'
const defaultKept = radio.options.defaultValue === 1
const defaultValueIssues = issues.filter((i) => i.message.includes('defaultValue') || i.path.includes('defaultValue'))

if (!alignFormOk || !alignFieldOk) {
  console.error('ALIGN_NOT_APPLIED', {
    formAlign: merged.formJson.formConfig.labelAlign,
    fieldAlign: radio.options.labelAlign,
  })
  process.exit(1)
}

if (!defaultKept) {
  console.error('DEFAULT_VALUE_LOST', radio.options.defaultValue)
  process.exit(1)
}

if (defaultValueIssues.length || issues.length) {
  console.error('CATALOG_FALSE_POSITIVE', JSON.stringify(issues, null, 2))
  process.exit(1)
}

console.log('REPAIR_CATALOG_DEFAULTVALUE_PASSED')
