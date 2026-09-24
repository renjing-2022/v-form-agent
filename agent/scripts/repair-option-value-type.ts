/**
 * Repair Case: REFINE-OPTION-VALUE-TYPE-BATCH
 * 复现：模型用 pathPrefix "widgetList" 批量改 optionValueType=number 时不得因歧义 422；
 * 合入后应为 Number，且 optionItems.value 转为数字。
 */
import { refinePlanSchema } from '../src/schemas/refinePlan.js'
import { getDefaultFormConfig } from '../src/knowledge/widgetWhitelist.js'
import { normalizeRefinePlanSynonyms } from '../src/services/nlSynonymNormalize.js'
import { applyRefinePlan } from '../src/services/refineMerger.js'
import { validatePlanTargets } from '../src/services/targetResolver.js'

const form = {
  widgetList: [
    {
      type: 'radio',
      id: 'radio1',
      options: {
        name: 'q1',
        label: '题目1',
        optionValueType: '',
        defaultValue: '1',
        optionItems: [
          { label: '差', value: '0' },
          { label: '好', value: '1' },
        ],
        onChange: '',
        onCreated: '',
        onMounted: '',
        onValidate: '',
      },
    },
    {
      type: 'select',
      id: 'select1',
      options: {
        name: 'q2',
        label: '题目2',
        optionValueType: '',
        defaultValue: '2',
        optionItems: [
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
        ],
        onChange: '',
        onCreated: '',
        onMounted: '',
        onValidate: '',
      },
    },
    {
      type: 'input',
      id: 'input1',
      options: {
        name: 'note',
        label: '备注',
        onChange: '',
        onCreated: '',
        onMounted: '',
        onValidate: '',
      },
    },
  ],
  formConfig: getDefaultFormConfig(),
}

const rawPlan = refinePlanSchema.parse({
  summary: '所有选项值类型改为 number',
  warnings: [],
  operations: [
    {
      op: 'updateFieldsInScope',
      parent: { pathPrefix: 'widgetList' },
      patch: { optionValueType: 'number' },
    },
  ],
})

const { plan } = normalizeRefinePlanSynonyms(rawPlan)
const targetCheck = validatePlanTargets(form, plan.operations)
if (!targetCheck.ok) {
  console.error('OPTION_VALUE_TYPE_SCOPE_REJECTED', targetCheck.rejectMessage)
  process.exit(1)
}

const merged = applyRefinePlan(form, plan)
const radios = merged.formJson.widgetList.filter(
  (w: { type?: string }) => w.type === 'radio' || w.type === 'select',
) as Array<{ options: Record<string, unknown> }>

const typeOk = radios.every((w) => w.options.optionValueType === 'Number')
const valuesOk = radios.every((w) => {
  const items = w.options.optionItems as Array<{ value: unknown }>
  return Array.isArray(items) && items.every((it) => typeof it.value === 'number')
})
const inputUntouched =
  (merged.formJson.widgetList.find((w: { type?: string }) => w.type === 'input') as { options: Record<string, unknown> })
    .options.optionValueType === undefined

if (!typeOk || !valuesOk || !inputUntouched) {
  console.error('OPTION_VALUE_TYPE_NOT_APPLIED', {
    types: radios.map((w) => w.options.optionValueType),
    values: radios.map((w) => (w.options.optionItems as Array<{ value: unknown }>).map((i) => i.value)),
    inputUntouched,
    warnings: merged.warnings,
  })
  process.exit(1)
}

console.log('REPAIR_OPTION_VALUE_TYPE_PASSED')
