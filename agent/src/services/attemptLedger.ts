import { createHash } from 'node:crypto'
import { stableStringify } from './formFingerprint.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import type { InteractionVerificationReport } from './interactionApply.js'
import type { AttemptBudget, FailureClass, RepairRoute } from '../schemas/autonomyCritic.js'

/** 业务修正预算（infrastructure 不计入 codeAttempts） */
export const DEFAULT_ATTEMPT_BUDGET: AttemptBudget = {
  maxCodeRepair: 2,
  maxReplan: 2,
  maxTotal: 6,
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function candidateFingerprint(output: InteractionOutput): string {
  return hashPayload({
    structure: output.structure || [],
    handlers: (output.handlers || []).map((h) => ({
      target: h.target,
      eventKey: h.eventKey,
      code: h.code,
    })),
    scenarios: output.scenarios || [],
  })
}

export function failureFingerprint(report: InteractionVerificationReport): string {
  return hashPayload({
    runner: report.runner,
    pass: report.pass,
    networkHits: report.networkHits || [],
    errors: report.errors || [],
    results: (report.results || []).map((r) => ({
      scenarioId: r.scenarioId,
      ok: r.ok,
      error: r.error || '',
      unverifiable: Boolean(r.unverifiable),
    })),
  })
}

export function attemptFingerprint(params: {
  formFingerprint: string
  candidateFingerprint: string
  failureFingerprint: string
  failureClass: FailureClass
}): string {
  return hashPayload(params)
}

export type AttemptLedgerState = {
  seenAttemptFingerprints: string[]
  codeAttempts: number
  replanAttempts: number
  totalAttempts: number
}

export function emptyAttemptLedger(): AttemptLedgerState {
  return {
    seenAttemptFingerprints: [],
    codeAttempts: 0,
    replanAttempts: 0,
    totalAttempts: 0,
  }
}

export function normalizeAttemptLedger(
  fingerprints: string[] | undefined,
  counts?: Partial<Pick<AttemptLedgerState, 'codeAttempts' | 'replanAttempts' | 'totalAttempts'>>,
): AttemptLedgerState {
  const seen = Array.from(new Set((fingerprints || []).filter(Boolean))).slice(-40)
  return {
    seenAttemptFingerprints: seen,
    codeAttempts: Math.max(0, counts?.codeAttempts ?? 0),
    replanAttempts: Math.max(0, counts?.replanAttempts ?? 0),
    totalAttempts: Math.max(0, counts?.totalAttempts ?? seen.length),
  }
}

export function isDuplicateAttempt(ledger: AttemptLedgerState, fp: string): boolean {
  return ledger.seenAttemptFingerprints.includes(fp)
}

export function budgetExhaustedForRoute(
  ledger: AttemptLedgerState,
  route: RepairRoute,
  budget: AttemptBudget = DEFAULT_ATTEMPT_BUDGET,
): boolean {
  if (ledger.totalAttempts >= budget.maxTotal) return true
  if (route === 'repair_code' && ledger.codeAttempts >= budget.maxCodeRepair) return true
  if (route === 'replan' && ledger.replanAttempts >= budget.maxReplan) return true
  return false
}

/** 记录一次将要执行的尝试；duplicate 时不增加计数 */
export function recordAttempt(
  ledger: AttemptLedgerState,
  params: {
    attemptFingerprint: string
    route: RepairRoute
    consumeBusinessBudget: boolean
  },
): AttemptLedgerState {
  if (ledger.seenAttemptFingerprints.includes(params.attemptFingerprint)) {
    return ledger
  }
  const next: AttemptLedgerState = {
    seenAttemptFingerprints: [...ledger.seenAttemptFingerprints, params.attemptFingerprint].slice(-40),
    codeAttempts: ledger.codeAttempts,
    replanAttempts: ledger.replanAttempts,
    totalAttempts: ledger.totalAttempts + 1,
  }
  if (params.consumeBusinessBudget && params.route === 'repair_code') {
    next.codeAttempts += 1
  }
  if (params.consumeBusinessBudget && params.route === 'replan') {
    next.replanAttempts += 1
  }
  return next
}
