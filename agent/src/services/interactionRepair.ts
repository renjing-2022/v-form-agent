import { chatCompletion, type ChatMessage } from './deepseek.js'
import { renderInteractionApiReferenceMarkdown } from '../knowledge/interactionApiReference.js'
import {
  interactionOutputSchema,
  type InteractionOutput,
} from '../schemas/interactionOutput.js'
import type { FormJson } from '../schemas/refinePlan.js'
import { validateInteractionOutput } from './interactionValidate.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'
import { scenarioFingerprint } from './interactionMerger.js'
import type { InteractionVerificationReport } from './interactionApply.js'
import { buildFormSummary } from './formSummary.js'

const MAX_REPAIR_ROUNDS = 2

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('model output is not valid JSON')
  }
}

export type RepairResult =
  | {
      ok: true
      output: InteractionOutput
      round: number
      usedMock: boolean
    }
  | {
      ok: false
      status: 'failed' | 'tamper' | 'error'
      error: string
      round: number
      output: InteractionOutput
    }

/**
 * 修正轮：只允许改 handlers/structure/summary；scenarios 指纹必须不变。
 */
export async function repairInteraction(params: {
  instruction: string
  currentFormJson: FormJson
  previous: InteractionOutput
  verificationReport: InteractionVerificationReport
  round: number
}): Promise<RepairResult> {
  const round = params.round
  if (round > MAX_REPAIR_ROUNDS) {
    return {
      ok: false,
      status: 'failed',
      error: `修正轮次已用尽（最多 ${MAX_REPAIR_ROUNDS}）`,
      round,
      output: params.previous,
    }
  }

  const expectedFp = scenarioFingerprint(params.previous.scenarios)
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  const allowMock = process.env.AGENT_ALLOW_MOCK === '1'

  if (!apiKey) {
    if (!allowMock) {
      return {
        ok: false,
        status: 'error',
        error: 'DEEPSEEK_API_KEY is not configured',
        round,
        output: params.previous,
      }
    }
    // mock：若 previous 已带 repairs 不在此展开；无 Key 时诚实失败（录制 fixture 可在 generator 层处理）
    return {
      ok: false,
      status: 'error',
      error: 'repair requires DEEPSEEK_API_KEY or recorded repair fixture (no template fallback)',
      round,
      output: params.previous,
    }
  }

  const failed = (params.verificationReport.results || []).filter((r) => !r.ok)
  const system = `你是 v-form 交互修复工程师。根据失败的验证报告修正 handlers/structure 中的 JS，禁止修改 scenarios（id/assert/act/arrange/handlerRefs 必须原样返回）。
只输出 JSON：intent、summary、structure、handlers、scenarios、unsupported。
scenarios 必须与输入完全一致。禁止网络请求。
重要：static-text/html-text 禁止 setValue（空操作）；必须 setWidgetOption('textContent', '小计: N')。预览断言读 textContent，不是 getFieldValue。`

  const content = await chatCompletion([
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: params.instruction,
        formSummary: buildFormSummary(params.currentFormJson, params.instruction),
        apiManual: renderInteractionApiReferenceMarkdown(),
        previous: params.previous,
        failedScenarios: failed,
        round,
        note: '只改 code/structure 以通过失败断言；scenarios 原样复制',
      }),
    } satisfies ChatMessage,
  ])

  let raw: unknown
  try {
    raw = extractJsonObject(content)
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      round,
      output: params.previous,
    }
  }

  const parsed = interactionOutputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      status: 'error',
      error: parsed.error.issues.map((i) => i.message).join('; '),
      round,
      output: params.previous,
    }
  }

  const next = parsed.data
  // force keep previous scenarios for fingerprint compare of model output
  const modelFp = scenarioFingerprint(next.scenarios)
  if (modelFp !== expectedFp) {
    return {
      ok: false,
      status: 'tamper',
      error: '修正轮改动了 scenarios（指纹不一致），本轮拒绝',
      round,
      output: params.previous,
    }
  }

  // lock scenarios to previous (byte-stable)
  next.scenarios = params.previous.scenarios

  const issues = validateInteractionOutput(next, params.currentFormJson)
  if (issues.length) {
    return {
      ok: false,
      status: 'error',
      error: issues.map((i) => `${i.path}:${i.message}`).join('; '),
      round,
      output: params.previous,
    }
  }
  const net = checkHandlersNetworkStatic(next.handlers)
  if (!net.ok) {
    return {
      ok: false,
      status: 'error',
      error: net.message,
      round,
      output: params.previous,
    }
  }

  return { ok: true, output: next, round, usedMock: false }
}

export { MAX_REPAIR_ROUNDS, scenarioFingerprint }
