/**
 * Repair Case: INTERACTION-STATIC-TEXT-OBSERVE
 * 复现：static-text 小计用 setValue/getFieldValue 断言路径永久失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWidgetDisplayValue } from '../../v-form/src/utils/interactionObserve.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = path.resolve(__dirname, '../../v-form/src/utils/interactionRunner.ts')
const runnerSrc = fs.readFileSync(runnerPath, 'utf8')

if (!runnerSrc.includes('readWidgetDisplayValue')) {
  console.error('STATIC_TEXT_OBSERVE_MISSING', 'interactionRunner must observe via readWidgetDisplayValue')
  process.exit(1)
}

function makeStaticTextRef(initial = '小计') {
  const field = {
    type: 'static-text',
    formItemFlag: false,
    options: { name: 'note_小计_5', textContent: initial },
  }
  return {
    field,
    getValue() {
      return undefined
    },
    setValue(_v: unknown) {
      // mirrors fieldMixin: formItemFlag=false → no-op
    },
    setWidgetOption(optionName: string, optionValue: unknown) {
      if (Object.prototype.hasOwnProperty.call(field.options, optionName)) {
        ;(field.options as Record<string, unknown>)[optionName] = optionValue
      }
    },
  }
}

const ref = makeStaticTextRef('小计')
ref.setValue('小计: 10')
const viaGetValue = ref.getValue()
const viaBrokenFieldValue = viaGetValue // what old runner used through getFieldValue→getValue

if (viaBrokenFieldValue === '小计: 10') {
  console.error('UNEXPECTED_SETVALUE_WORKED')
  process.exit(1)
}

ref.setWidgetOption('textContent', '小计: 10')
const observed = readWidgetDisplayValue(ref)
if (observed !== '小计: 10') {
  console.error('STATIC_TEXT_OBSERVE_FAILED', { observed, viaBrokenFieldValue })
  process.exit(1)
}

const radioRef = {
  field: { type: 'radio', formItemFlag: true, options: { name: 'q1' } },
  getValue: () => 4,
}
if (readWidgetDisplayValue(radioRef) !== 4) {
  console.error('RADIO_OBSERVE_REGRESSION')
  process.exit(1)
}

console.log('REPAIR_STATIC_TEXT_OBSERVE_PASSED')
