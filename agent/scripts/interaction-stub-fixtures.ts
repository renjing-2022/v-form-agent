/**
 * 为尚未录制的题库条目写入可校验的 mock 回放 fixture（验收用）。
 * 真实 Key 录制可用 interaction:record 覆盖同名文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/interaction/replay')

type Fixture = {
  match: { scenarioId: string; instructionIncludes: string[] }
  output: Record<string, unknown>
}

const stubs: Fixture[] = [
  {
    match: { scenarioId: 'nl-wizard-prev-next', instructionIncludes: ['加上一页和下一页'] },
    output: {
      intent: 'mixed',
      summary: '每页上一页/下一页按钮',
      structure: [
        { op: 'addButton', label: '上一页', name: 'btnPrev', eachTabPane: true },
        { op: 'addButton', label: '下一页', name: 'btnNext', eachTabPane: true },
      ],
      handlers: [
        {
          id: 'h-prev',
          target: 'btnPrev',
          eventKey: 'onClick',
          code: "const f=this.getFormRef();const t=f.getWidgetRef('wizardTab');const i=t.getActiveTabIndex();if(i>0)t.activeTab(i-1);",
          explain: '上一页',
        },
        {
          id: 'h-next',
          target: 'btnNext',
          eventKey: 'onClick',
          code: "const f=this.getFormRef();const t=f.getWidgetRef('wizardTab');const i=t.getActiveTabIndex();if(i<t.widget.tabs.length-1)t.activeTab(i+1);",
          explain: '下一页',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-next'],
          title: '下一页前进',
          arrange: { activeTab: 0 },
          act: [{ click: 'btnNext__tab1' }],
          assert: [{ activeTab: 1 }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-wizard-submit-locate', instructionIncludes: ['最后一页加一个提交按钮'] },
    output: {
      intent: 'mixed',
      summary: '末页提交并定位错误页',
      structure: [{ op: 'addButton', label: '提交', name: 'btnSubmit', parent: { name: 'tab3' } }],
      handlers: [
        {
          id: 'h-sub',
          target: 'btnSubmit',
          eventKey: 'onClick',
          code: "const f=this.getFormRef();f.validateForm((ok)=>{if(!ok){const w=f.getWidgetRef('name');if(w&&w.focus)w.focus();}});",
          explain: '提交校验',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-sub'],
          title: '空字段提交',
          arrange: { activeTab: 2, values: { name: '' } },
          act: [{ click: 'btnSubmit' }],
          assert: [{ valid: false }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-other-required', instructionIncludes: ['选「其他」时显示其他说明'] },
    output: {
      intent: 'interaction',
      summary: '类型其他时显示必填说明',
      structure: [],
      handlers: [
        {
          id: 'h-type',
          target: 'type',
          eventKey: 'onChange',
          code: "const f=this.getFormRef();const v=f.getFieldValue('type');const other=v==='other';f[other?'showWidgets':'hideWidgets']('otherDesc');f.setWidgetsRequired('otherDesc',other);",
          explain: '联动',
        },
      ],
      scenarios: [
        {
          id: 's-other',
          handlerRefs: ['h-type'],
          title: '选其他',
          arrange: {},
          act: [{ input: 'type', value: 'other' }],
          assert: [{ field: 'otherDesc', hidden: false }, { field: 'otherDesc', required: true }, { noError: true }],
        },
        {
          id: 's-person',
          handlerRefs: ['h-type'],
          title: '选个人',
          arrange: {},
          act: [{ input: 'type', value: 'personal' }],
          assert: [{ field: 'otherDesc', hidden: true }, { field: 'otherDesc', required: false }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-disable-when-empty', instructionIncludes: ['单价为空时禁用折扣'] },
    output: {
      intent: 'interaction',
      summary: '单价空则禁用折扣',
      structure: [],
      handlers: [
        {
          id: 'h-price',
          target: 'price',
          eventKey: 'onChange',
          code: "const f=this.getFormRef();const p=f.getFieldValue('price');const empty=p===null||p===undefined||p==='';f[empty?'disableWidgets':'enableWidgets']('discount');",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-price'],
          title: '空禁用',
          arrange: {},
          act: [{ input: 'price', value: null }],
          assert: [{ field: 'discount', disabled: true }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-date-range-validate', instructionIncludes: ['结束日期不能早于开始日期'] },
    output: {
      intent: 'interaction',
      summary: '日期范围校验',
      structure: [],
      handlers: [
        {
          id: 'h-val',
          target: 'form',
          eventKey: 'onFormValidate',
          code: "const s=formModel.startDate,e=formModel.endDate;if(s&&e&&e<s)return false;return true;",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's-bad',
          handlerRefs: ['h-val'],
          title: '违反',
          arrange: { values: { startDate: '2026-09-10', endDate: '2026-09-01' } },
          act: [{ submit: true }],
          assert: [{ valid: false }, { noError: true }],
        },
        {
          id: 's-ok',
          handlerRefs: ['h-val'],
          title: '满足',
          arrange: { values: { startDate: '2026-09-01', endDate: '2026-09-10' } },
          act: [{ submit: true }],
          assert: [{ valid: true }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-budget-validate', instructionIncludes: ['实付不能超过预算'] },
    output: {
      intent: 'interaction',
      summary: '预算校验',
      structure: [],
      handlers: [
        {
          id: 'h-val',
          target: 'form',
          eventKey: 'onFormValidate',
          code: "if(Number(formModel.pay||0)>Number(formModel.budget||0)){const w=this.getWidgetRef('pay');if(w&&w.focus)w.focus();return false;}return true;",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-val'],
          title: '超预算',
          arrange: { values: { pay: 200, budget: 100 } },
          act: [{ submit: true }],
          assert: [{ valid: false }, { focused: 'pay' }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-reset-button', instructionIncludes: ['「重置」按钮'] },
    output: {
      intent: 'mixed',
      summary: '重置按钮',
      structure: [{ op: 'addButton', label: '重置', name: 'btnReset' }],
      handlers: [
        {
          id: 'h-reset',
          target: 'btnReset',
          eventKey: 'onClick',
          code: 'this.getFormRef().resetForm(true);',
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-reset'],
          title: '重置',
          arrange: { values: { qty: 3 } },
          act: [{ click: 'btnReset' }],
          assert: [{ field: 'qty', value: null }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-fill-default', instructionIncludes: ['「填入示例」按钮'] },
    output: {
      intent: 'mixed',
      summary: '填入示例',
      structure: [{ op: 'addButton', label: '填入示例', name: 'btnFill' }],
      handlers: [
        {
          id: 'h-fill',
          target: 'btnFill',
          eventKey: 'onClick',
          code: "const f=this.getFormRef();f.setFieldValue('qty',1);f.setFieldValue('price',100);",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-fill'],
          title: '填值',
          arrange: {},
          act: [{ click: 'btnFill' }],
          assert: [{ field: 'qty', value: 1 }, { field: 'price', value: 100 }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-open-help', instructionIncludes: ['帮助弹窗'] },
    output: {
      intent: 'mixed',
      summary: '打开帮助弹窗',
      structure: [{ op: 'addButton', label: '帮助', name: 'btnHelp' }],
      handlers: [
        {
          id: 'h-help',
          target: 'btnHelp',
          eventKey: 'onClick',
          code: "this.getFormRef().showDialog('helpDialog');",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-help'],
          title: '打开',
          arrange: {},
          act: [{ click: 'btnHelp' }],
          assert: [{ dialogVisible: 'helpDialog', value: true }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-subform-row-calc', instructionIncludes: ['小计等于单价乘数量'] },
    output: {
      intent: 'interaction',
      summary: '子表小计与合计',
      structure: [],
      handlers: [
        {
          id: 'h-row',
          target: 'itemQty',
          eventKey: 'onChange',
          code: "const f=this.getFormRef();const price=Number(f.getFieldValue('itemPrice')||0);const qty=Number(value||0);f.setFieldValue('itemSubtotal',price*qty,true);",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-row'],
          title: '占位场景',
          arrange: {},
          act: [{ mount: true }],
          assert: [{ noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-subform-default', instructionIncludes: ['新增行时数量默认为1'] },
    output: {
      intent: 'interaction',
      summary: '增行默认数量1',
      structure: [],
      handlers: [
        {
          id: 'h-add',
          target: 'detail',
          eventKey: 'onSubFormRowAdd',
          code: "const f=this.getFormRef();f.setSubFormValues('detail', (f.getSubFormValues('detail',false)||[]).map((r,i,a)=>i===a.length-1?{...r,itemQty:1}:r));",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-add'],
          title: '增行',
          arrange: {},
          act: [{ addSubFormRow: 'detail' }],
          assert: [{ noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-init-defaults', instructionIncludes: ['打开表单时类型默认选个人'] },
    output: {
      intent: 'interaction',
      summary: '装载默认值',
      structure: [],
      handlers: [
        {
          id: 'h-m',
          target: 'form',
          eventKey: 'onFormMounted',
          code: "this.setFieldValue('type','personal',true);this.setFieldValue('discount',0,true);this.disableWidgets('pay');",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-m'],
          title: '装载',
          arrange: {},
          act: [{ mount: true }],
          assert: [
            { field: 'type', value: 'personal' },
            { field: 'discount', value: 0 },
            { field: 'pay', disabled: true },
            { noError: true },
          ],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-init-active-tab', instructionIncludes: ['默认停在第二页'] },
    output: {
      intent: 'interaction',
      summary: '默认第二页',
      structure: [],
      handlers: [
        {
          id: 'h-m',
          target: 'form',
          eventKey: 'onFormMounted',
          code: "const t=this.getWidgetRef('wizardTab');if(t)t.activeTab(1);",
          explain: '',
        },
      ],
      scenarios: [
        {
          id: 's1',
          handlerRefs: ['h-m'],
          title: '装载',
          arrange: {},
          act: [{ mount: true }],
          assert: [{ activeTab: 1 }, { noError: true }],
        },
      ],
      unsupported: [],
    },
  },
  {
    match: { scenarioId: 'nl-neg-submit-api', instructionIncludes: ['发到后端保存'] },
    output: {
      intent: 'unsupported',
      summary: '需要网络请求',
      structure: [],
      handlers: [],
      scenarios: [],
      unsupported: [{ text: '提交发后端', reason: '禁止网络请求' }],
    },
  },
  {
    match: { scenarioId: 'nl-neg-upload', instructionIncludes: ['上传附件'] },
    output: {
      intent: 'unsupported',
      summary: '上传不支持',
      structure: [],
      handlers: [],
      scenarios: [],
      unsupported: [{ text: '上传附件', reason: '上传属于非目标' }],
    },
  },
  {
    match: { scenarioId: 'nl-neg-ambiguous', instructionIncludes: ['那个字段的联动'] },
    output: {
      intent: 'need_clarification',
      summary: '指代不清',
      structure: [],
      handlers: [],
      scenarios: [],
      unsupported: [],
      questions: ['请明确是哪个字段？希望什么条件下如何变化？'],
    },
  },
  {
    match: { scenarioId: 'nl-neg-partial', instructionIncludes: ['保存时调用接口'] },
    output: {
      intent: 'unsupported',
      summary: '核心意图含接口',
      structure: [],
      handlers: [],
      scenarios: [],
      unsupported: [{ text: '保存时调用接口', reason: '禁止网络；整体不可 apply' }],
    },
  },
]

fs.mkdirSync(outDir, { recursive: true })
for (const s of stubs) {
  const p = path.join(outDir, `${s.match.scenarioId}.json`)
  if (fs.existsSync(p) && !process.env.FORCE_STUB) {
    console.log('skip existing', s.match.scenarioId)
    continue
  }
  fs.writeFileSync(p, `${JSON.stringify(s, null, 2)}\n`, 'utf8')
  console.log('wrote', s.match.scenarioId)
}
console.log('STUBS_OK')
