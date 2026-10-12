/**
 * v0.11 §2：统一 createCompiler 冒烟（schema + 编译 + 拒绝路径）
 */
import { FIELD_CREATE_WHITELIST } from '../src/knowledge/createWhitelistPolicy.js'
import { createWidgetOpSchema, createWidgetSpecSchema } from '../src/schemas/createWidget.js'
import { refinePlanSchema } from '../src/schemas/refinePlan.js'
import { assembleFormJson } from '../src/services/assembler.js'
import {
  applyCreateBatch,
  buildOrdinaryFieldOverrides,
  compileCreateBatch,
  createSpecFromAddField,
  sanitizeCreateOptionOverrides,
} from '../src/services/createCompiler.js'
import { applyRefinePlan } from '../src/services/refineMerger.js'
import { applyInteractionOutput } from '../src/services/interactionMerger.js'
import type { FormJson } from '../src/schemas/refinePlan.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

const empty: FormJson = {
  widgetList: [],
  formConfig: { modelName: 'formData', refName: 'vForm' },
}

// schema
const parsed = createWidgetOpSchema.parse({
  op: 'createWidget',
  type: 'number',
  tempRef: 't_counter',
  label: '计数',
  parent: { kind: 'root' },
  position: { kind: 'last' },
  optionOverrides: { required: true },
})
assert(parsed.tempRef === 't_counter', 'tempRef parse')

const refine = refinePlanSchema.parse({
  summary: 'createWidget op',
  warnings: [],
  operations: [
    {
      op: 'createWidget',
      type: 'input',
      tempRef: 't_in',
      label: '姓名',
      name: 'user_name',
    },
  ],
})
assert(refine.operations[0].op === 'createWidget', 'refine plan accepts createWidget')

// happy path + tempRef
const batch = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({
    type: 'number',
    tempRef: 'a',
    label: 'A',
    name: 'num_a',
  }),
  createWidgetSpecSchema.parse({
    type: 'number',
    tempRef: 'b',
    label: 'B',
    name: 'num_b',
    parent: { kind: 'root' },
    position: { kind: 'after', sibling: { tempRef: 'a' } },
  }),
])
assert(batch.ok, `batch ok: ${batch.errors.map((e) => e.message).join('; ')}`)
assert(batch.tempRefMap.get('a')?.name === 'num_a', 'tempRef a name')
assert(batch.tempRefMap.get('b')?.name === 'num_b', 'tempRef b name')
assert((batch.formJson.widgetList || []).length === 2, 'two widgets')
assert(
  String((batch.formJson.widgetList as { options?: { name?: string } }[])[0].options?.name) === 'num_a',
  'order a then b',
)

// unknown type
const unknown = compileCreateBatch([{ type: 'not-a-real-type', label: 'x' }], empty)
assert(!unknown.ok && unknown.errors.some((e) => /未知 type/.test(e.message)), 'reject unknown type')

// illegal parent for standalone under grid (grid itself as parent type string)
const withGrid: FormJson = {
  widgetList: [
    {
      type: 'grid',
      id: 'g1',
      options: { name: 'g1' },
      cols: [{ type: 'grid-col', id: 'c1', options: { name: 'c1', span: 12 }, widgetList: [] }],
    },
  ],
  formConfig: {},
}
// parent = grid (not in allowedParents for number) should fail
const badParent = compileCreateBatch(
  [{ type: 'number', label: 'n', parent: { kind: 'existing', name: 'g1' } }],
  withGrid,
)
assert(!badParent.ok && badParent.errors.some((e) => /不允许 parent/.test(e.message)), 'reject illegal parent')

// illegal optionOverrides
const badOpt = sanitizeCreateOptionOverrides('input', { onChange: 'alert(1)' })
assert(!badOpt.ok && badOpt.errors.some((e) => /事件键/.test(e)), 'reject event override')
const badKey = sanitizeCreateOptionOverrides('input', { notARealKey: 1 })
assert(!badKey.ok && badKey.errors.some((e) => /不可写键|未知/.test(e)), 'reject unknown key')

// grid create rejected
const gridCreate = compileCreateBatch([{ type: 'grid', label: '栅格' }], empty)
assert(!gridCreate.ok, 'grid create rejected')

// addField adapter via refine
const merged = applyRefinePlan(empty, {
  summary: 'add via createCompiler',
  warnings: [],
  operations: [
    {
      op: 'addField',
      field: { key: 'age', label: '年龄', type: 'number', required: true },
    },
  ],
})
assert(
  (merged.formJson.widgetList as { type?: string }[]).some((w) => w.type === 'number'),
  'addField via compiler',
)

// generate assembler
const assembled = assembleFormJson({
  formTitle: 't',
  layout: 'sectioned',
  sections: [
    {
      title: '基本',
      fields: [{ key: 'name', label: '姓名', type: 'input', required: true }],
    },
  ],
})
assert(
  (assembled.widgetList as { type?: string }[]).some((w) => w.type === 'divider'),
  'assembler divider',
)
assert((assembled.widgetList as { type?: string }[]).some((w) => w.type === 'input'), 'assembler input')

// interaction createWidget + addButton compat
const formWithPane: FormJson = {
  widgetList: [
    {
      type: 'tab',
      id: 'tab1',
      options: { name: 'tab1' },
      tabs: [
        {
          type: 'tab-pane',
          id: 'pane1',
          options: { name: 'pane1', label: '一', active: true },
          widgetList: [],
        },
      ],
    },
  ],
  formConfig: {},
}
const ix = applyInteractionOutput(formWithPane, {
  intent: 'mixed',
  summary: 'add btn',
  structure: [
    {
      op: 'createWidget',
      type: 'button',
      name: 'btnOk',
      label: '确定',
      parent: { kind: 'existing', name: 'pane1' },
    },
  ],
  handlers: [
    {
      target: 'btnOk',
      eventKey: 'onClick',
      code: 'this.$message("ok")',
      explain: 'click',
    },
  ],
  scenarios: [
    {
      id: 's1',
      handlerRefs: ['btnOk:onClick'],
      title: 'click',
      arrange: {},
      act: [{ click: 'btnOk' }],
      assert: [{ noError: true }],
    },
  ],
  unsupported: [],
})
assert(ix.ok, `interaction createWidget button: ${ix.error || ''}`)

const ixBtn = applyInteractionOutput(formWithPane, {
  intent: 'mixed',
  summary: 'addButton compat',
  structure: [{ op: 'addButton', label: '下一页', name: 'btnNext', eachTabPane: true }],
  handlers: [
    {
      target: 'btnNext',
      eventKey: 'onClick',
      code: 'this.$message("next")',
      explain: 'next',
    },
  ],
  scenarios: [
    {
      id: 's2',
      handlerRefs: ['btnNext:onClick'],
      title: 'next',
      arrange: {},
      act: [{ click: 'btnNext__pane1' }],
      assert: [{ noError: true }],
    },
  ],
  unsupported: [],
})
assert(ixBtn.ok, `addButton via compiler: ${ixBtn.error || ''}`)

// addField adapter helper
const fromAdd = createSpecFromAddField({
  field: { key: 'x', label: 'X', type: 'input' },
})
assert(fromAdd.type === 'input' && fromAdd.name === 'x', 'createSpecFromAddField')

// §3 普通字段全量 create matrix
assert(FIELD_CREATE_WHITELIST.length === 20, `ordinary fields=20 got ${FIELD_CREATE_WHITELIST.length}`)
const matrixSpecs = FIELD_CREATE_WHITELIST.map((type, i) =>
  createWidgetSpecSchema.parse({
    type,
    name: `f_${type.replace(/-/g, '_')}`,
    label: `L-${type}`,
    optionOverrides: buildOrdinaryFieldOverrides({
      type,
      label: `L-${type}`,
      required: type === 'input' ? true : undefined,
      options:
        type === 'radio' || type === 'checkbox' || type === 'select' || type === 'cascader'
          ? [
              { label: '甲', value: 'a' },
              { label: '乙', value: 'b' },
            ]
          : undefined,
      textContent: type === 'static-text' || type === 'html-text' ? `<b>${type}</b>` : undefined,
    }),
    position: i === 0 ? { kind: 'last' } : undefined,
  }),
)
const matrix = applyCreateBatch(empty, matrixSpecs)
assert(matrix.ok, `ordinary matrix: ${matrix.errors.map((e) => e.message).join('; ')}`)
assert((matrix.formJson.widgetList || []).length === 20, 'matrix creates 20 widgets')
const matrixTypes = new Set(
  (matrix.formJson.widgetList as { type?: string }[]).map((w) => String(w.type || '')),
)
for (const type of FIELD_CREATE_WHITELIST) {
  assert(matrixTypes.has(type), `matrix missing type ${type}`)
}

// 上传仍拒绝；button 正式开放（无需 extraAllowedTypes）
const upload = compileCreateBatch([{ type: 'file-upload', label: '上传' }], empty)
assert(!upload.ok, 'file-upload still rejected')
const btnOnly = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({ type: 'button', name: 'btnGo', label: '去' }),
])
assert(btnOnly.ok, `button create open: ${btnOnly.errors.map((e) => e.message).join('; ')}`)

console.log('CREATE_COMPILER_CHECK_OK')
