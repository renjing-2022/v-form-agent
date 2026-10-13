/**
 * v0.13 任务组 3：AST 子集、安全前后置、显式覆盖回滚、四选一、合并场景覆盖
 */
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import {
  analyzeSupportedSyntaxSubset,
  applyMergeMode,
  assessEventMergeSafety,
  buildEventConflict,
  buildEventMergeClarifyQuestion,
  wrapMergedCode,
} from '../src/services/eventAstMerge.js'
import {
  applyInteractionOutput,
  collectEventConflicts,
} from '../src/services/interactionMerger.js'
import {
  ensurePostMergeScenarioCoverage,
  collectOverwriteRollbacks,
} from '../src/services/eventMergeScenarios.js'
import { buildInteractionCandidate } from '../src/services/interactionApply.js'
import { interactionOutputSchema } from '../src/schemas/interactionOutput.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  const safe = analyzeSupportedSyntaxSubset('this.setValue(1);\nthis.setLabel("a");')
  assert(safe.ok, 'simple calls in subset')

  const unsafeEval = analyzeSupportedSyntaxSubset('eval("1")')
  assert(!unsafeEval.ok && unsafeEval.reasons.some((r) => /eval/.test(r)), 'eval out of subset')

  const unsafeIf = analyzeSupportedSyntaxSubset('if (x) this.setValue(1)')
  assert(!unsafeIf.ok && unsafeIf.reasons.some((r) => /control_flow/.test(r)), 'if → uncertain')

  const mergeSafe = assessEventMergeSafety('this.setValue(1)', 'this.setLabel("a")')
  assert(mergeSafe.mergeSafe, 'disjoint calls safe')
  assert(mergeSafe.suggestedModes.length === 4, 'four modes when safe')
  assert(mergeSafe.rollbackCode.includes('setValue'), 'rollback keeps existing')

  const conflict = assessEventMergeSafety('return false', 'return true')
  assert(!conflict.mergeSafe, 'return conflict unsafe')
  assert(conflict.suggestedModes.length === 4, 'four modes when unsafe')

  const dyn = assessEventMergeSafety('this[k]=1', 'this.setValue(2)')
  assert(!dyn.mergeSafe, 'dynamic member unsafe')

  const fo = loadInteractionFixture('F-order')
  const qty = fo.widgetList.find((w: any) => w?.options?.name === 'qty') as {
    options?: Record<string, unknown>
  }
  assert(qty?.options, 'qty field')
  qty.options!.onChange = 'this.setLabel("old")'

  const output = interactionOutputSchema.parse({
    intent: 'interaction',
    summary: 'merge demo',
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

  const conflicts = collectEventConflicts(fo, output)
  assert(conflicts.length === 1, 'one conflict')
  assert(conflicts[0].suggestedModes.length === 4, 'conflict offers four')
  assert(conflicts[0].rollbackCode || conflicts[0].existingCode, 'rollback on conflict')

  const q = buildEventMergeClarifyQuestion(conflicts[0])
  assert(q.options.length === 4, 'clarify four options')
  assert(q.options.every((o) => ['prepend', 'append', 'overwrite', 'cancel'].includes(String(o.value))), 'mode values')

  const rejected = applyInteractionOutput(fo, output, {})
  assert(!rejected.ok, 'no resolution → reject')

  const appended = applyInteractionOutput(fo, output, {
    eventResolutions: [{ target: 'qty', eventKey: 'onChange', mode: 'append' }],
  })
  assert(appended.ok, 'safe append ok')
  if (appended.ok) {
    const code = String((appended.formJson.widgetList.find((w: any) => w?.options?.name === 'qty') as any)?.options?.onChange || '')
    assert(code.includes('/* --- existing --- */') && code.includes('setValue(2)'), 'append wrapped')
  }

  const forced = applyMergeMode('prepend', 'if (a) return 1', 'this.setValue(9)', { force: true })
  assert(forced.ok && 'code' in forced && forced.code.includes('setValue(9)'), 'force prepend allowed')

  const unsafeNoForce = applyMergeMode('prepend', 'if (a) return 1', 'this.setValue(9)')
  assert(!unsafeNoForce.ok, 'unsafe prepend without force fails')

  const overwritten = applyInteractionOutput(fo, output, {
    eventResolutions: [{ target: 'qty', eventKey: 'onChange', mode: 'overwrite' }],
  })
  assert(overwritten.ok && overwritten.overwriteRollbacks?.length === 1, 'overwrite keeps rollback')
  assert(
    overwritten.ok && overwritten.overwriteRollbacks![0].previousCode.includes('setLabel'),
    'rollback previousCode',
  )

  const coverage = ensurePostMergeScenarioCoverage(output, conflicts, [
    { target: 'qty', eventKey: 'onChange', mode: 'append' },
  ])
  assert(coverage.added.some((id) => id.startsWith('legacy-smoke-')), 'legacy smoke added')
  assert(
    coverage.output.scenarios.some((s) => s.id.startsWith('legacy-smoke-')),
    'smoke in scenarios',
  )

  const rolls = collectOverwriteRollbacks(conflicts, [
    { target: 'qty', eventKey: 'onChange', mode: 'overwrite' },
  ])
  assert(rolls.length === 1 && rolls[0].previousCode.includes('setLabel'), 'collect rollbacks')

  const preview = buildInteractionCandidate(fo, output)
  assert(preview.ok, 'candidate ok')
  if (preview.ok) {
    assert(preview.eventConflicts?.length === 1, 'candidate conflicts')
    assert(preview.eventMergeClarification?.questions?.length === 1, 'four-choice clarification')
    assert(
      preview.warnings.some((w) => w.includes('preview-auto-append-safe') || w.includes('legacy-smoke')),
      'safe preview prefers append / smoke',
    )
  }

  const wrapped = wrapMergedCode('append', 'a()', 'b()')
  assert(wrapped.includes('/* --- existing --- */'), 'wrap marker')

  console.log('EVENT_MERGE_T3_OK')
}

main()
