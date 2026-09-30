/**
 * v0.10 Ask-before-act 契约与策略快速校验
 */
import {
  clarificationPayloadSchema,
  deriveQuestionsFromClarification,
  makeConfirmQuestion,
  validateClarificationAnswers,
  RISK_CODES,
} from '../src/schemas/clarification.js'
import { interactionRequestSchema } from '../src/schemas/interactionOutput.js'
import { computeFormFingerprint, stableStringify } from '../src/services/formFingerprint.js'
import {
  checkRiskPolicyParity,
  runRiskPolicyFixtureChecks,
  assessInteractionRisk,
} from '../src/services/interactionRiskPolicy.js'
import { assessEventMergeSafety, wrapMergedCode, applyMergeMode } from '../src/services/eventAstMerge.js'
import { applyInteractionOutput, collectEventConflicts } from '../src/services/interactionMerger.js'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import { generateInteraction } from '../src/services/interactionGenerator.js'
import { clearPendingPlanStore } from '../src/services/pendingPlanStore.js'
import { clarifyInteraction } from '../src/services/interactionClarify.js'
import {
  buildClarificationFromNeedClarification,
  listFormWidgetOptions,
  rewriteClarificationQuestion,
} from '../src/services/clarificationOptionRewrite.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function formFieldNamesHas(formJson: unknown, name: string): boolean {
  const walk = (nodes: any[] | undefined): boolean => {
    if (!nodes) return false
    for (const n of nodes) {
      if (String(n?.options?.name || '') === name || n?.id === name) return true
      if (walk(n.widgetList) || walk(n.tabs) || walk(n.cols)) return true
      if (Array.isArray(n.rows)) {
        for (const row of n.rows) {
          if (walk(row.cols) || walk(row.widgetList)) return true
        }
      }
    }
    return false
  }
  return walk((formJson as { widgetList?: any[] }).widgetList)
}

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'
  delete process.env.DEEPSEEK_API_KEY
  clearPendingPlanStore()

  const parity = checkRiskPolicyParity()
  assert(parity.length === 0, parity.join('; '))
  assert(RISK_CODES.includes('event_overwrite'), 'codes')

  const fo = loadInteractionFixture('F-order')
  const fp1 = computeFormFingerprint(fo)
  const fp2 = computeFormFingerprint(JSON.parse(JSON.stringify(fo)))
  assert(fp1 === fp2, 'fingerprint stable')
  assert(fp1.length === 64, 'sha256 hex')
  assert(stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }), 'stable keys')

  const fixtureIssues = runRiskPolicyFixtureChecks(fo)
  assert(fixtureIssues.length === 0, fixtureIssues.join('\n'))

  const q = makeConfirmQuestion({
    id: 'q1',
    prompt: '确认上传？',
    riskCode: 'upload_config',
  })
  const clarification = clarificationPayloadSchema.parse({
    protocol: 'structured-clarify-v1',
    questions: [q],
  })
  const derived = deriveQuestionsFromClarification(clarification)
  assert(derived?.[0] === '确认上传？', 'derive questions')

  const ansOk = validateClarificationAnswers(clarification.questions, [
    { questionId: 'q1', confirmed: true },
  ])
  assert(ansOk.ok, 'answer ok')
  const ansBad = validateClarificationAnswers(clarification.questions, [])
  assert(!ansBad.ok, 'answer required')

  assert(
    interactionRequestSchema.safeParse({
      action: 'clarify',
      pendingPlanId: 'plan_x',
      formFingerprint: fp1,
      currentFormJson: fo,
      answers: [{ questionId: 'q1', confirmed: true }],
    }).success,
    'clarify request schema',
  )

  const mergeSafe = assessEventMergeSafety('this.setValue(1)', 'this.setLabel("a")')
  assert(mergeSafe.mergeSafe, 'merge safe')
  assert(mergeSafe.suggestedModes.includes('append'), 'suggest append')
  const conflictMerge = assessEventMergeSafety('return false', 'return true')
  assert(!conflictMerge.mergeSafe, 'return conflict')

  const wrapped = wrapMergedCode('append', 'a()', 'b()')
  assert(wrapped.includes('/* --- existing --- */'), 'wrap')
  assert(applyMergeMode('cancel', 'a', 'b').ok === false, 'cancel skip')

  // Catalog / 表单选项重写
  const formOpts = listFormWidgetOptions(fo)
  assert(formOpts.some((o) => o.value === 'form'), 'form option')
  assert(formOpts.length > 3, 'widget options from form')
  const realName = String(formOpts.find((o) => o.value !== 'form')!.value)
  const forged = rewriteClarificationQuestion(
    {
      id: 'q_forged',
      type: 'single_choice',
      prompt: '改哪个字段？',
      required: true,
      options: [
        { id: 'fake1', label: '幽灵字段', value: 'ghost_field_xyz' },
        { id: 'fake2', label: '真实', value: realName },
      ],
      binds: { slot: 'target.widget' },
    },
    fo,
  )
  assert(
    forged.options?.every((o) => o.value === 'form' || formFieldNamesHas(fo, String(o.value))),
    'forged options rewritten to form truth',
  )
  assert(!forged.options?.some((o) => o.value === 'ghost_field_xyz'), 'ghost removed')

  const fromStrings = buildClarificationFromNeedClarification({
    formJson: fo,
    instruction: '给那个字段加点交互',
    questions: ['触发条件是什么（改哪个字段/点哪个按钮）？', '期望发生什么？'],
  })
  assert(fromStrings.questions[0].binds?.slot === 'target.widget', 'string→widget choice')
  assert((fromStrings.questions[0].options?.length || 0) >= 2, 'widget options present')
  assert(fromStrings.questions.some((x) => x.type === 'text'), 'other stays text')

  // L1 明确指令不追问
  const amount = await generateInteraction({
    instruction: '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
    currentFormJson: fo,
  })
  assert(amount.status === 'generated', `L1 generated got ${amount.status}`)
  assert(!amount.clarification, 'L1 no clarification')

  // 歧义 → structured + 表单 options
  const amb = await generateInteraction({
    instruction: '给那个字段加点交互',
    currentFormJson: fo,
  })
  assert(amb.status === 'need_clarification', `amb got ${amb.status}`)
  assert(amb.clarification?.protocol === 'structured-clarify-v1', 'amb protocol')
  assert(amb.pendingPlan?.id, 'amb pending')
  const widgetQ = amb.clarification!.questions.find((x) => x.binds?.slot === 'target.widget')
  assert(widgetQ, 'amb has widget question')
  assert(
    widgetQ!.options?.every((o) => o.value === 'form' || formFieldNamesHas(fo, String(o.value))),
    'amb options from form',
  )

  // L2 上传需确认
  const upload = await generateInteraction({
    instruction: '给表单加一个上传头像',
    currentFormJson: fo,
  })
  assert(upload.status === 'need_clarification', `upload clarify got ${upload.status}`)
  assert(upload.pendingPlan?.id, 'pending plan')
  assert(upload.clarification?.protocol === 'structured-clarify-v1', 'protocol')

  // fingerprint 漂移 → plan_expired
  const expired = await clarifyInteraction({
    pendingPlanId: upload.pendingPlan!.id,
    formFingerprint: '0'.repeat(64),
    currentFormJson: fo,
    answers: [{ questionId: upload.clarification!.questions[0].id, confirmed: true }],
  })
  assert(expired.status === 'plan_expired', `expired got ${expired.status}`)

  // L3 网络 JS
  const net = assessInteractionRisk({
    instruction: 'onChange 里 fetch("/api") 拉数据',
    formJson: fo,
  })
  assert(net.reject && net.riskFacts.some((f) => f.code === 'network_js'), 'network L3')

  // 事件冲突与 apply 门禁
  const form = JSON.parse(JSON.stringify(fo))
  const name = String(
    (form.widgetList as Array<{ options?: { name?: string } }>).find((w) => w.options?.name)?.options
      ?.name || 'qty',
  )
  const targetWidget = (form.widgetList as Array<{ options?: Record<string, unknown> }>).find(
    (w) => w.options?.name === name,
  )
  if (targetWidget?.options) targetWidget.options.onChange = 'console.log("old")'
  const output = {
    intent: 'interaction' as const,
    summary: 'x',
    structure: [] as [],
    handlers: [
      { id: 'h1', target: name, eventKey: 'onChange', code: 'this.setValue(2)', explain: '' },
    ],
    scenarios: [
      {
        id: 's1',
        handlerRefs: ['h1'],
        title: 't',
        arrange: {},
        act: [] as [],
        assert: [{ noError: true as const }],
      },
    ],
    unsupported: [] as [],
  }

  const conflicts = collectEventConflicts(form, output as any)
  assert(conflicts.length === 1, 'one conflict')
  const rejected = applyInteractionOutput(form, output as any, {})
  assert(!rejected.ok, 'reject without resolution')
  const applied = applyInteractionOutput(form, output as any, {
    eventResolutions: [{ target: name, eventKey: 'onChange', mode: 'overwrite' }],
  })
  assert(applied.ok, 'overwrite ok')
  const cancelled = applyInteractionOutput(form, output as any, {
    eventResolutions: [{ target: name, eventKey: 'onChange', mode: 'cancel' }],
  })
  assert(!cancelled.ok, 'all cancel no write')

  const viaFlag = applyInteractionOutput(form, output as any, { confirmOverwrite: true })
  assert(viaFlag.ok, 'confirmOverwrite shortcut')

  console.log('ask-before-act-check: ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
