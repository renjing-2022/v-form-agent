/**
 * v0.13.0 §5：确定性验收用例并写入 docs/evidence/v0.13.0/
 * 覆盖：大表索引/截断、修正分流与循环终止、事件四模式、
 * 上传/远程/extension 风险、capability/observability、v0.12–v0.10 回归。
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
import { applyCreateBatch, compileCreateBatch } from '../src/services/createCompiler.js'
import {
  discoverExtensionSurface,
  resolveExtensionForCreate,
} from '../src/knowledge/extensionManifestPolicy.js'
import { buildFormIndex } from '../src/services/formIndex.js'
import { buildFormSummaryReport } from '../src/services/formSummary.js'
import { buildTargetAmbiguityGate } from '../src/services/targetAmbiguityGate.js'
import { assertCapabilityMatrixComplete, buildCapabilityMatrix } from '../src/services/capabilityMatrix.js'
import { buildFLarge } from './write-f-large-fixture.js'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'v0.13.0')
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

  // --- large-form-index-coverage ---
  const large = buildFLarge()
  const largeIndex = buildFormIndex(large as never)
  assert(largeIndex.nodes.length > 120, `nodes ${largeIndex.nodes.length}`)
  assert(largeIndex.maxDepth > 8, `depth ${largeIndex.maxDepth}`)
  assert(largeIndex.nodes.some((n) => n.name === 'deepLeaf'), 'deepLeaf indexed')
  const report = buildFormSummaryReport(large as never, '把字段70和字段71设为必填')
  assert(report.coverage.truncated, 'truncation visible')
  assert(report.omissions.length >= 1, 'omissions')
  assert(report.fingerprint === largeIndex.fingerprint, 'fingerprint match')
  const gate = buildTargetAmbiguityGate({
    instruction: '把备注改成必填并联动',
    formJson: large as never,
  })
  assert(!gate.ok && gate.kind === 'need_clarification', 'ambiguity clarify')
  writeEvidence(
    'large-form-index-coverage',
    `nodes=${largeIndex.nodes.length} maxDepth=${largeIndex.maxDepth}; truncated=${report.coverage.truncated}; omissions=${report.omissions.length}; deepLeaf indexed; 备注 ambiguity→clarify`,
  )

  // --- repair-route-loop-terminate ---
  const autonomyOut = runNpm('autonomy:check')
  assert(/AUTONOMY_HARDENING_T1_OK/.test(autonomyOut), 'autonomy:check failed')
  writeEvidence(
    'repair-route-loop-terminate',
    'Plan/Scenario Critic + failureClassify routes (code/structure/intent/policy/infrastructure); duplicate fingerprint blocked; infra does not consume business budget',
  )

  // --- event-merge-four-mode-matrix ---
  const eventOut = runNpm('event-merge:check')
  assert(/EVENT_MERGE_T3_OK/.test(eventOut), 'event-merge:check failed')
  const fo = loadInteractionFixture('F-order')
  const qty = fo.widgetList.find((w: any) => w?.options?.name === 'qty') as {
    options?: Record<string, unknown>
  }
  assert(qty?.options, 'qty')
  const beforeOnChange = String(qty.options!.onChange || '')
  qty.options!.onChange = 'this.setLabel("old")'
  const mergeOutput = interactionOutputSchema.parse({
    intent: 'interaction',
    summary: 'merge modes',
    structure: [],
    handlers: [
      {
        id: 'h1',
        target: 'qty',
        eventKey: 'onChange',
        code: 'this.setValue(2)',
        explain: 'new',
      },
    ],
    scenarios: [
      {
        id: 's-new',
        handlerRefs: ['h1'],
        title: 'new',
        arrange: {},
        act: [{ input: 'qty', value: 2 }],
        assert: [{ noError: true }, { noNetwork: true }],
      },
    ],
    unsupported: [],
  })
  const prepended = applyInteractionOutput(fo, mergeOutput, {
    eventResolutions: [{ target: 'qty', eventKey: 'onChange', mode: 'prepend' }],
  })
  assert(prepended.ok, 'prepend ok')
  const appended = applyInteractionOutput(fo, mergeOutput, {
    eventResolutions: [{ target: 'qty', eventKey: 'onChange', mode: 'append' }],
  })
  assert(appended.ok, 'append ok')
  const overwritten = applyInteractionOutput(fo, mergeOutput, {
    eventResolutions: [{ target: 'qty', eventKey: 'onChange', mode: 'overwrite' }],
  })
  assert(overwritten.ok && overwritten.overwriteRollbacks?.length === 1, 'overwrite+rollback')
  const cancelled = applyInteractionOutput(fo, mergeOutput, {
    eventResolutions: [{ target: 'qty', eventKey: 'onChange', mode: 'cancel' }],
  })
  assert(!cancelled.ok, 'all-cancel → no write (draft/reject)')
  assert(
    String(qty.options!.onChange || '').includes('setLabel("old")'),
    'cancel leaves source form handwritten code unchanged',
  )
  qty.options!.onChange = beforeOnChange
  writeEvidence(
    'event-merge-four-mode-matrix',
    'event-merge:check ok; prepend/append/overwrite(+rollback) write; cancel rejects write and keeps handwritten handler',
  )

  // --- upload-remote-extension-risk ---
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
  assert(uploadCreate.ok, `upload: ${uploadCreate.errors.map((e) => e.message).join('; ')}`)
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
  assert(remoteSelect.ok, `remote: ${remoteSelect.errors.map((e) => e.message).join('; ')}`)
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
  assert(!prodReject.ok, 'prod URL reject')
  const missing = resolveExtensionForCreate('chart-foo')
  assert(!missing.ok && missing.reason === 'missing-manifest', 'missing manifest')
  const surface = discoverExtensionSurface()
  assert(surface.blockedWithoutManifest.some((b) => b.category === 'custom'), 'custom blocked')
  const netGen = await generateInteraction({
    instruction: '点击提交时 fetch 到后端保存订单',
    currentFormJson: loadInteractionFixture('F-order'),
  })
  assert(netGen.status === 'unsupported', `network status=${netGen.status}`)
  writeEvidence(
    'upload-remote-extension-risk',
    'managed upload/datasource ok; credential/prod URL rejected; missing-manifest/custom blocked; generated JS network → unsupported',
  )

  // --- capability-observability-gate ---
  const formCtx = runNpm('form-context:check')
  assert(/FORM_CONTEXT_T2_OK/.test(formCtx), 'form-context:check failed')
  const obs = runNpm('observability:check')
  assert(/OBSERVABILITY_T4_OK/.test(obs), 'observability:check failed')
  const matrix = buildCapabilityMatrix()
  const holes = assertCapabilityMatrixComplete(matrix)
  assert(holes.length === 0, `capability holes: ${holes.join('; ')}`)
  writeEvidence(
    'capability-observability-gate',
    `form-context+observability ok; capability matrix rows=${matrix.rows.length} holes=0; provenance+txn+eval harness covered`,
  )

  // --- v012-v011-v010-regression ---
  const v012 = runNpm('v0120:acceptance')
  assert(/V0120_ACCEPTANCE_CHECK_OK/.test(v012), 'v0120:acceptance failed')
  const v011 = runNpm('v0110:acceptance')
  assert(/V0110_ACCEPTANCE_CHECK_OK/.test(v011), 'v0110:acceptance failed')
  const ask = runNpm('ask-before-act:check')
  assert(/ask-before-act-check: ok/.test(ask), 'ask-before-act:check failed')
  const interaction = runNpm('interaction:check')
  assert(/INTERACTION_D0_D4_OK/.test(interaction), 'interaction:check failed')
  writeEvidence(
    'v012-v011-v010-regression',
    'v0120:acceptance + v0110:acceptance + ask-before-act:check + interaction:check all green',
  )

  console.log('V0130_ACCEPTANCE_CHECK_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
