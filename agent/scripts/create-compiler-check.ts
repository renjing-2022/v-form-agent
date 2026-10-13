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
import { assessInteractionRisk } from '../src/services/interactionRiskPolicy.js'
import { checkManagedNetworkPolicyParity } from '../src/knowledge/managedNetworkPolicy.js'
import {
  discoverExtensionSurface,
  evaluateExtensionManifest,
  resolveExtensionForCreate,
  EXTENSION_REGISTRY_FINGERPRINT,
} from '../src/knowledge/extensionManifestPolicy.js'
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

// unknown type（无 Catalog 且无 manifest → 诚实拒绝）
const unknown = compileCreateBatch([{ type: 'not-a-real-type', label: 'x' }], empty)
assert(
  !unknown.ok &&
    unknown.errors.some((e) => /not-a-real-type/.test(e.message) && /manifest|whitelist|未知/.test(e.message)),
  `reject unknown type: ${unknown.errors.map((e) => e.message).join('; ')}`,
)

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

// grid create expands minPreset (2×grid-col)
const gridCreate = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({ type: 'grid', name: 'main_grid', label: '栅格' }),
])
assert(gridCreate.ok, `grid create: ${gridCreate.errors.map((e) => e.message).join('; ')}`)
const gridNode = (gridCreate.formJson.widgetList as { type?: string; cols?: { type?: string; options?: { span?: number } }[] }[])[0]
assert(gridNode?.type === 'grid', 'grid root type')
assert(Array.isArray(gridNode.cols) && gridNode.cols.length === 2, 'grid expands 2 cols')
assert(gridNode.cols.every((c) => c.type === 'grid-col'), 'cols are grid-col')
assert(gridNode.cols.every((c) => c.options?.span === 12), 'default col span 12')

// grid-col under existing grid
const colCreate = applyCreateBatch(gridCreate.formJson, [
  createWidgetSpecSchema.parse({
    type: 'grid-col',
    name: 'extra_col',
    label: '列3',
    parent: { kind: 'existing', name: 'main_grid' },
    optionOverrides: { span: 24 },
  }),
])
assert(colCreate.ok, `grid-col create: ${colCreate.errors.map((e) => e.message).join('; ')}`)
const gridAfter = (colCreate.formJson.widgetList as { cols?: unknown[] }[])[0]
assert(Array.isArray(gridAfter.cols) && gridAfter.cols.length === 3, 'third col appended to cols')

// orphan grid-col under root rejected
const orphanCol = compileCreateBatch([{ type: 'grid-col', label: '孤列' }], empty)
assert(!orphanCol.ok && orphanCol.errors.some((e) => /不允许 parent/.test(e.message)), 'orphan grid-col rejected')

// --- v0.12 重型组件 ---
const heavy = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({ type: 'sub-form', name: 'sf1', label: '子表单', tempRef: 't_sf' }),
  createWidgetSpecSchema.parse({
    type: 'number',
    name: 'sf_age',
    label: '年龄',
    parent: { kind: 'tempRef', tempRef: 't_sf' },
  }),
  createWidgetSpecSchema.parse({ type: 'grid-sub-form', name: 'gsf1', label: '栅格子表' }),
  createWidgetSpecSchema.parse({ type: 'data-table', name: 'dt1', label: '数据表' }),
  createWidgetSpecSchema.parse({ type: 'tree', name: 'tree1', label: '树' }),
  createWidgetSpecSchema.parse({ type: 'button-group', name: 'bg1', label: '按钮组' }),
  createWidgetSpecSchema.parse({ type: 'object-group', name: 'og1', label: '对象组' }),
  createWidgetSpecSchema.parse({ type: 'vf-dialog', name: 'dlg1', label: '编辑弹窗' }),
  createWidgetSpecSchema.parse({ type: 'vf-drawer', name: 'drw1', label: '侧栏' }),
  createWidgetSpecSchema.parse({ type: 'table', name: 'tbl1', label: '表格布局' }),
  createWidgetSpecSchema.parse({ type: 'tab', name: 'tabs1', label: '选项卡' }),
])
assert(heavy.ok, `heavy create: ${heavy.errors.map((e) => e.message).join('; ')}`)
const heavyList = heavy.formJson.widgetList as Array<Record<string, any>>
const byName = (n: string) => heavyList.find((w) => w.options?.name === n)
const sf = byName('sf1')
assert(sf?.type === 'sub-form', 'sub-form created')
assert(Array.isArray(sf.widgetList) && sf.widgetList.some((c: any) => c.type === 'input'), 'sub-form min field')
assert(sf.widgetList.some((c: any) => c.options?.name === 'sf_age'), 'field under sub-form via tempRef')
const dt = byName('dt1')
assert(Array.isArray(dt?.options?.tableColumns) && dt.options.tableColumns.length === 2, 'data-table min columns')
assert(dt.options.tableColumns.every((c: any) => !c.headerFlag), 'data-table flat columns')
const tree = byName('tree1')
assert(Array.isArray(tree?.options?.treeData) && tree.options.treeData.length >= 1, 'tree min nodes')
const bg = byName('bg1')
assert(Array.isArray(bg?.options?.buttons) && bg.options.buttons.length === 2, 'button-group min buttons')
assert(byName('dlg1')?.options?.title === '编辑弹窗', 'dialog title from label')
assert(byName('drw1')?.options?.title === '侧栏', 'drawer title from label')
const tbl = byName('tbl1')
assert(Array.isArray(tbl?.rows) && tbl.rows.length === 2, 'table 2 rows')
assert(tbl.rows.every((r: any) => Array.isArray(r.cols) && r.cols.length === 2), 'table 2x2 cells')
assert(tbl.rows.every((r: any) => r.cols.every((c: any) => c.type === 'table-cell')), 'table cells typed')
const tabs = byName('tabs1')
assert(Array.isArray(tabs?.tabs) && tabs.tabs.length === 1 && tabs.tabs[0].type === 'tab-pane', 'tab min pane')

// table-cell under table; orphan rejected
const cellAdd = applyCreateBatch(heavy.formJson, [
  createWidgetSpecSchema.parse({
    type: 'table-cell',
    name: 'extra_cell',
    parent: { kind: 'existing', name: 'tbl1' },
  }),
])
assert(cellAdd.ok, `table-cell create: ${cellAdd.errors.map((e) => e.message).join('; ')}`)
const tblAfter = (cellAdd.formJson.widgetList as any[]).find((w) => w.options?.name === 'tbl1')
assert(tblAfter.rows[tblAfter.rows.length - 1].cols.some((c: any) => c.options?.name === 'extra_cell'), 'cell in last row')
const orphanCell = compileCreateBatch([{ type: 'table-cell', label: '孤格' }], empty)
assert(!orphanCell.ok && orphanCell.errors.some((e) => /不允许 parent/.test(e.message)), 'orphan table-cell rejected')
const orphanPane = compileCreateBatch([{ type: 'tab-pane', label: '孤页' }], empty)
assert(!orphanPane.ok && orphanPane.errors.some((e) => /不允许 parent/.test(e.message)), 'orphan tab-pane rejected')

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
assert(ix.ok, `interaction createWidget button: ${ix.ok ? '' : ix.error}`)

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
assert(ixBtn.ok, `addButton via compiler: ${ixBtn.ok ? '' : ixBtn.error}`)

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

// button 正式开放（无需 extraAllowedTypes）
const btnOnly = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({ type: 'button', name: 'btnGo', label: '去' }),
])
assert(btnOnly.ok, `button create open: ${btnOnly.errors.map((e) => e.message).join('; ')}`)

// --- v0.12 上传 / 受管远程 ---
const uploadOk = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({
    type: 'file-upload',
    name: 'avatar',
    label: '头像',
    optionOverrides: {
      managedUploadRef: { kind: 'managed-upload', connectorId: 'mock-upload' },
    },
  }),
  createWidgetSpecSchema.parse({
    type: 'picture-upload',
    name: 'pics',
    label: '图片',
    optionOverrides: {
      managedUploadRef: { kind: 'managed-upload', connectorId: 'mock-upload' },
    },
  }),
])
assert(uploadOk.ok, `upload create: ${uploadOk.errors.map((e) => e.message).join('; ')}`)
const avatar = (uploadOk.formJson.widgetList as any[]).find((w) => w.options?.name === 'avatar')
assert(avatar?.options?.uploadURL === '/__mock__/upload', 'managed uploadURL')
assert(avatar?.options?.withCredentials === false, 'withCredentials forced false')

const uploadCred = compileCreateBatch(
  [
    {
      type: 'file-upload',
      label: '坏上传',
      optionOverrides: { api_key: 'sk-secret', uploadURL: '/__mock__/upload' },
    },
  ],
  empty,
)
assert(!uploadCred.ok && uploadCred.errors.some((e) => /凭据/.test(e.message)), 'credential reject')

const uploadProd = compileCreateBatch(
  [
    {
      type: 'file-upload',
      label: '生产上传',
      optionOverrides: { uploadURL: 'https://api.prod.example.com/upload' },
    },
  ],
  empty,
)
assert(!uploadProd.ok && uploadProd.errors.some((e) => /生产|mock\/test/.test(e.message)), 'prod uploadURL reject')

const unknownConn = compileCreateBatch(
  [
    {
      type: 'file-upload',
      label: '未知',
      optionOverrides: { managedUploadRef: { kind: 'managed-upload', connectorId: 'prod-oss' } },
    },
  ],
  empty,
)
assert(!unknownConn.ok && unknownConn.errors.some((e) => /未知 upload connector/.test(e.message)), 'unknown connector')

const remoteSelect = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({
    type: 'select',
    name: 'city',
    label: '城市',
    optionOverrides: {
      managedDataSourceRef: {
        kind: 'managed-datasource',
        connectorId: 'mock-options',
        fieldMapping: { label: 'name', value: 'id' },
      },
    },
  }),
])
assert(remoteSelect.ok, `remote select: ${remoteSelect.errors.map((e) => e.message).join('; ')}`)
const city = (remoteSelect.formJson.widgetList as any[])[0]
assert(city.options?.dsEnabled === true && city.options?.dsName === 'mockOptionsDS', 'ds privileged patch')
assert(city.options?.remote === true, 'select remote flag')
const dsList = (remoteSelect.formJson.formConfig as { dataSources?: any[] })?.dataSources || []
assert(dsList.some((d) => d.uniqueName === 'mockOptionsDS' && d.__managedPreviewMode === 'mock-only'), 'mock ds injected')
assert(remoteSelect.warnings.some((w) => /fieldMapping:label=name,value=id/.test(w)), 'field mapping note')

const dsDirect = compileCreateBatch(
  [{ type: 'select', label: '直写', optionOverrides: { dsEnabled: true, dsName: 'x' } }],
  empty,
)
assert(!dsDirect.ok && dsDirect.errors.some((e) => /禁止直写|managedDataSourceRef/.test(e.message)), 'direct ds* reject')

const treeRemote = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({
    type: 'tree',
    name: 'org',
    label: '组织',
    optionOverrides: {
      managedDataSourceRef: {
        kind: 'managed-datasource',
        connectorId: 'mock-tree',
        fieldMapping: { label: 'name', value: 'id', children: 'children' },
      },
    },
  }),
])
assert(treeRemote.ok, `tree remote: ${treeRemote.errors.map((e) => e.message).join('; ')}`)
assert(
  (treeRemote.formJson.widgetList as any[])[0].options?.dsName === 'mockTreeDS',
  'tree managed ds',
)

const tableRemote = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({
    type: 'data-table',
    name: 'dt_remote',
    label: '远程表',
    optionOverrides: {
      managedDataSourceRef: { kind: 'managed-datasource', connectorId: 'mock-table' },
    },
  }),
])
assert(tableRemote.ok, `table remote: ${tableRemote.errors.map((e) => e.message).join('; ')}`)

// slot / card / alert 经 manifest 可创建
const slotCreate = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({ type: 'slot', name: 'slot_main', label: '插槽' }),
])
assert(slotCreate.ok, `slot create: ${slotCreate.errors.map((e) => e.message).join('; ')}`)
assert((slotCreate.formJson.widgetList as any[])[0]?.type === 'slot', 'slot node')

const cardCreate = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({ type: 'card', name: 'card1', label: '卡片A' }),
])
assert(cardCreate.ok, `card create: ${cardCreate.errors.map((e) => e.message).join('; ')}`)
assert((cardCreate.formJson.widgetList as any[])[0]?.type === 'card', 'card node')
assert(Array.isArray((cardCreate.formJson.widgetList as any[])[0]?.widgetList), 'card widgetList')

const alertCreate = applyCreateBatch(empty, [
  createWidgetSpecSchema.parse({
    type: 'alert',
    name: 'alert1',
    label: '注意',
    optionOverrides: { title: '注意', type: 'warning' },
  }),
])
assert(alertCreate.ok, `alert create: ${alertCreate.errors.map((e) => e.message).join('; ')}`)
assert((alertCreate.formJson.widgetList as any[])[0]?.options?.title === '注意', 'alert title')

// missing manifest / drift / illegal permission
const missing = resolveExtensionForCreate('chart-foo')
assert(!missing.ok && missing.reason === 'missing-manifest', 'missing manifest')

const drift = resolveExtensionForCreate('slot', { expectedFingerprint: 'deadbeef' })
assert(!drift.ok && drift.reason === 'version-drift', 'fingerprint drift')

const alertResolved = resolveExtensionForCreate('alert')
assert(alertResolved.ok, 'alert resolve for illegal clone')
const illegal = evaluateExtensionManifest({
  ...alertResolved.manifest,
  type: 'evil-alert',
  permissions: ['structure.create', 'network.fetch'],
})
assert(!illegal.ok && illegal.reason === 'illegal-permission', 'illegal permission')

const surface = discoverExtensionSurface()
assert(surface.fingerprint === EXTENSION_REGISTRY_FINGERPRINT, 'discover fingerprint')
assert(surface.blockedWithoutManifest.some((b) => b.category === 'custom'), 'block custom')
assert(surface.blockedWithoutManifest.some((b) => b.category.startsWith('chart')), 'block chart')
assert(surface.registered.some((r) => r.type === 'card' && r.capability === 'Runtime-ready'), 'card capability')

const managedParity = checkManagedNetworkPolicyParity()
assert(managedParity.length === 0, `managed network parity: ${managedParity.join('; ')}`)

// L2/L3 风险负例（Ask-before-act 契约）
const riskUpload = assessInteractionRisk({
  instruction: '给表单加一个上传头像',
  formJson: empty,
  output: {
    intent: 'mixed',
    summary: 'upload',
    structure: [
      {
        op: 'createWidget',
        type: 'file-upload',
        label: '头像',
        optionOverrides: { managedUploadRef: { kind: 'managed-upload', connectorId: 'mock-upload' } },
      },
    ],
    handlers: [],
    scenarios: [],
    unsupported: [],
  },
})
assert(riskUpload.requiresClarification && riskUpload.riskFacts.some((f) => f.code === 'upload_config'), 'upload L2')
assert(!riskUpload.reject, 'upload not L3')

const riskCred = assessInteractionRisk({
  instruction: '配置上传',
  formJson: empty,
  output: {
    intent: 'mixed',
    summary: 'cred',
    structure: [
      {
        op: 'createWidget',
        type: 'file-upload',
        optionOverrides: { api_key: 'secret', uploadURL: '/__mock__/upload' },
      },
    ],
    handlers: [],
    scenarios: [],
    unsupported: [],
  },
})
assert(riskCred.reject && riskCred.riskFacts.some((f) => f.code === 'credential_write'), 'credential L3')

const riskNet = assessInteractionRisk({
  instruction: 'onChange 里 fetch("/api")',
  formJson: empty,
  output: {
    intent: 'interaction',
    summary: 'net',
    structure: [],
    handlers: [{ target: 'form', eventKey: 'onFormMounted', code: 'fetch("/api/x")', explain: '' }],
    scenarios: [],
    unsupported: [],
  },
})
assert(riskNet.reject && riskNet.riskFacts.some((f) => f.code === 'network_js'), 'network JS L3')

const riskRemote = assessInteractionRisk({
  instruction: '下拉选项走远程数据源',
  formJson: empty,
  output: {
    intent: 'mixed',
    summary: 'ds',
    structure: [
      {
        op: 'createWidget',
        type: 'select',
        optionOverrides: {
          managedDataSourceRef: { kind: 'managed-datasource', connectorId: 'mock-options' },
        },
      },
    ],
    handlers: [],
    scenarios: [],
    unsupported: [],
  },
})
assert(
  riskRemote.requiresClarification && riskRemote.riskFacts.some((f) => f.code === 'remote_datasource'),
  'remote L2',
)

console.log('CREATE_COMPILER_CHECK_OK')
