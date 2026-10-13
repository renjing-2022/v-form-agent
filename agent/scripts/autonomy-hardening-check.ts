/**
 * v0.13 任务组 1：Critic 契约、失败分类路由、fingerprint/budget
 */
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import { interactionOutputSchema } from '../src/schemas/interactionOutput.js'
import {
  failureClassSchema,
  planCriticInputSchema,
  repairDecisionSchema,
  scenarioCriticInputSchema,
} from '../src/schemas/autonomyCritic.js'
import { buildPlanCriticInput, runPlanCritic } from '../src/services/planCritic.js'
import { buildScenarioCriticInput, runScenarioCritic } from '../src/services/scenarioCritic.js'
import { classifyInteractionFailure } from '../src/services/failureClassify.js'
import {
  candidateFingerprint,
  failureFingerprint,
  isDuplicateAttempt,
  normalizeAttemptLedger,
  recordAttempt,
} from '../src/services/attemptLedger.js'
import { commitRepairAttempt, routeRepairAttempt } from '../src/services/repairRouter.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  assert(failureClassSchema.options.length === 5, '5 failure classes')

  const fo = loadInteractionFixture('F-order')
  const good = interactionOutputSchema.parse({
    intent: 'interaction',
    summary: 'qty * price',
    structure: [],
    handlers: [
      {
        id: 'h1',
        target: 'qty',
        eventKey: 'onChange',
        code: "const f=getFormRef(); f.setFieldValue('amount', (Number(f.getFieldValue('qty'))||0)*(Number(f.getFieldValue('price'))||0))",
        explain: 'calc',
      },
    ],
    scenarios: [
      {
        id: 's1',
        title: 'calc',
        handlerRefs: ['h1'],
        arrange: { values: { qty: 2, price: 50 } },
        act: [{ input: 'qty', value: 2 }],
        assert: [{ field: 'amount', value: 100 }, { noNetwork: true }],
      },
    ],
    unsupported: [],
  })

  const planIn = buildPlanCriticInput({
    instruction: '数量乘单价写入金额',
    formJson: fo,
    output: good,
  })
  planCriticInputSchema.parse(planIn)
  const planOk = runPlanCritic(planIn)
  assert(planOk.pass, `plan critic should pass: ${planOk.findings.map((f) => f.message).join(';')}`)
  assert(planOk.critic === 'plan', 'plan critic tag')

  const scIn = buildScenarioCriticInput({
    instruction: '数量乘单价写入金额',
    formJson: fo,
    output: good,
  })
  scenarioCriticInputSchema.parse(scIn)
  const scOk = runScenarioCritic(scIn)
  assert(scOk.pass, `scenario critic should pass: ${scOk.findings.map((f) => f.message).join(';')}`)

  const badTarget = interactionOutputSchema.parse({
    ...good,
    handlers: [{ ...good.handlers[0], target: 'no_such_field' }],
  })
  const planBad = runPlanCritic(
    buildPlanCriticInput({
      instruction: '改不存在字段',
      formJson: fo,
      output: badTarget,
    }),
  )
  assert(!planBad.pass, 'plan critic catches missing target')
  assert(planBad.route === 'replan', 'missing target → replan')

  const noScenario = interactionOutputSchema.parse({
    ...good,
    scenarios: [],
  })
  const scBad = runScenarioCritic(
    buildScenarioCriticInput({
      instruction: '点击按钮联动',
      formJson: fo,
      output: noScenario,
    }),
  )
  assert(!scBad.pass, 'scenario critic catches missing scenarios')

  const infraReport = {
    runner: 'designer-preview' as const,
    pass: false,
    results: [{ scenarioId: 's1', ok: false, unverifiable: true, error: 'unverifiable location' }],
  }
  const infra = classifyInteractionFailure({
    verificationReport: infraReport,
    output: good,
  })
  assert(infra.class === 'infrastructure', 'unverifiable → infrastructure')
  assert(infra.route === 'blocked', 'infra → blocked')
  assert(!infra.consumeBusinessBudget, 'infra does not consume budget')

  const codeReport = {
    runner: 'designer-preview' as const,
    pass: false,
    results: [{ scenarioId: 's1', ok: false, error: 'assert failed: field:amount', actual: { 'field:amount': 0 } }],
  }
  const codeCls = classifyInteractionFailure({
    verificationReport: codeReport,
    output: good,
  })
  assert(codeCls.class === 'code', 'assert fail → code')
  assert(codeCls.route === 'repair_code', 'code → repair_code')

  const structReport = {
    runner: 'designer-preview' as const,
    pass: false,
    results: [{ scenarioId: 's1', ok: false, error: 'unknown target widget foo' }],
  }
  const structCls = classifyInteractionFailure({
    verificationReport: structReport,
    output: good,
  })
  assert(structCls.class === 'structure', 'unknown target → structure')
  assert(structCls.route === 'replan', 'structure → replan')

  const first = routeRepairAttempt({
    formJson: fo,
    output: good,
    verificationReport: codeReport,
  })
  assert(first.allowProceed, 'first code repair allowed')
  repairDecisionSchema.parse(first.decision)
  const after = commitRepairAttempt(first.ledger, first.decision)
  assert(after.codeAttempts === 1, 'code attempt recorded')
  assert(after.seenAttemptFingerprints.includes(first.decision.attemptFingerprint), 'fp recorded')

  const dup = routeRepairAttempt({
    formJson: fo,
    output: good,
    verificationReport: codeReport,
    attemptFingerprints: after.seenAttemptFingerprints,
    codeAttempts: after.codeAttempts,
  })
  assert(!dup.allowProceed, 'duplicate blocked')
  assert(dup.decision.duplicate, 'duplicate flag')
  assert(dup.decision.route === 'blocked', 'duplicate → blocked')

  const infraRoute = routeRepairAttempt({
    formJson: fo,
    output: good,
    verificationReport: infraReport,
  })
  assert(!infraRoute.allowProceed, 'infra not repair_code')
  assert(infraRoute.decision.class === 'infrastructure', 'infra class')
  assert(infraRoute.decision.ledger.codeAttempts === 0, 'infra no code budget')

  const cand = candidateFingerprint(good)
  const fail = failureFingerprint(codeReport)
  assert(cand.length === 64 && fail.length === 64, 'sha256 fps')

  let ledger = normalizeAttemptLedger([])
  ledger = recordAttempt(ledger, {
    attemptFingerprint: 'a'.repeat(64),
    route: 'repair_code',
    consumeBusinessBudget: true,
  })
  assert(isDuplicateAttempt(ledger, 'a'.repeat(64)), 'ledger duplicate detect')
  assert(!isDuplicateAttempt(ledger, 'b'.repeat(64)), 'new fp not duplicate')

  console.log('AUTONOMY_HARDENING_T1_OK')
}

main()
