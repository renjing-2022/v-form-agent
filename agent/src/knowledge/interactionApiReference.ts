/**
 * v0.9 交互生成：VForm 渲染态 API 参考手册（喂给模型，不是白名单）。
 * parity 检查保证手册登记的方法在源码中真实存在，避免误导模型。
 */
import fs from 'node:fs'
import path from 'node:path'

export type ApiOwner = 'form' | 'field' | 'tab' | 'subForm' | 'dialog' | 'message'

export type ApiEntry = {
  owner: ApiOwner
  name: string
  signature: string
  note?: string
  /** 相对仓库根的源文件；parity 在此文件中查找方法定义 */
  source: string
  /** 源码中用于定位的字面片段（默认 `name(`） */
  sourceNeedle?: string
}

export type EventContext = {
  eventKey: string
  owner: 'form' | 'field' | 'button' | 'subForm' | 'tab' | 'dialog'
  /** new Function / AsyncFunction 形参名 */
  params: string[]
  /** this 绑定 */
  thisBinding: string
  note?: string
}

/** 网络相关 API：本管线禁止调用（静态检查会拦） */
export const NETWORK_APIS: ApiEntry[] = [
  {
    owner: 'form',
    name: 'executeDataSource',
    signature: 'async executeDataSource(dsName, localDsv = {})',
    note: '发起数据源 HTTP 请求；v0.9 交互管线禁止',
    source: 'v-form/src/components/form-render/index.vue',
  },
]

export const FORM_APIS: ApiEntry[] = [
  {
    owner: 'form',
    name: 'getWidgetRef',
    signature: 'getWidgetRef(widgetName, showError = false)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'getFieldValue',
    signature: 'getFieldValue(fieldName)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'setFieldValue',
    signature: 'setFieldValue(fieldName, fieldValue, disableChangeEvent = false)',
    note: '验证前置值时传 disableChangeEvent=true 避免连环触发',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'getFormData',
    signature: 'getFormData(needValidation = true)',
    note: 'needValidation=true 时返回 Promise',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'setFormData',
    signature: 'setFormData(formData)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'validateForm',
    signature: 'validateForm(callback)',
    note: 'callback(valid, invalidFields)；含自定义 onFormValidate',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'validateField',
    signature: 'validateField(fieldName)',
    note: '返回 Element Plus 校验 Promise',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'hideWidgets',
    signature: 'hideWidgets(widgetNames: string | string[])',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'showWidgets',
    signature: 'showWidgets(widgetNames: string | string[])',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'disableWidgets',
    signature: 'disableWidgets(widgetNames: string | string[])',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'enableWidgets',
    signature: 'enableWidgets(widgetNames: string | string[])',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'setWidgetsRequired',
    signature: 'setWidgetsRequired(widgetNames: string | string[], required: boolean)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'resetForm',
    signature: 'resetForm(disableChangeEvent = false)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'clearValidate',
    signature: 'clearValidate(props?)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'getSubFormValues',
    signature: 'getSubFormValues(subFormName, needValidation = true)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'setSubFormValues',
    signature: 'setSubFormValues(subFormName, subFormValues)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'getFieldWidgets',
    signature: 'getFieldWidgets(staticWidgetsIncluded = false)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'showDialog',
    signature: 'showDialog(dialogName, formData = {}, extraData = {}, title = "")',
    note: '返回 DynamicDialog 实例（含 close()）；无 form 级 closeDialog(name)',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'showDrawer',
    signature: 'showDrawer(drawerName, formData = {}, extraData = {}, title = "")',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'getDialogOrDrawerRef',
    signature: 'getDialogOrDrawerRef()',
    note: '当前打开的弹窗/抽屉组件；可对其调用 close()',
    source: 'v-form/src/components/form-render/index.vue',
  },
  {
    owner: 'form',
    name: 'getFormRef',
    signature: 'getFormRef()',
    note: '返回表单自身；字段事件里常用 this.getFormRef()',
    source: 'v-form/src/components/form-render/index.vue',
  },
]

export const FIELD_APIS: ApiEntry[] = [
  {
    owner: 'field',
    name: 'getValue',
    signature: 'getValue()',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'setValue',
    signature: 'setValue(newValue, disableChangeEvent = false)',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'setHidden',
    signature: 'setHidden(flag)',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'setDisabled',
    signature: 'setDisabled(flag, clearValidationIfDisabled?)',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'setRequired',
    signature: 'setRequired(flag)',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'setLabel',
    signature: 'setLabel(newLabel)',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'focus',
    signature: 'focus()',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'resetField',
    signature: 'resetField(disableChangeEvent = false)',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'clearValidate',
    signature: 'clearValidate()',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
  },
  {
    owner: 'field',
    name: 'getFormRef',
    signature: 'getFormRef()',
    source: 'v-form/src/components/form-designer/form-widget/field-widget/fieldMixin.js',
    sourceNeedle: 'getFormRef()',
  },
]

export const TAB_APIS: ApiEntry[] = [
  {
    owner: 'tab',
    name: 'activeTab',
    signature: 'activeTab(tabIndex)',
    note: 'tabIndex 从 0 计数；定义在 containerItemMixin',
    source: 'v-form/src/components/form-render/container-item/containerItemMixin.js',
  },
  {
    owner: 'tab',
    name: 'getActiveTabIndex',
    signature: 'getActiveTabIndex()',
    source: 'v-form/src/components/form-render/container-item/tab-item.vue',
  },
  {
    owner: 'tab',
    name: 'activeTabName',
    signature: 'activeTabName (data)',
    note: '可读写当前页 name',
    source: 'v-form/src/components/form-render/container-item/tab-item.vue',
    sourceNeedle: 'activeTabName:',
  },
]

export const SUBFORM_APIS: ApiEntry[] = [
  {
    owner: 'subForm',
    name: 'getWidgetRefOfSubForm',
    signature: 'getWidgetRefOfSubForm(widgetName, rowIndex)',
    note: '访问指定行内字段 ref',
    source: 'v-form/src/components/form-render/container-item/sub-form-item.vue',
  },
  {
    owner: 'subForm',
    name: 'getSubFormValues',
    signature: 'getSubFormValues(needValidation = true)',
    source: 'v-form/src/components/form-render/container-item/containerItemMixin.js',
  },
  {
    owner: 'subForm',
    name: 'setSubFormValues',
    signature: 'setSubFormValues(subFormValues)',
    source: 'v-form/src/components/form-render/container-item/sub-form-item.vue',
    sourceNeedle: 'setSubFormValues(',
  },
]

export const DIALOG_APIS: ApiEntry[] = [
  {
    owner: 'dialog',
    name: 'close',
    signature: 'close()',
    note: 'DynamicDialog 实例方法；无 form.closeDialog(name)。父表单可对 showDialog 返回值或 getDialogOrDrawerRef() 调用',
    source: 'v-form/src/components/form-render/dynamic-dialog.vue',
  },
  {
    owner: 'dialog',
    name: 'show',
    signature: 'show()',
    source: 'v-form/src/components/form-render/dynamic-dialog.vue',
  },
]

export const MESSAGE_APIS: ApiEntry[] = [
  {
    owner: 'message',
    name: '$message',
    signature: 'this.$message.success|error|warning|info(text)',
    note: 'VFormRender / 字段组件均挂载 Element Plus $message；禁止当作网络能力',
    source: 'v-form/src/components/form-render/index.vue',
    sourceNeedle: 'this.$message',
  },
]

/** 事件执行上下文（模型写代码的关键输入） */
export const EVENT_CONTEXTS: EventContext[] = [
  {
    eventKey: 'onFormCreated',
    owner: 'form',
    params: [],
    thisBinding: 'VFormRender',
  },
  {
    eventKey: 'onFormMounted',
    owner: 'form',
    params: [],
    thisBinding: 'VFormRender',
  },
  {
    eventKey: 'onFormDataChange',
    owner: 'form',
    params: ['fieldName', 'newValue', 'oldValue', 'formModel', 'subFormName', 'subFormRowIndex'],
    thisBinding: 'VFormRender',
    note: '参数以源码 new Function 形参为准，可能还有后续形参',
  },
  {
    eventKey: 'onFormValidate',
    owner: 'form',
    params: ['formModel'],
    thisBinding: 'VFormRender',
    note: 'AsyncFunction；返回 false 表示校验失败；undefined 视为通过',
  },
  {
    eventKey: 'onChange',
    owner: 'field',
    params: ['value', 'oldValue'],
    thisBinding: 'field widget',
    note: '子表内字段额外传入 subFormData, rowId',
  },
  {
    eventKey: 'onFocus',
    owner: 'field',
    params: ['event'],
    thisBinding: 'field widget',
  },
  {
    eventKey: 'onBlur',
    owner: 'field',
    params: ['event'],
    thisBinding: 'field widget',
  },
  {
    eventKey: 'onInput',
    owner: 'field',
    params: ['value'],
    thisBinding: 'field widget',
  },
  {
    eventKey: 'onValidate',
    owner: 'field',
    params: ['rule', 'value', 'callback'],
    thisBinding: 'field widget',
  },
  {
    eventKey: 'onClick',
    owner: 'button',
    params: [],
    thisBinding: 'button widget',
    note: '通过 this.getFormRef() 访问表单 API',
  },
  {
    eventKey: 'onCreated',
    owner: 'field',
    params: [],
    thisBinding: 'field/button widget',
  },
  {
    eventKey: 'onMounted',
    owner: 'field',
    params: [],
    thisBinding: 'field/button widget',
  },
  {
    eventKey: 'onSubFormRowAdd',
    owner: 'subForm',
    params: ['subFormData', 'newRowId'],
    thisBinding: 'sub-form container item',
  },
  {
    eventKey: 'onSubFormRowInsert',
    owner: 'subForm',
    params: ['subFormData', 'newRowId'],
    thisBinding: 'sub-form container item',
  },
  {
    eventKey: 'onSubFormRowDelete',
    owner: 'subForm',
    params: ['subFormData', 'deletedDataRow', 'deletedRowIndex'],
    thisBinding: 'sub-form container item',
  },
  {
    eventKey: 'onSubFormRowChange',
    owner: 'subForm',
    params: ['subFormData'],
    thisBinding: 'sub-form container item',
  },
  {
    eventKey: 'onTabClick',
    owner: 'tab',
    params: ['tab'],
    thisBinding: 'tab container item',
  },
]

export const ALL_REFERENCE_APIS: ApiEntry[] = [
  ...FORM_APIS,
  ...FIELD_APIS,
  ...TAB_APIS,
  ...SUBFORM_APIS,
  ...DIALOG_APIS,
  ...MESSAGE_APIS,
  ...NETWORK_APIS,
]

function resolveRepoRoot(fromDir = process.cwd()): string {
  let dir = fromDir
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'v-form', 'src')) && fs.existsSync(path.join(dir, 'agent', 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(fromDir, '..')
}

function assertMethodInSource(root: string, entry: ApiEntry): string | null {
  const filePath = path.join(root, entry.source.replace(/\//g, path.sep))
  if (!fs.existsSync(filePath)) {
    return `missing source ${entry.source} for ${entry.owner}.${entry.name}`
  }
  const text = fs.readFileSync(filePath, 'utf8')
  const needle = entry.sourceNeedle || `${entry.name}(`
  if (!text.includes(needle)) {
    return `parity: ${entry.owner}.${entry.name} not found in ${entry.source} (needle=${JSON.stringify(needle)})`
  }
  return null
}

/** 手册条目必须在 VForm 源码中存在 */
export function checkInteractionApiReferenceParity(root = resolveRepoRoot()): string[] {
  const issues: string[] = []
  for (const entry of ALL_REFERENCE_APIS) {
    const issue = assertMethodInSource(root, entry)
    if (issue) issues.push(issue)
  }
  for (const ctx of EVENT_CONTEXTS) {
    if (!ctx.eventKey || !ctx.params) {
      issues.push(`event context incomplete: ${ctx.eventKey}`)
    }
  }
  // 审计结论硬约束：禁止把不存在的 closeDialog 登记成 form API
  if (FORM_APIS.some((a) => a.name === 'closeDialog')) {
    issues.push('form must not list closeDialog (does not exist); use dialog.close / getDialogOrDrawerRef')
  }
  if (!NETWORK_APIS.some((a) => a.name === 'executeDataSource')) {
    issues.push('NETWORK_APIS must include executeDataSource')
  }
  return issues
}

/** 给模型的精简 markdown 手册 */
export function renderInteractionApiReferenceMarkdown(): string {
  const lines: string[] = [
    '# VForm 渲染态 API 参考（提示用，非白名单）',
    '',
    '在事件代码中：表单方法通过 `this`（form 事件）或 `this.getFormRef()`（字段/按钮事件）调用。',
    '禁止调用网络相关 API（见文末）。',
    '',
    '## 表单 API',
  ]
  for (const a of FORM_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('', '## 字段 API（getWidgetRef 拿到的字段实例）')
  for (const a of FIELD_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('', '## Tab')
  for (const a of TAB_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('', '## 子表')
  for (const a of SUBFORM_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('', '## 弹窗')
  for (const a of DIALOG_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('', '## 提示消息')
  for (const a of MESSAGE_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('', '## 事件上下文（this / 参数）')
  for (const c of EVENT_CONTEXTS) {
    lines.push(
      `- \`${c.eventKey}\` @ ${c.owner}: params=[${c.params.join(', ')}]; this=${c.thisBinding}` +
        (c.note ? `; ${c.note}` : ''),
    )
  }
  lines.push('', '## 禁止（网络）')
  for (const a of NETWORK_APIS) {
    lines.push(`- \`${a.signature}\`${a.note ? ` — ${a.note}` : ''}`)
  }
  lines.push('- 任意 `fetch` / `XMLHttpRequest` / `WebSocket` / `axios` / 动态 `import()` 等')
  lines.push('')
  return lines.join('\n')
}
