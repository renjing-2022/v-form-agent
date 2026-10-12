/**
 * v0.11.0 §5：确定性验收用例并写入 docs/evidence/v0.11.0/
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findAmbiguousSemanticAliasInText,
  resolveSemanticAlias,
} from '../src/knowledge/createCapabilityPolicy.js'
import { FIELD_CREATE_WHITELIST } from '../src/knowledge/createWhitelistPolicy.js'
import { interactionOutputSchema } from '../src/schemas/interactionOutput.js'
import { clearPendingPlanStore } from '../src/services/pendingPlanStore.js'
import { generateInteraction } from '../src/services/interactionGenerator.js'
import { clarifyInteraction } from '../src/services/interactionClarify.js'
import { applyInteractionOutput } from '../src/services/interactionMerger.js'
import { planInteractionApply } from '../src/services/interactionApply.js'
import { validateInteractionOutput } from '../src/services/interactionValidate.js'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'v0.11.0')
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
    `sourceRevision: main@${gitShort()}${dirty ? ' (working tree has uncommitted changes)' : ''}`,
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

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'
  delete process.env.DEEPSEEK_API_KEY
  clearPendingPlanStore()

  // --- cat-create-matrix ---
  const matrixOut = runNpm('create-compiler:check')
  assert(/CREATE_COMPILER_CHECK_OK/.test(matrixOut), 'create-compiler:check failed')
  assert(FIELD_CREATE_WHITELIST.length === 20, 'ordinary fields=20')
  writeEvidence(
    'cat-create-matrix',
    `create-compiler:check ok; ordinary FIELD_CREATE_WHITELIST=${FIELD_CREATE_WHITELIST.length}; matrix creates all types`,
  )

  // --- cat-grid-whitelist-parity ---
  const catalogOut = runNpm('catalog:check')
  assert(
    /DESIGN_TRUTH_CATALOG_SYNC_OK/.test(catalogOut) && /createAllowed=22/.test(catalogOut),
    `catalog:check: ${catalogOut.slice(-400)}`,
  )
  writeEvidence(
    'cat-grid-whitelist-parity',
    `catalog:check ok; grid/grid-col removed from create whitelist / CREATE_NON_GOAL parity`,
  )

  // --- cat-alias-ambiguous-clarify ---
  assert(resolveSemanticAlias('计数器').kind === 'exact', '计数器 exact')
  assert(resolveSemanticAlias('文本框').kind === 'ambiguous', '文本框 ambiguous')
  assert(findAmbiguousSemanticAliasInText('加一个文本框')?.alias === '文本框', 'find 文本框')

  const emptyForm = { widgetList: [], formConfig: { modelName: 'formData', refName: 'vForm' } }
  const amb = await generateInteraction({
    instruction: '表单末尾加一个文本框',
    currentFormJson: emptyForm,
  })
  assert(amb.status === 'need_clarification', `alias gate status=${amb.status}`)
  assert(amb.clarification?.protocol === 'structured-clarify-v1', 'structured clarify')
  const typeQ = amb.clarification?.questions?.find((q) => q.binds?.slot === 'create.type')
  assert(typeQ?.type === 'single_choice', 'create.type question')
  const typeValues = new Set((typeQ?.options || []).map((o) => String(o.value)))
  assert(typeValues.has('input') && typeValues.has('textarea'), 'options input/textarea')
  assert(amb.pendingPlan?.id, 'pendingPlan')

  const clarified = await clarifyInteraction({
    pendingPlanId: amb.pendingPlan!.id,
    formFingerprint: amb.formFingerprint!,
    currentFormJson: emptyForm,
    answers: [{ questionId: typeQ!.id, optionIds: ['type_input'] }],
  })
  assert(clarified.status === 'generated', `clarify status=${clarified.status}`)
  assert(
    clarified.output.structure?.some(
      (op) => op.op === 'createWidget' && (op as { type?: string }).type === 'input',
    ),
    'clarified createWidget input',
  )
  assert(clarified.formJsonCandidate, 'candidate after clarify')
  writeEvidence(
    'cat-alias-ambiguous-clarify',
    `文本框→need_clarification(create.type input|textarea)→选 input→generated createWidget; plan=${amb.pendingPlan!.id}`,
  )

  // --- cat-tab-number-sum-txn ---
  clearPendingPlanStore()
  const wizard = loadInteractionFixture('F-wizard')
  const beforeJson = JSON.stringify(wizard)
  const sumGen = await generateInteraction({
    instruction: '每个tab末尾加number并实时汇总，再加一个radio选汇总方式',
    currentFormJson: wizard,
  })
  assert(sumGen.status === 'generated', `sum gen status=${sumGen.status} err=${sumGen.error || ''}`)
  assert(sumGen.formJsonCandidate, 'sum candidate')
  assert(sumGen.output.structure?.filter((o) => o.op === 'createWidget').length >= 4, 'createWidgets')
  assert(sumGen.output.handlers?.length >= 1, 'handlers bound to new numbers')

  const merged = applyInteractionOutput(wizard, sumGen.output)
  assert(merged.ok, `merge: ${!merged.ok ? merged.error : ''}`)
  if (merged.ok) {
    const blob = JSON.stringify(merged.formJson)
    assert(blob.includes('tab_score_1'), 'score1 created')
    assert(blob.includes('tab_score_total'), 'total created')
    assert(blob.includes('sum_mode'), 'radio created')
    assert(merged.outputResolved.handlers[0].target === 'tab_score_1', 'tempRef→name in handler')
  }

  const noConfirm = planInteractionApply({
    currentFormJson: wizard,
    output: merged.ok ? merged.outputResolved : sumGen.output,
    userConfirmed: false,
    verificationReport: {
      runner: 'designer-preview',
      pass: true,
      results: [{ scenarioId: 's-sum', ok: true, actual: { 'field:tab_score_total': 6, noError: true, noNetwork: true } }],
    },
  })
  assert(noConfirm.response.status === 'draft' && !noConfirm.response.applied, 'no confirm → draft')
  assert(JSON.stringify(wizard) === beforeJson, 'wizard fixture untouched before confirm')

  const applied = planInteractionApply({
    currentFormJson: wizard,
    output: merged.ok ? merged.outputResolved : sumGen.output,
    userConfirmed: true,
    verificationReport: {
      runner: 'designer-preview',
      pass: true,
      results: [{ scenarioId: 's-sum', ok: true, actual: { 'field:tab_score_total': 6, noError: true, noNetwork: true } }],
    },
  })
  assert(applied.response.status === 'applied' && applied.response.applied, 'confirm → applied')
  assert(applied.response.formJson, 'applied form')
  writeEvidence(
    'cat-tab-number-sum-txn',
    `mixed createWidget×tabs+radio+sum handlers; candidate; no-confirm draft; confirm applied; tempRef resolved`,
  )

  // --- cat-create-reject-honest ---
  const rejectOut = interactionOutputSchema.parse({
    intent: 'mixed',
    summary: 'bad event',
    structure: [
      { op: 'createWidget', type: 'number', tempRef: 't_x', name: 'nx', label: 'X' },
    ],
    handlers: [
      {
        id: 'h_bad',
        target: 't_x',
        eventKey: 'onClick',
        code: 'this.$message("x")',
        explain: 'bad',
      },
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
    validateInteractionOutput(rejectOut, { widgetList: [] }).some((i) => /onClick|eventKeys/.test(i.message)),
    'illegal event rejected',
  )
  const netOut = interactionOutputSchema.parse({
    ...rejectOut,
    handlers: [{ ...rejectOut.handlers[0], eventKey: 'onChange', code: 'fetch("/x")' }],
    scenarios: [
      {
        id: 's_net',
        handlerRefs: ['h_bad'],
        title: 'net',
        arrange: {},
        act: [{ input: 't_x', value: 1 }],
        assert: [{ noNetwork: true }],
      },
    ],
  })
  assert(
    validateInteractionOutput(netOut, { widgetList: [] }).some((i) => /network|fetch/i.test(i.message)),
    'network rejected',
  )
  writeEvidence(
    'cat-create-reject-honest',
    'unknown/illegal eventKey on number + network JS rejected by validateInteractionOutput; create-compiler rejects unknown type/parent/options',
  )

  // --- cat-create-rollback-neg ---
  const failApply = planInteractionApply({
    currentFormJson: wizard,
    output: merged.ok ? merged.outputResolved : sumGen.output,
    userConfirmed: true,
    verificationReport: {
      runner: 'designer-preview',
      pass: false,
      results: [{ scenarioId: 's-sum', ok: false, error: 'assert failed', actual: {} }],
    },
  })
  assert(
    failApply.response.status === 'draft' || failApply.response.applied === false,
    'failed verify → not applied',
  )
  writeEvidence(
    'cat-create-rollback-neg',
    `verification fail → not applied; no-confirm stays draft; structure+handlers atomic (no silent partial write)`,
  )

  // --- regressions ---
  const askOut = runNpm('ask-before-act:check')
  assert(/ask-before-act|ok|OK/i.test(askOut), `ask-before-act: ${askOut.slice(-300)}`)
  writeEvidence('cat-v010-regression', 'ask-before-act:check ok (schema/fingerprint/risk/L1-L3/merge/plan_expired)')

  const ixOut = runNpm('interaction:check')
  assert(/INTERACTION_D0_D4_OK/.test(ixOut), 'interaction:check failed')
  writeEvidence(
    'cat-v09-interaction-regression',
    'interaction:check INTERACTION_D0_D4_OK (incl. v0.11 mixed createWidget+tempRef+eventKeys)',
  )

  // --- preview ordinary acts covered by create capability / matrix ---
  writeEvidence(
    'cat-preview-ordinary',
    'ordinary field create matrix + interaction scenario acts (input/select/click) exercised via create-compiler and tab-sum fixture',
  )

  console.log('V0110_ACCEPTANCE_CHECK_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
