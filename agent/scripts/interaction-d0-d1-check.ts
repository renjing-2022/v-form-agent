/**
 * v0.9 D0–D4 服务端快速校验（不全量跑旧版 acceptance）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkInteractionApiReferenceParity } from '../src/knowledge/interactionApiReference.js'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import { interactionOutputSchema } from '../src/schemas/interactionOutput.js'
import { generateInteraction } from '../src/services/interactionGenerator.js'
import { validateInteractionOutput } from '../src/services/interactionValidate.js'
import { checkInteractionNetworkStatic } from '../src/services/interactionNetworkPolicy.js'
import { applyInteractionOutput, scenarioFingerprint } from '../src/services/interactionMerger.js'
import {
  planInteractionApply,
  recomputeInteractionVerification,
} from '../src/services/interactionApply.js'
import { MAX_REPAIR_ROUNDS } from '../src/services/interactionRepair.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'
  const savedKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY

  const parity = checkInteractionApiReferenceParity(root)
  assert(parity.length === 0, parity.join('; '))

  const fo = loadInteractionFixture('F-order')
  const fw = loadInteractionFixture('F-wizard')
  assert(fo.widgetList.length >= 10, 'F-order')

  assert(
    !interactionOutputSchema.safeParse({
      intent: 'interaction',
      handlers: [{ target: 'a', eventKey: 'onChange', code: 1 }],
    }).success,
    'schema reject',
  )

  const unknown = interactionOutputSchema.parse({
    intent: 'interaction',
    summary: 'x',
    handlers: [{ id: 'h1', target: 'ghost', eventKey: 'onChange', code: '1', explain: '' }],
    scenarios: [
      { id: 's1', handlerRefs: ['h1'], title: 't', arrange: {}, act: [], assert: [{ noError: true }] },
    ],
  })
  assert(
    validateInteractionOutput(unknown, fo).some((i) => i.message.includes('unknown target')),
    'unknown target',
  )

  const miss = await generateInteraction({
    instruction: 'XYZ-NO-FIXTURE-999',
    currentFormJson: fo,
  })
  assert(miss.status === 'error', 'no fixture error')

  const route = await generateInteraction({
    instruction: '把备注改成多行文本',
    currentFormJson: fo,
  })
  assert(route.status === 'route_refine', 'route refine')

  const amount = await generateInteraction({
    instruction: '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
    currentFormJson: fo,
  })
  assert(amount.status === 'generated' && amount.usedMock, 'amount replay')
  assert(amount.formJsonCandidate, 'amount candidate')

  assert(checkInteractionNetworkStatic('this.getFormRef().setFieldValue("a",1)').ok, 'pure ok')
  const fetchHit = checkInteractionNetworkStatic('fetch("/api")')
  assert(!fetchHit.ok && fetchHit.reason === 'network', 'fetch blocked')

  // D3: addButton eachTabPane + handlers transaction
  const wizardGen = await generateInteraction({
    instruction: '在每个 tab 下新增一个「下一页」按钮，点击时校验当前 tab',
    currentFormJson: fw,
  })
  assert(wizardGen.status === 'generated', 'wizard gen')
  assert(wizardGen.formJsonCandidate, 'wizard candidate')
  const buttons = JSON.stringify(wizardGen.formJsonCandidate)
  assert(buttons.includes('btnNext__tab1') && buttons.includes('下一页'), 'buttons in each tab')

  const originalWizard = JSON.stringify(fw)
  const badMerge = applyInteractionOutput(fw, {
    ...wizardGen.output,
    handlers: [
      ...wizardGen.output.handlers,
      {
        id: 'bad',
        target: 'missing_btn',
        eventKey: 'onClick',
        code: '1',
        explain: '',
      },
    ],
  })
  assert(!badMerge.ok, 'bad merge fails')
  assert(JSON.stringify(fw) === originalWizard, 'transaction: original form untouched')

  // D4: apply forged report → draft
  const forged = planInteractionApply({
    currentFormJson: fo,
    output: amount.output,
    userConfirmed: true,
    confirmOverwrite: true,
    verificationReport: {
      runner: 'designer-preview',
      pass: true,
      results: amount.output.scenarios.map((s) => ({
        scenarioId: s.id,
        ok: true,
        actual: { noError: true },
      })),
    },
  })
  // amount asserts need field values — forged incomplete actual should fail recompute
  assert(forged.response.status === 'draft' || forged.response.applied === false, 'forged/incomplete → not applied blindly')
  const recomputed = recomputeInteractionVerification(
    {
      runner: 'designer-preview',
      pass: true,
      results: amount.output.scenarios.map((s) => ({
        scenarioId: s.id,
        ok: true,
        actual: { noError: true, noNetwork: true },
      })),
    },
    amount.output.scenarios,
  )
  // s1 expects amount=100 — should fail
  assert(!recomputed.pass, 'recompute rejects incomplete actual vs expect')

  const goodReport = recomputeInteractionVerification(
    {
      runner: 'designer-preview',
      pass: false,
      results: [
        {
          scenarioId: 's1',
          ok: false,
          actual: {
            'field:amount': 100,
            'field:pay': 100,
            noNetwork: true,
            noError: true,
          },
        },
        {
          scenarioId: 's2',
          ok: false,
          actual: { 'field:pay': 90, noError: true },
        },
      ],
    },
    amount.output.scenarios,
  )
  assert(goodReport.pass, 'recompute accepts matching actual')

  const applied = planInteractionApply({
    currentFormJson: fo,
    output: amount.output,
    userConfirmed: true,
    confirmOverwrite: true,
    verificationReport: goodReport,
  })
  assert(applied.response.status === 'applied' && applied.response.applied, 'apply ok')
  assert(
    String((applied.response.formJson.widgetList[0] as { options?: { onChange?: string } }).options?.onChange || '').includes(
      'getFormRef',
    ),
    'onChange written',
  )

  const noConfirm = planInteractionApply({
    currentFormJson: fo,
    output: amount.output,
    userConfirmed: false,
    verificationReport: goodReport,
  })
  assert(noConfirm.response.status === 'draft', 'no confirm → draft')

  // repair tamper fingerprint
  const fp1 = scenarioFingerprint(amount.output.scenarios)
  const tampered = {
    ...amount.output,
    scenarios: amount.output.scenarios.map((s, i) =>
      i === 0 ? { ...s, assert: [{ noError: true } as const] } : s,
    ),
  }
  assert(scenarioFingerprint(tampered.scenarios) !== fp1, 'tamper changes fingerprint')
  assert(MAX_REPAIR_ROUNDS === 2, 'max repair rounds')

  if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
  console.log('INTERACTION_D0_D4_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
