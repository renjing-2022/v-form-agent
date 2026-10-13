/**
 * 脱敏质量指标：阶段、失败类、修正次数、能力缺口、耗时。
 * 禁止记录表单值、凭据、完整代码、敏感 endpoint。
 */
import type { FailureClass } from '../schemas/autonomyCritic.js'

export type QualityStage =
  | 'generate'
  | 'clarify'
  | 'preview'
  | 'repair'
  | 'apply'
  | 'critic'
  | 'eval'

export type QualityOutcome =
  | 'success'
  | 'need_clarification'
  | 'failed'
  | 'rejected'
  | 'blocked'
  | 'skipped'

export type QualityMetricEvent = {
  ts: string
  stage: QualityStage
  outcome: QualityOutcome
  failureClass?: FailureClass
  repairRounds?: number
  durationMs?: number
  capabilityGaps?: string[]
  /** 仅短哈希 / 枚举，无敏感载荷 */
  fingerprints?: {
    form?: string
    candidate?: string
    failure?: string
    transaction?: string
  }
  notes?: string[]
}

const SENSITIVE_KEY = /(password|token|secret|authorization|cookie|credential|api[_-]?key|endpoint|url)/i
const MAX_BUFFER = 200

const buffer: QualityMetricEvent[] = []

function redactNotes(notes: string[] | undefined): string[] | undefined {
  if (!notes?.length) return undefined
  return notes
    .map((n) => n.replace(/https?:\/\/\S+/gi, '[redacted-url]').replace(/Bearer\s+\S+/gi, '[redacted-auth]'))
    .map((n) => (SENSITIVE_KEY.test(n) ? '[redacted-sensitive]' : n))
    .slice(0, 8)
}

function redactGaps(gaps: string[] | undefined): string[] | undefined {
  if (!gaps?.length) return undefined
  return gaps.map((g) => g.slice(0, 120)).slice(0, 20)
}

export function recordQualityEvent(raw: Omit<QualityMetricEvent, 'ts'> & { ts?: string }): QualityMetricEvent {
  const event: QualityMetricEvent = {
    ts: raw.ts || new Date().toISOString(),
    stage: raw.stage,
    outcome: raw.outcome,
    failureClass: raw.failureClass,
    repairRounds: raw.repairRounds,
    durationMs: typeof raw.durationMs === 'number' ? Math.max(0, Math.round(raw.durationMs)) : undefined,
    capabilityGaps: redactGaps(raw.capabilityGaps),
    fingerprints: raw.fingerprints
      ? {
          form: raw.fingerprints.form?.slice(0, 64),
          candidate: raw.fingerprints.candidate?.slice(0, 64),
          failure: raw.fingerprints.failure?.slice(0, 64),
          transaction: raw.fingerprints.transaction?.slice(0, 64),
        }
      : undefined,
    notes: redactNotes(raw.notes),
  }
  buffer.push(event)
  if (buffer.length > MAX_BUFFER) buffer.shift()
  return event
}

export function listQualityEvents(): QualityMetricEvent[] {
  return [...buffer]
}

export function clearQualityEvents() {
  buffer.length = 0
}

export type QualityAggregate = {
  total: number
  byOutcome: Record<string, number>
  byFailureClass: Record<string, number>
  avgDurationMs: number | null
  clarifyRate: number
  repairTouchRate: number
}

export function aggregateQualityEvents(events: QualityMetricEvent[] = buffer): QualityAggregate {
  const byOutcome: Record<string, number> = {}
  const byFailureClass: Record<string, number> = {}
  let durationSum = 0
  let durationN = 0
  let clarify = 0
  let repairTouch = 0
  for (const e of events) {
    byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1
    if (e.failureClass) byFailureClass[e.failureClass] = (byFailureClass[e.failureClass] || 0) + 1
    if (typeof e.durationMs === 'number') {
      durationSum += e.durationMs
      durationN++
    }
    if (e.outcome === 'need_clarification') clarify++
    if ((e.repairRounds || 0) > 0 || e.stage === 'repair') repairTouch++
  }
  const total = events.length
  return {
    total,
    byOutcome,
    byFailureClass,
    avgDurationMs: durationN ? durationSum / durationN : null,
    clarifyRate: total ? clarify / total : 0,
    repairTouchRate: total ? repairTouch / total : 0,
  }
}

/** 断言事件不含敏感字段 */
export function assertPrivacySafeEvent(event: QualityMetricEvent): string[] {
  const issues: string[] = []
  const blob = JSON.stringify(event)
  if (/DEEPSEEK|sk-[a-zA-Z0-9]{10,}/.test(blob)) issues.push('possible api key leak')
  if (/https?:\/\//i.test(blob)) issues.push('url leak')
  if (/"code"\s*:/.test(blob)) issues.push('code field present')
  if (/password|credential/i.test(blob) && !/\[redacted/.test(blob)) issues.push('credential-like text')
  return issues
}
