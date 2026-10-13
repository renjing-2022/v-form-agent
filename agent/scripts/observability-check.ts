/**
 * v0.13 任务组 4：capability matrix、preview provenance、脱敏指标、评测集、事务故障注入
 */
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import {
  assertCapabilityMatrixComplete,
  buildCapabilityMatrix,
} from '../src/services/capabilityMatrix.js'
import {
  attachProvenanceToReport,
  buildPreviewProvenance,
  verifyTransactionFingerprint,
} from '../src/services/previewProvenance.js'
import {
  assertPrivacySafeEvent,
  clearQualityEvents,
  listQualityEvents,
  recordQualityEvent,
  aggregateQualityEvents,
} from '../src/services/qualityMetrics.js'
import { FIXED_EVAL_SET, isLiveEvalAuthorized, runFixedEvalSet } from '../src/services/evalHarness.js'
import {
  rollbackOverwriteOnCandidate,
  runTransactionalMerge,
} from '../src/services/transactionIntegrity.js'
import { interactionOutputSchema } from '../src/schemas/interactionOutput.js'
import { buildInteractionCandidate } from '../src/services/interactionApply.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function main() {
  const matrix = buildCapabilityMatrix()
  assert(matrix.rows.length >= 30, `matrix rows ${matrix.rows.length}`)
  assert(
    matrix.rows.some((r) => r.source === 'blocked-without-manifest'),
    'blocked rows present',
  )
  const holes = assertCapabilityMatrixComplete(matrix)
  assert(holes.length === 0, `capability holes: ${holes.join('; ')}`)

  const fo = loadInteractionFixture('F-order')
  const output = interactionOutputSchema.parse({
    intent: 'interaction',
    summary: 'obs',
    structure: [],
    handlers: [
      {
        id: 'h1',
        target: 'qty',
        eventKey: 'onChange',
        code: 'this.setValue(1)',
        explain: '',
      },
    ],
    scenarios: [
      {
        id: 's1',
        handlerRefs: ['h1'],
        title: 't',
        arrange: {},
        act: [{ input: 'qty', value: 1 }],
        assert: [{ noError: true }, { noNetwork: true }],
      },
    ],
    unsupported: [],
  })

  const preview = buildInteractionCandidate(fo, output)
  assert(preview.ok, 'candidate')
  if (preview.ok) {
    assert(preview.provenance?.structureFingerprint, 'structure fp')
    assert(preview.provenance?.handlerFingerprint, 'handler fp')
    assert(preview.provenance?.scenarioFingerprint, 'scenario fp')
    assert(preview.provenance?.environmentFingerprint, 'env fp')
    assert(preview.provenance?.transactionFingerprint, 'txn fp')
    const report = attachProvenanceToReport(
      {
        runner: 'designer-preview',
        pass: true,
        results: [{ scenarioId: 's1', ok: true }],
      },
      preview.provenance!,
    )
    assert(report.provenance?.scenarioSource, 'scenario source')
  }

  const prov = buildPreviewProvenance({ formJson: fo, output })
  const drift = verifyTransactionFingerprint('0'.repeat(64), fo, output)
  assert(!drift.ok, 'txn drift detected')
  const match = verifyTransactionFingerprint(prov.transactionFingerprint, fo, output)
  assert(match.ok, 'txn match')

  clearQualityEvents()
  const ev = recordQualityEvent({
    stage: 'repair',
    outcome: 'failed',
    failureClass: 'code',
    repairRounds: 1,
    durationMs: 12.6,
    notes: ['https://evil.example/secret', 'Bearer abcdef', 'ok'],
    fingerprints: { form: 'a'.repeat(64) },
  })
  assert(assertPrivacySafeEvent(ev).length === 0, 'privacy safe after redact')
  assert(!JSON.stringify(ev).includes('evil.example'), 'url redacted')
  assert(listQualityEvents().length === 1, 'buffered')
  const agg = aggregateQualityEvents()
  assert(agg.total === 1 && agg.byFailureClass.code === 1, 'aggregate')

  assert(FIXED_EVAL_SET.length >= 4, 'fixed eval set')
  assert(isLiveEvalAuthorized() === false || process.env.AGENT_EVAL_LIVE === '1', 'live gate')
  const evalReport = await runFixedEvalSet({ live: false })
  assert(!evalReport.liveAuthorized, 'mock eval')
  assert(evalReport.results.length === FIXED_EVAL_SET.length, 'all cases ran')
  assert(
    evalReport.results.every((r) => r.ok),
    `eval failures: ${evalReport.results
      .filter((r) => !r.ok)
      .map((r) => `${r.id}:${r.status}:${r.error || ''}`)
      .join('; ')}`,
  )
  assert(typeof evalReport.firstPassRate === 'number', 'firstPassRate')
  assert(typeof evalReport.clarifyRate === 'number', 'clarifyRate')
  assert(typeof evalReport.falsePassRate === 'number', 'falsePassRate')

  const snap = JSON.stringify(fo)
  const faultBefore = runTransactionalMerge({
    currentFormJson: fo,
    output,
    fault: 'throw-before-merge',
  })
  assert(!faultBefore.ok && faultBefore.originalUnchanged, 'fault before keeps original')
  assert(JSON.stringify(fo) === snap, 'caller form untouched')

  const faultFp = runTransactionalMerge({
    currentFormJson: fo,
    output,
    expectedTransactionFingerprint: prov.transactionFingerprint,
    fault: 'fingerprint-drift',
  })
  assert(!faultFp.ok && /fingerprint/i.test(faultFp.error), 'fingerprint fault')

  const faultCorrupt = runTransactionalMerge({
    currentFormJson: fo,
    output,
    confirmOverwrite: true,
    fault: 'corrupt-output-handler',
  })
  assert(!faultCorrupt.ok && faultCorrupt.originalUnchanged, 'corrupt merge rolls back logically')

  const okMerge = runTransactionalMerge({
    currentFormJson: fo,
    output,
    confirmOverwrite: true,
    expectedTransactionFingerprint: prov.transactionFingerprint,
  })
  assert(okMerge.ok && okMerge.originalUnchanged, 'success merge leaves original ref intact')

  const rolled = rollbackOverwriteOnCandidate({
    formJson: okMerge.ok
      ? okMerge.formJson
      : fo,
    rollbacks: [{ target: 'qty', eventKey: 'onChange', previousCode: '/* restored */' }],
  })
  const qty = (rolled.widgetList as any[]).find((w) => w?.options?.name === 'qty')
  assert(String(qty?.options?.onChange || '').includes('restored'), 'overwrite rollback')

  console.log('OBSERVABILITY_T4_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
