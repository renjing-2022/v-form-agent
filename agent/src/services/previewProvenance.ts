import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import { computeFormFingerprint } from './formFingerprint.js'
import { hashPayload, candidateFingerprint } from './attemptLedger.js'
import { scenarioFingerprint } from './interactionMerger.js'
import { buildFormIndex } from './formIndex.js'

export type PreviewProvenance = {
  structureFingerprint: string
  handlerFingerprint: string
  scenarioFingerprint: string
  scenarioSource: 'generator' | 'repair' | 'legacy-smoke' | 'mixed' | 'unknown'
  environmentFingerprint: string
  formFingerprint: string
  /** form ⊕ candidate 事务指纹，apply 前再验 */
  transactionFingerprint: string
}

export type InteractionVerificationReportWithProvenance = {
  runner: 'designer-preview' | 'playwright'
  results: Array<{
    scenarioId: string
    ok: boolean
    actual?: Record<string, unknown>
    error?: string
    unverifiable?: boolean
  }>
  pass: boolean
  networkHits?: string[]
  errors?: string[]
  provenance?: PreviewProvenance
}

export function structureFingerprint(formJson: FormJson): string {
  const index = buildFormIndex(formJson)
  return index.fingerprint
}

export function handlerFingerprint(output: InteractionOutput): string {
  return hashPayload(
    (output.handlers || []).map((h) => ({
      target: h.target,
      eventKey: h.eventKey,
      // 仅长度与粗哈希，不落完整代码
      codeSha: hashPayload(h.code).slice(0, 16),
      codeLen: h.code.length,
    })),
  )
}

export function environmentFingerprint(params?: {
  runner?: 'designer-preview' | 'playwright'
  allowMock?: boolean
}): string {
  return hashPayload({
    runner: params?.runner || 'designer-preview',
    node: typeof process !== 'undefined' ? process.version : 'browser',
    allowMock: params?.allowMock ?? process.env.AGENT_ALLOW_MOCK === '1',
    hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    // 不记录 key / 路径 / 用户数据
  })
}

export function inferScenarioSource(output: InteractionOutput): PreviewProvenance['scenarioSource'] {
  const ids = (output.scenarios || []).map((s) => s.id)
  const hasLegacy = ids.some((id) => id.startsWith('legacy-smoke-'))
  const hasOther = ids.some((id) => !id.startsWith('legacy-smoke-'))
  if (hasLegacy && hasOther) return 'mixed'
  if (hasLegacy) return 'legacy-smoke'
  if (ids.length) return 'generator'
  return 'unknown'
}

export function computeTransactionFingerprint(params: {
  formJson: FormJson
  output: InteractionOutput
}): string {
  return hashPayload({
    form: computeFormFingerprint(params.formJson),
    candidate: candidateFingerprint(params.output),
  })
}

export function buildPreviewProvenance(params: {
  formJson: FormJson
  output: InteractionOutput
  formJsonCandidate?: FormJson
  runner?: 'designer-preview' | 'playwright'
  scenarioSource?: PreviewProvenance['scenarioSource']
}): PreviewProvenance {
  const candidateForm = params.formJsonCandidate || params.formJson
  return {
    structureFingerprint: structureFingerprint(candidateForm),
    handlerFingerprint: handlerFingerprint(params.output),
    scenarioFingerprint: scenarioFingerprint(params.output.scenarios || []),
    scenarioSource: params.scenarioSource || inferScenarioSource(params.output),
    environmentFingerprint: environmentFingerprint({ runner: params.runner }),
    formFingerprint: computeFormFingerprint(params.formJson),
    transactionFingerprint: computeTransactionFingerprint({
      formJson: params.formJson,
      output: params.output,
    }),
  }
}

export function attachProvenanceToReport(
  report: InteractionVerificationReportWithProvenance,
  provenance: PreviewProvenance,
): InteractionVerificationReportWithProvenance {
  return { ...report, provenance }
}

/** apply 前再验事务指纹；不匹配则拒绝 */
export function verifyTransactionFingerprint(
  expected: string | undefined,
  formJson: FormJson,
  output: InteractionOutput,
): { ok: true } | { ok: false; error: string; actual: string } {
  const actual = computeTransactionFingerprint({ formJson, output })
  if (!expected) return { ok: true } // 旧客户端兼容：未携带时跳过
  if (expected !== actual) {
    return {
      ok: false,
      error: 'transaction fingerprint mismatch — canvas or candidate drifted; refuse apply',
      actual,
    }
  }
  return { ok: true }
}
