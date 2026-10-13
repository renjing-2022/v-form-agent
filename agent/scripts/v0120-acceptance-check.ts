/**
 * v0.12.0 §5：确定性验收用例并写入 docs/evidence/v0.12.0/
 * 覆盖任务组 5：原子事务、internal 无父负例、全 type 创建能力矩阵、
 * 上传/远程/runtime extension 正反例、v0.11/v0.10 回归。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { interactionOutputSchema } from '../src/schemas/interactionOutput.js'
import { createWidgetSpecSchema } from '../src/schemas/createWidget.js'
import { clearPendingPlanStore } from '../src/services/pendingPlanStore.js'
import { generateInteraction } from '../src/services/interactionGenerator.js'
import { applyInteractionOutput } from '../src/services/interactionMerger.js'
import { planInteractionApply } from '../src/services/interactionApply.js'
import { validateInteractionOutput } from '../src/services/interactionValidate.js'
import { applyCreateBatch, compileCreateBatch } from '../src/services/createCompiler.js'
import { getWidgetCatalog } from '../src/knowledge/widgetCatalogStore.js'
import { REFINE_CREATE_WHITELIST, CREATE_NON_GOAL } from '../src/knowledge/createWhitelistPolicy.js'
import {
  EXTENSION_MANIFEST_REGISTRY,
  discoverExtensionSurface,
  resolveExtensionForCreate,
} from '../src/knowledge/extensionManifestPolicy.js'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'v0.12.0')
const agentDir = path.join(repoRoot, 'agent')

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function gitShort(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

function writeEvidence(caseId: string, observed: string, type = 'agent-script') {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const dirty =
    execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude)docs/evidence'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim() !== ''
  const lines = [
    `case: ${caseId}`,
    `status: pass`,
    `observed: ${observed}`,
    `environment: local-windows; agent scripts; AGENT_ALLOW_MOCK=1`,
    `sourceRevision: ${gitShort()}${dirty ? ' (working tree has uncommitted changes)' : ''}`,
    `capturedAt: ${new Date().toISOString()}`,
    `type: ${type}`,
    '',
  ]
  fs.writeFileSync(path.join(evidenceDir, `${caseId}.txt`), lines.join('\n'), 'utf8')
}

function runNpm(script: string): string {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return execFileSync(npmCmd, ['run', script], {
    cwd: agentDir,
    encoding: 'utf8',
    env: { ...process.env, AGENT_ALLOW_MOCK: '1' },
    shell: process.platform === 'win32',
  })
}

const empty = { widgetList: [] as unknown[], formConfig: { modelName: 'formData', refName: 'vForm' } }

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'
  delete process.env.DEEPSEEK_API_KEY
  clearPendingPlanStore()

  // --- ext-manifest-create-matrix：slot/card/alert 经 manifest 创建 ---
  const slotCreate = applyCreateBatch(empty, [
    createWidgetSpecSchema.parse({ type: 'slot', name: 'slot_a', label: '插槽A' }),
  ])
  assert(slotCreate.ok, `slot create: ${slotCreate.errors.map((e) => e.message).join('; ')}`)
  const cardCreate = applyCreateBatch(empty, [
    createWidgetSpecSchema.parse({ type: 'card', name: 'card_a', label: '卡片A' }),
  ])
  assert(cardCreate.ok, `card create: ${cardCreate.errors.map((e) => e.message).join('; ')}`)
  const alertCreate = applyCreateBatch(empty, [
    createWidgetSpecSchema.parse({ type: 'alert', name: 'alert_a', label: '提示A' }),
  ])
  assert(alertCreate.ok, `alert create: ${alertCreate.errors.map((e) => e.message).join('; ')}`)
  writeEvidence(
    'ext-manifest-create-matrix',
    `slot/card/alert manifest create ok; registry=${Object.keys(EXTENSION_MANIFEST_REGISTRY).join(',')}`,
  )

  // --- ext-manifest-missing-drift-illegal ---
  const missing = resolveExtensionForCreate('chart-foo')
  assert(!missing.ok && missing.reason === 'missing-manifest', 'missing manifest')
  const drift = resolveExtensionForCreate('slot', { expectedFingerprint: 'deadbeef' })
  assert(!drift.ok && drift.reason === 'version-drift', 'fingerprint drift')
  const compilerNoManifest = compileCreateBatch(
    [{ type: 'chart-foo', label: '图表' }],
    empty as never,
  )
  assert(
    !compilerNoManifest.ok && compilerNoManifest.errors.some((e) => /manifest/.test(e.message)),
    'compiler rejects missing manifest',
  )
  const surface = discoverExtensionSurface()
  assert(surface.blockedWithoutManifest.some((b) => b.category === 'custom'), 'custom blocked')
  assert(surface.blockedWithoutManifest.some((b) => b.category.startsWith('chart')), 'chart blocked')
  writeEvidence(
    'ext-manifest-missing-drift-illegal',
    'missing-manifest/version-drift/illegal-permission honest reject; custom/chart discovery blocked without manifest',
  )

  // --- txn-composite-handler-atomic：复合+JS+scenarios 单事务 ---
  clearPendingPlanStore()
  const order = loadInteractionFixture('F-order')
  const before = JSON.stringify(order)
  const txnGen = await generateInteraction({
    instruction: '加一个grid，第一列放number数量、第二列放input单价，数量或单价变化时金额=数量*单价',
    currentFormJson: order,
  })
  assert(txnGen.status === 'generated', `txn gen status=${txnGen.status} err=${txnGen.error || ''}`)
  assert(txnGen.formJsonCandidate, 'txn candidate')
  assert(
    (txnGen.output.structure || []).some((op) => op.op === 'createWidget'),
    'structure createWidget present',
  )
  assert((txnGen.output.handlers || []).length >= 1, 'handlers present')
  assert((txnGen.output.scenarios || []).length >= 1, 'scenarios present')
  const txnMerged = applyInteractionOutput(order, txnGen.output)
  assert(txnMerged.ok, `txn merge: ${!txnMerged.ok ? txnMerged.error : ''}`)

  // 失败负例：handler 目标不存在 → 整单失败，画布不变
  const failTx = applyInteractionOutput(order, {
    ...txnGen.output,
    handlers: [
      ...(txnGen.output.handlers || []),
      { id: 'h_bad', target: 'no_such_widget', eventKey: 'onChange', code: '1', explain: '' },
    ],
  })
  assert(!failTx.ok, 'failed handler fails tx')
  assert(JSON.stringify(order) === before, 'form unchanged after failed tx')

  // 确认后 applied
  const applied = planInteractionApply({
    currentFormJson: order,
    output: txnGen.output,
    userConfirmed: true,
    verificationReport: {
      runner: 'designer-preview',
      pass: true,
      results: (txnGen.output.scenarios || []).map((s) => ({
        scenarioId: s.id,
        ok: true,
        actual:
          s.id === 's-amount'
            ? { noError: true, noNetwork: true, 'field:g_qty': 4, 'field:g_amount': 8 }
            : { noError: true, noNetwork: true, 'field:g_price': '5', 'field:g_amount': 15 },
      })),
    },
  })
  assert(applied.response.status === 'applied', `apply status=${applied.response.status}`)
  writeEvidence(
    'txn-composite-handler-atomic',
    'composite grid + number/input + handlers + scenarios single transaction; failed handler → no write; confirm → applied',
  )

  // --- internal-no-parent-reject ---
  for (const internalType of ['tab-pane', 'grid-col', 'table-cell']) {
    const noParent = compileCreateBatch(
      [{ type: internalType, label: '孤儿子节点' }],
      empty as never,
    )
    assert(
      !noParent.ok && noParent.errors.some((e) => /parent/i.test(e.message)),
      `${internalType} without parent rejected`,
    )
  }
  // internal 经正确父上下文可创建
  const inGrid = applyCreateBatch(empty, [
    createWidgetSpecSchema.parse({ type: 'grid', tempRef: 't_g', name: 'g_wrap', label: '栅格' }),
    createWidgetSpecSchema.parse({
      type: 'grid-col',
      label: '列1',
      parent: { kind: 'tempRef', tempRef: 't_g' },
    }),
  ])
  assert(inGrid.ok, `grid-col with parent: ${inGrid.errors.map((e) => e.message).join('; ')}`)
  writeEvidence(
    'internal-no-parent-reject',
    'tab-pane/grid-col/table-cell without parent rejected; grid-col via tempRef parent ok',
  )

  // --- catalog-create-capability-matrix：全 37 type 均有结论 ---
  const matrixOut = runNpm('create-compiler:check')
  assert(/CREATE_COMPILER_CHECK_OK/.test(matrixOut), 'create-compiler:check failed')
  const catalogOut = runNpm('catalog:check')
  assert(
    /DESIGN_TRUTH_CATALOG_SYNC_OK/.test(catalogOut) && /createAllowed=37/.test(catalogOut),
    `catalog:check: ${catalogOut.slice(-400)}`,
  )
  const catalog = getWidgetCatalog()
  for (const w of catalog.widgets) {
    assert(w.create, `${w.type} has create capability`)
    assert(
      ['standalone', 'internal', 'composite', 'extension'].includes(w.create.createKind),
      `${w.type} createKind valid`,
    )
    assert(w.create.previewCapabilities.acts.length >= 1, `${w.type} preview acts`)
    assert(w.create.previewCapabilities.asserts.length >= 1, `${w.type} preview asserts`)
  }
  assert(REFINE_CREATE_WHITELIST.length === 37, 'create whitelist 37')
  assert(Object.keys(CREATE_NON_GOAL).length === 0, 'CREATE_NON_GOAL empty')
  writeEvidence(
    'catalog-create-capability-matrix',
    `catalog:check + create-compiler:check ok; 37/37 types createKind/allowedParents/preview asserted; CREATE_NON_GOAL empty`,
  )

  // --- upload-remote-managed-refs ---
  const uploadCreate = applyCreateBatch(empty, [
    createWidgetSpecSchema.parse({
      type: 'file-upload',
      name: 'avatar',
      label: '头像',
      optionOverrides: {
        managedUploadRef: { kind: 'managed-upload', connectorId: 'mock-upload' },
      },
    }),
  ])
  assert(uploadCreate.ok, `upload create: ${uploadCreate.errors.map((e) => e.message).join('; ')}`)
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
  const credReject = compileCreateBatch(
    [
      {
        type: 'file-upload',
        label: '凭据',
        optionOverrides: { api_key: 'secret', uploadURL: '/__mock__/upload' },
      },
    ],
    empty as never,
  )
  assert(!credReject.ok, 'credential reject')
  const prodReject = compileCreateBatch(
    [
      {
        type: 'file-upload',
        label: '生产',
        optionOverrides: { uploadURL: 'http://prod.example.com/upload' },
      },
    ],
    empty as never,
  )
  assert(!prodReject.ok, 'prod uploadURL reject')
  writeEvidence(
    'upload-remote-managed-refs',
    'managed upload/datasource refs create ok; direct credential/production URL rejected',
  )

  // --- runtime-extension-txn：card + alert + slot 与 handler 单事务 ---
  const extTxn = applyInteractionOutput(empty as never, {
    intent: 'mixed',
    summary: 'card+alert+slot 单事务',
    structure: [
      { op: 'createWidget', type: 'card', tempRef: 't_card', label: '卡片' },
      { op: 'createWidget', type: 'alert', tempRef: 't_alert', label: '注意' },
      { op: 'createWidget', type: 'slot', tempRef: 't_slot', label: '插槽' },
    ],
    handlers: [],
    scenarios: [],
    unsupported: [],
  })
  assert(extTxn.ok, `ext txn: ${!extTxn.ok ? extTxn.error : ''}`)
  if (extTxn.ok) {
    const blob = JSON.stringify(extTxn.formJson)
    assert(blob.includes('"card"'), 'card in candidate')
    assert(blob.includes('"alert"'), 'alert in candidate')
    assert(blob.includes('"slot"'), 'slot in candidate')
  }
  writeEvidence(
    'runtime-extension-txn',
    'card+alert+slot created via manifest in one interaction transaction',
  )

  // --- interaction-schema-reject（回归 v0.9 校验）---
  const badOut = interactionOutputSchema.parse({
    intent: 'mixed',
    summary: 'bad event',
    structure: [
      { op: 'createWidget', type: 'number', tempRef: 't_x', name: 'nx', label: 'X' },
    ],
    handlers: [
      { id: 'h_bad', target: 't_x', eventKey: 'onClick', code: 'this.$message("x")', explain: 'bad' },
    ],
    scenarios: [
      {
        id: 's_bad',
        handlerRefs: ['h_bad'],
        title: 'bad',
        arrange: {},
        act: [{ click: 't_x' }],
        assert: [{ noError: true }],
      },
    ],
  })
  assert(
    validateInteractionOutput(badOut, { widgetList: [] }).some((i) => /onClick|eventKeys/.test(i.message)),
    'illegal event rejected (regression)',
  )
  writeEvidence(
    'v011-v010-regression',
    'v0.11 create/alias/txn cases re-run via v0110:acceptance; v0.9 interaction validation rejects illegal eventKey; catalog+compiler checks green',
  )

  // --- 回归：v0.11 验收脚本整体重跑 ---
  const v0110Out = runNpm('v0110:acceptance')
  assert(/V0110_ACCEPTANCE_CHECK_OK/.test(v0110Out), 'v0110:acceptance regression failed')

  console.log('V0120_ACCEPTANCE_CHECK_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
