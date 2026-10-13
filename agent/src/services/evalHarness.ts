/**
 * 固定评测集 + 授权真实模型评测入口。
 * 默认 mock/fixture；仅当 AGENT_EVAL_LIVE=1 且存在 DEEPSEEK_API_KEY 时跑真模型。
 */
import { loadInteractionFixture } from '../../fixtures/interaction/forms.js'
import { generateInteraction } from './interactionGenerator.js'
import { clearPendingPlanStore } from './pendingPlanStore.js'
import { recordQualityEvent, aggregateQualityEvents, clearQualityEvents } from './qualityMetrics.js'
import type { FormJson } from '../schemas/refinePlan.js'

export type FixedEvalCase = {
  id: string
  instruction: string
  fixture: 'F-order' | 'F-wizard' | 'F-detail'
  expectStatus: Array<'generated' | 'need_clarification' | 'unsupported' | 'route_refine' | 'error'>
  /** 假通过哨兵：若 status=generated 但 issues 非空则计 falsePass */
  disallowSilentIssues?: boolean
}

export const FIXED_EVAL_SET: FixedEvalCase[] = [
  {
    id: 'eval-amount-linkage',
    instruction: '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
    fixture: 'F-order',
    expectStatus: ['generated'],
    disallowSilentIssues: true,
  },
  {
    id: 'eval-wizard-next',
    instruction: '在每个 tab 下新增一个「下一页」按钮，点击时校验当前 tab',
    fixture: 'F-wizard',
    expectStatus: ['generated'],
    disallowSilentIssues: true,
  },
  {
    id: 'eval-network-reject',
    instruction: '点击提交时 fetch 到后端保存订单',
    fixture: 'F-order',
    expectStatus: ['unsupported', 'need_clarification'],
  },
  {
    id: 'eval-ambiguous-intent',
    instruction: '给那个字段加点交互',
    fixture: 'F-order',
    expectStatus: ['need_clarification'],
  },
]

export type EvalCaseResult = {
  id: string
  status: string
  ok: boolean
  falsePass: boolean
  clarified: boolean
  durationMs: number
  usedMock: boolean
  live: boolean
  error?: string
}

export type EvalReport = {
  liveAuthorized: boolean
  results: EvalCaseResult[]
  firstPassRate: number
  clarifyRate: number
  falsePassRate: number
  /** 真模型修正成功率占位：本 harness 仅 generate 首轮 */
  repairSuccessRate: number | null
  quality: ReturnType<typeof aggregateQualityEvents>
}

function fixtureForm(id: FixedEvalCase['fixture']): FormJson {
  return loadInteractionFixture(id) as FormJson
}

export function isLiveEvalAuthorized(): boolean {
  return process.env.AGENT_EVAL_LIVE === '1' && Boolean(process.env.DEEPSEEK_API_KEY?.trim())
}

export async function runFixedEvalSet(opts?: { live?: boolean }): Promise<EvalReport> {
  const live = Boolean(opts?.live && isLiveEvalAuthorized())
  clearQualityEvents()
  clearPendingPlanStore()

  const savedMock = process.env.AGENT_ALLOW_MOCK
  const savedKey = process.env.DEEPSEEK_API_KEY
  if (!live) {
    process.env.AGENT_ALLOW_MOCK = '1'
    delete process.env.DEEPSEEK_API_KEY
  }

  const results: EvalCaseResult[] = []
  try {
    for (const c of FIXED_EVAL_SET) {
      const started = Date.now()
      try {
        const form = fixtureForm(c.fixture)
        const r = await generateInteraction({
          instruction: c.instruction,
          currentFormJson: form,
          messages: [],
        })
        const durationMs = Date.now() - started
        const status = r.status
        const expectOk = (c.expectStatus as string[]).includes(status)
        const falsePass = Boolean(
          c.disallowSilentIssues && status === 'generated' && (r.issues?.length || r.error),
        )
        const ok = expectOk && !falsePass
        results.push({
          id: c.id,
          status,
          ok,
          falsePass,
          clarified: status === 'need_clarification',
          durationMs,
          usedMock: Boolean(r.usedMock),
          live,
          error: r.error,
        })
        recordQualityEvent({
          stage: 'eval',
          outcome: ok
            ? status === 'need_clarification'
              ? 'need_clarification'
              : 'success'
            : 'failed',
          durationMs,
          notes: [`case:${c.id}`, `status:${status}`],
        })
      } catch (err) {
        const durationMs = Date.now() - started
        results.push({
          id: c.id,
          status: 'error',
          ok: false,
          falsePass: false,
          clarified: false,
          durationMs,
          usedMock: !live,
          live,
          error: err instanceof Error ? err.message : String(err),
        })
        recordQualityEvent({
          stage: 'eval',
          outcome: 'failed',
          durationMs,
          notes: [`case:${c.id}`, 'throw'],
        })
      }
    }
  } finally {
    if (savedMock === undefined) delete process.env.AGENT_ALLOW_MOCK
    else process.env.AGENT_ALLOW_MOCK = savedMock
    if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = savedKey
  }

  const n = results.length || 1
  const firstPass = results.filter((r) => r.ok && r.status === 'generated').length
  const clarify = results.filter((r) => r.clarified).length
  const falsePass = results.filter((r) => r.falsePass).length

  return {
    liveAuthorized: live,
    results,
    firstPassRate: firstPass / n,
    clarifyRate: clarify / n,
    falsePassRate: falsePass / n,
    repairSuccessRate: null,
    quality: aggregateQualityEvents(),
  }
}
