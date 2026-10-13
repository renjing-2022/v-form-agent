import {
  scenarioCriticInputSchema,
  type ScenarioCriticInput,
  type ScenarioCriticVerdict,
  type CriticFinding,
  type RepairRoute,
} from '../schemas/autonomyCritic.js'
import { hashPayload } from './attemptLedger.js'
import { collectFormNames, collectPlannedCreates } from './interactionValidate.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import type { FormJson } from '../schemas/refinePlan.js'
import { computeFormFingerprint } from './formFingerprint.js'

function pickRoute(findings: CriticFinding[]): RepairRoute {
  if (!findings.length) return 'repair_code'
  if (findings.some((f) => f.code.startsWith('intent_'))) return 'clarify'
  if (findings.some((f) => f.code.startsWith('structure_'))) return 'replan'
  return 'replan'
}

function fieldsFromScenario(sc: {
  arrange?: Record<string, unknown>
  act?: Array<Record<string, unknown>>
  assert?: Array<Record<string, unknown>>
}): string[] {
  const out = new Set<string>()
  const values = sc.arrange?.values
  if (values && typeof values === 'object') {
    for (const k of Object.keys(values as Record<string, unknown>)) out.add(k)
  }
  for (const step of sc.act || []) {
    for (const key of [
      'input',
      'clear',
      'select',
      'toggle',
      'rate',
      'slide',
      'pickDate',
      'pickTime',
      'click',
      'addSubFormRow',
    ] as const) {
      if (typeof step[key] === 'string') out.add(String(step[key]))
    }
  }
  for (const a of sc.assert || []) {
    if (typeof a.field === 'string') out.add(a.field)
    if (typeof a.focused === 'string') out.add(a.focused)
    if (typeof a.subFormRows === 'string') out.add(a.subFormRows)
    if (typeof a.dialogVisible === 'string') out.add(a.dialogVisible)
  }
  return [...out]
}

/**
 * 独立 Scenario Critic：检查场景引用与覆盖完备性。
 * 不把 generator 的 assert 期望值当作正确答案。
 */
export function runScenarioCritic(raw: ScenarioCriticInput): ScenarioCriticVerdict {
  const input = scenarioCriticInputSchema.parse(raw)
  const findings: CriticFinding[] = []
  const known = new Set(input.knownTargets)
  const handlerIds = new Set(input.handlerIds)

  if (input.handlerIds.length > 0 && input.scenarios.length === 0) {
    findings.push({
      code: 'structure_scenario_missing',
      message: '存在 handlers 但无验收场景，无法独立验证',
    })
  }

  for (const sc of input.scenarios) {
    if (!sc.id) {
      findings.push({
        code: 'structure_scenario_id',
        message: '场景缺少 id',
      })
    }
    if (sc.assertCount < 1) {
      findings.push({
        code: 'structure_scenario_assert',
        message: `场景 ${sc.id || '?'} 缺少 assert`,
        path: `scenarios.${sc.id}`,
      })
    }
    for (const ref of sc.handlerRefs) {
      if (handlerIds.size === 0) continue
      const matched =
        handlerIds.has(ref) ||
        [...handlerIds].some((id) => id.startsWith(`${ref}@`) || id.includes(`@${ref}`)) ||
        known.has(ref)
      if (!matched) {
        findings.push({
          code: 'structure_handler_ref',
          message: `场景 ${sc.id} 引用未知 handler ${ref}`,
          path: `scenarios.${sc.id}.handlerRefs`,
        })
      }
    }
    for (const field of sc.referencedFields) {
      if (field === 'form') continue
      if (!known.has(field)) {
        findings.push({
          code: 'structure_scenario_field',
          message: `场景 ${sc.id} 引用未知字段 ${field}`,
          path: `scenarios.${sc.id}`,
        })
      }
    }
  }

  const intent = input.intentSummary.toLowerCase()
  const needsBehavior =
    /点击|联动|计算|校验|显示|隐藏|禁用|合计|求和|tab|切换|提交|必填/.test(intent) ||
    /click|change|sum|validate|disable|hide|show|tab|submit/.test(intent)
  if (needsBehavior && input.scenarios.length === 0 && input.handlerIds.length === 0) {
    findings.push({
      code: 'intent_no_plan',
      message: '意图像交互行为，但计划中无 handler/scenario',
    })
  }

  const route = findings.length ? pickRoute(findings) : 'repair_code'
  return {
    critic: 'scenario',
    pass: findings.length === 0,
    route: findings.length === 0 ? 'repair_code' : route,
    findings,
    fingerprint: hashPayload({
      critic: 'scenario',
      intentSummary: input.intentSummary,
      formFingerprint: input.formFingerprint,
      scenarios: input.scenarios,
      findings,
    }),
  }
}

export function buildScenarioCriticInput(params: {
  instruction: string
  formJson: FormJson
  output: InteractionOutput
}): ScenarioCriticInput {
  const { names, ids } = collectFormNames(params.formJson)
  const planned = collectPlannedCreates(params.output, params.formJson)
  const handlerIds = (params.output.handlers || [])
    .map((h, i) => h.id || `${h.target}@${h.eventKey}#${i}`)
    .filter(Boolean)

  return scenarioCriticInputSchema.parse({
    intentSummary: params.instruction.trim().slice(0, 2000),
    formFingerprint: computeFormFingerprint(params.formJson),
    knownTargets: [...names, ...ids, ...planned.names, 'form'],
    handlerIds,
    scenarios: (params.output.scenarios || []).map((sc) => ({
      id: sc.id,
      title: sc.title,
      handlerRefs: sc.handlerRefs || [],
      actCount: (sc.act || []).length,
      assertCount: (sc.assert || []).length,
      referencedFields: fieldsFromScenario(sc),
    })),
  })
}
