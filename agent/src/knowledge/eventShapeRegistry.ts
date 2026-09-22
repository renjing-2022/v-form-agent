/**
 * v0.7 事件 shape 登记：形参 / API 白名单 / writableIn。
 * 合入层本版仍禁写；writableIn=v0.8+ 仅表示后续版预留。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PROPERTY_REGISTER_REL } from './catalogPolicy.js'

export type EventWritableIn = 'never' | 'v0.8+'

export type EventShape = {
  owner: { kind: 'widget' | 'form'; type?: string }
  key: string
  params: string[]
  thisApiAllowlist: string[]
  intentTags: string[]
  writableIn: EventWritableIn
}

const CORE_THIS_API = [
  'getFormRef',
  'getWidgetRef',
  'getParentFormRef',
  'getGlobalDsv',
  'getFieldEditor',
  'setValue',
  '$message',
] as const

/** 经 getFormRef() 可用的表单 API（登记供后续护栏消费） */
const FORM_REF_API = [
  'getFormData',
  'setFormData',
  'getFieldValue',
  'setFieldValue',
  'disableWidgets',
  'enableWidgets',
  'hideWidgets',
  'showWidgets',
  'validateForm',
  'resetForm',
] as const

const DEFAULT_THIS_API = [...CORE_THIS_API, ...FORM_REF_API]

/** 接口通道：永不开放写 */
export const EVENT_KEYS_NEVER = new Set([
  'onRemoteQuery',
  'onBeforeUpload',
  'onUploadSuccess',
  'onUploadError',
  'onFileRemove',
])

/** 运行时形参真源（fieldMixin / form-render / 容器） */
const PARAMS_BY_KEY: Record<string, string[]> = {
  onCreated: [],
  onMounted: [],
  onClick: [],
  onInput: ['value'],
  onChange: ['value', 'oldValue'],
  onFocus: ['event'],
  onBlur: ['event'],
  onValidate: ['rule', 'value', 'callback'],
  onAppendButtonClick: [],
  onRemoteQuery: ['keyword'],
  onBeforeUpload: ['file'],
  onUploadSuccess: ['result', 'file', 'fileList'],
  onUploadError: ['error', 'file', 'fileList'],
  onFileRemove: ['file', 'fileList'],
  onTabClick: ['tab'],
  onSubFormRowAdd: ['subFormData', 'newRowId'],
  onSubFormRowInsert: ['subFormData', 'newRowId'],
  onSubFormRowDelete: ['subFormData', 'deletedDataRow', 'deletedRowIndex'],
  onSubFormRowChange: ['subFormData'],
  onPageSizeChange: ['pageSize', 'currentPage'],
  onCurrentPageChange: ['pageSize', 'currentPage'],
  onSortChange: ['column', 'prop', 'order', 'pageSize', 'currentPage'],
  onSelectionChange: ['selection', 'selectedIndices'],
  onHideOperationButton: ['buttonConfig', 'rowIndex', 'row'],
  onDisableOperationButton: ['buttonConfig', 'rowIndex', 'row'],
  onGetOperationButtonLabel: ['buttonConfig', 'rowIndex', 'row'],
  onOperationButtonClick: ['buttonName', 'rowIndex', 'row'],
  onHeaderClick: ['column', 'event'],
  onRowClick: ['row', 'column', 'event'],
  onRowDoubleClick: ['row', 'column', 'event'],
  onCellClick: ['row', 'column', 'cell', 'event'],
  onCellDoubleClick: ['row', 'column', 'cell', 'event'],
  onGetRowClassName: ['rowIndex', 'row'],
  onGetSpanMethod: ['row', 'column', 'rowIndex', 'columnIndex'],
  onOkButtonClick: [],
  onCancelButtonClick: [],
  onDialogOpened: [],
  onDialogBeforeClose: ['done'],
  onDrawerOpened: [],
  onDrawerBeforeClose: [],
  onButtonGroupClick: ['buttonConfig'],
  onNodeClick: ['data', 'node', 'el'],
  onNodeCheck: ['data', 'treeState'],
  onNodeContextmenu: ['event', 'data', 'node', 'el'],
  onCheckChange: ['data', 'checked', 'indeterminate'],
  onFormCreated: [],
  onFormMounted: [],
  onFormDataChange: ['fieldName', 'newValue', 'oldValue', 'formModel', 'subFormName', 'subFormRowIndex'],
  onFormValidate: ['formModel'],
}

const INTENT_TAGS: Record<string, string[]> = {
  onCreated: ['lifecycle', 'init'],
  onMounted: ['lifecycle', 'init'],
  onFormCreated: ['lifecycle', 'form', 'init'],
  onFormMounted: ['lifecycle', 'form', 'init'],
  onChange: ['linkage', 'compute'],
  onClick: ['action', 'button'],
  onFormValidate: ['validate', 'submit'],
  onFormDataChange: ['linkage', 'form'],
  onSubFormRowAdd: ['sub-form', 'row'],
  onSubFormRowInsert: ['sub-form', 'row'],
  onSubFormRowDelete: ['sub-form', 'row'],
  onSubFormRowChange: ['sub-form', 'row'],
  onOkButtonClick: ['dialog', 'action'],
  onCancelButtonClick: ['dialog', 'action'],
  onRemoteQuery: ['remote', 'network'],
  onBeforeUpload: ['upload', 'network'],
  onUploadSuccess: ['upload', 'network'],
  onUploadError: ['upload', 'network'],
  onFileRemove: ['upload'],
}

function writableInFor(key: string): EventWritableIn {
  return EVENT_KEYS_NEVER.has(key) ? 'never' : 'v0.8+'
}

function shapeFor(key: string, owner: EventShape['owner']): EventShape {
  return {
    owner,
    key,
    params: PARAMS_BY_KEY[key] ?? [],
    thisApiAllowlist: [...DEFAULT_THIS_API],
    intentTags: INTENT_TAGS[key] ?? ['general'],
    writableIn: writableInFor(key),
  }
}

/** 从 propertyRegister.js 解析 EVENT_PROPERTIES 键名 */
export function listEventPropertyKeys(root: string): string[] {
  const file = path.join(root, PROPERTY_REGISTER_REL)
  const source = fs.readFileSync(file, 'utf8')
  const start = source.indexOf('const EVENT_PROPERTIES')
  if (start < 0) throw new Error('EVENT_PROPERTIES block not found')
  const brace = source.indexOf('{', start)
  let depth = 0
  let end = brace
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = source.slice(brace + 1, end)
  const keys: string[] = []
  for (const m of body.matchAll(/['"](on[A-Z][A-Za-z]+)['"]\s*:/g)) {
    keys.push(m[1])
  }
  return [...new Set(keys)].sort()
}

const FORM_EVENT_KEYS = ['onFormCreated', 'onFormMounted', 'onFormDataChange', 'onFormValidate'] as const

export function buildEventShapeRegistry(root: string): EventShape[] {
  const widgetKeys = listEventPropertyKeys(root)
  const shapes: EventShape[] = []
  for (const key of widgetKeys) {
    shapes.push(shapeFor(key, { kind: 'widget' }))
  }
  for (const key of FORM_EVENT_KEYS) {
    shapes.push(shapeFor(key, { kind: 'form' }))
  }
  return shapes.sort((a, b) => {
    const ak = `${a.owner.kind}:${a.key}`
    const bk = `${b.owner.kind}:${b.key}`
    return ak.localeCompare(bk)
  })
}

export function getEventShapeRegistryPath(root: string): string {
  return path.join(root, 'agent/src/knowledge/generated/event-shape.json')
}

export function loadEventShapeRegistry(root: string): EventShape[] {
  const p = getEventShapeRegistryPath(root)
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { shapes: EventShape[] }
  return raw.shapes
}

export function writeEventShapeRegistry(root: string, shapes: EventShape[]): void {
  const p = getEventShapeRegistryPath(root)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(
    p,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedFor: 'v0.7.0',
        note: 'writableIn=v0.8+ is reserved; v0.7 merge path still forbids all event keys',
        shapes,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

export function findEventShape(shapes: EventShape[], key: string): EventShape | undefined {
  return shapes.find((s) => s.key === key)
}

export function isInterfaceEventKey(key: string): boolean {
  return EVENT_KEYS_NEVER.has(key)
}

export function checkEventShapeParity(root: string): string[] {
  const issues: string[] = []
  const expected = buildEventShapeRegistry(root)
  const p = getEventShapeRegistryPath(root)
  if (!fs.existsSync(p)) {
    issues.push(`missing ${path.relative(root, p).replace(/\\/g, '/')}`)
    return issues
  }
  const loaded = loadEventShapeRegistry(root)
  const expectedKeys = new Set(expected.map((s) => `${s.owner.kind}:${s.key}`))
  const loadedKeys = new Set(loaded.map((s) => `${s.owner.kind}:${s.key}`))
  for (const k of expectedKeys) {
    if (!loadedKeys.has(k)) issues.push(`missing shape ${k}`)
  }
  for (const k of loadedKeys) {
    if (!expectedKeys.has(k)) issues.push(`unexpected shape ${k}`)
  }
  for (const shape of loaded) {
    if (shape.writableIn === ('v0.7' as EventWritableIn)) {
      issues.push(`${shape.key} must not be writableIn=v0.7`)
    }
    const expectNever = EVENT_KEYS_NEVER.has(shape.key)
    if (expectNever && shape.writableIn !== 'never') {
      issues.push(`${shape.key} must be writableIn=never`)
    }
    if (!expectNever && shape.owner.kind === 'widget' && shape.writableIn !== 'v0.8+') {
      issues.push(`${shape.key} pure-frontend must be writableIn=v0.8+`)
    }
    if (!expectNever && shape.owner.kind === 'form' && shape.writableIn !== 'v0.8+') {
      issues.push(`form ${shape.key} must be writableIn=v0.8+`)
    }
    const expectedParams = PARAMS_BY_KEY[shape.key]
    if (expectedParams && JSON.stringify(shape.params) !== JSON.stringify(expectedParams)) {
      issues.push(`${shape.key} params mismatch: got [${shape.params}] expect [${expectedParams}]`)
    }
    if (!shape.thisApiAllowlist.includes('getFormRef')) {
      issues.push(`${shape.key} thisApiAllowlist must include getFormRef`)
    }
  }
  for (const key of ['onCreated', 'onMounted', 'onSubFormRowAdd']) {
    const s = loaded.find((x) => x.key === key)
    if (!s || s.writableIn !== 'v0.8+') issues.push(`${key} must be registered writableIn=v0.8+`)
  }
  for (const key of EVENT_KEYS_NEVER) {
    const s = loaded.find((x) => x.key === key)
    if (!s) issues.push(`interface key ${key} missing from registry`)
  }
  return issues
}
