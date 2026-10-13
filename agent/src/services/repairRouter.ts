import type { InteractionOutput } from '../schemas/interactionOutput.js'
import type { RepairDecision } from '../schemas/autonomyCritic.js'
import type { InteractionVerificationReport } from './interactionApply.js'
import { classifyInteractionFailure } from './failureClassify.js'
import {
  attemptFingerprint,
  budgetExhaustedForRoute,
  candidateFingerprint,
  DEFAULT_ATTEMPT_BUDGET,
  emptyAttemptLedger,
  isDuplicateAttempt,
  normalizeAttemptLedger,
  recordAttempt,
  type AttemptLedgerState,
} from './attemptLedger.js'
import { computeFormFingerprint } from './formFingerprint.js'
import type { FormJson } from '../schemas/refinePlan.js'

export type RouteRepairParams = {
  formJson: FormJson
  output: InteractionOutput
  verificationReport: InteractionVerificationReport
  staticIssues?: Array<{ path: string; message: string }>
  mergeError?: string
  /** 客户端回传的历史 attempt fingerprint */
  attemptFingerprints?: string[]
  codeAttempts?: number
  replanAttempts?: number
}

/**
 * 分类 → 路由 → fingerprint/budget 闸门。
 * 相同 candidate+failure 不得重复执行；预算耗尽返回可操作诊断。
 */
export function routeRepairAttempt(params: RouteRepairParams): {
  decision: RepairDecision
  ledger: AttemptLedgerState
  allowProceed: boolean
} {
  const classification = classifyInteractionFailure({
    verificationReport: params.verificationReport,
    output: params.output,
    staticIssues: params.staticIssues,
    mergeError: params.mergeError,
  })

  const formFp = computeFormFingerprint(params.formJson)
  const candFp = candidateFingerprint(params.output)
  const attemptFp = attemptFingerprint({
    formFingerprint: formFp,
    candidateFingerprint: candFp,
    failureFingerprint: classification.failureFingerprint,
    failureClass: classification.class,
  })

  let ledger = normalizeAttemptLedger(params.attemptFingerprints, {
    codeAttempts: params.codeAttempts,
    replanAttempts: params.replanAttempts,
  })
  if (!params.attemptFingerprints?.length) {
    ledger = emptyAttemptLedger()
  }

  const duplicate = isDuplicateAttempt(ledger, attemptFp)
  let route = classification.route
  let budgetExhausted = false
  const reasons = [...classification.reasons]

  if (duplicate) {
    reasons.push('相同候选与失败指纹已尝试过，阻断无进展循环')
    route = classification.route === 'repair_code' ? 'blocked' : classification.route
    if (classification.route === 'repair_code') {
      // 重复 code 修正确认为 blocked，避免死循环
      route = 'blocked'
    }
  } else if (
    budgetExhaustedForRoute(ledger, classification.route, DEFAULT_ATTEMPT_BUDGET) &&
    classification.consumeBusinessBudget
  ) {
    budgetExhausted = true
    reasons.push(
      `修正预算已用尽（code≤${DEFAULT_ATTEMPT_BUDGET.maxCodeRepair}, replan≤${DEFAULT_ATTEMPT_BUDGET.maxReplan}, total≤${DEFAULT_ATTEMPT_BUDGET.maxTotal}）`,
    )
    route = 'blocked'
  }

  const allowProceed =
    !duplicate &&
    !budgetExhausted &&
    route === 'repair_code' &&
    classification.consumeBusinessBudget

  // 非 code 路径立即记账；code 路径待 LLM 成功后再 commitAttempt，避免 API 失败误阻断重试
  if (!allowProceed && !duplicate) {
    if (route === 'replan' && !budgetExhausted && classification.consumeBusinessBudget) {
      ledger = recordAttempt(ledger, {
        attemptFingerprint: attemptFp,
        route: 'replan',
        consumeBusinessBudget: true,
      })
    } else if (route === 'blocked' && !classification.consumeBusinessBudget) {
      ledger = recordAttempt(ledger, {
        attemptFingerprint: attemptFp,
        route: 'blocked',
        consumeBusinessBudget: false,
      })
    } else if ((route === 'clarify' || route === 'reject') && !budgetExhausted) {
      ledger = recordAttempt(ledger, {
        attemptFingerprint: attemptFp,
        route,
        consumeBusinessBudget: classification.consumeBusinessBudget,
      })
    }
  }

  const decision: RepairDecision = {
    class: classification.class,
    route,
    reasons,
    consumeBusinessBudget: classification.consumeBusinessBudget && route === 'repair_code',
    candidateFingerprint: candFp,
    failureFingerprint: classification.failureFingerprint,
    attemptFingerprint: attemptFp,
    duplicate,
    budgetExhausted,
    ledger: {
      codeAttempts: ledger.codeAttempts,
      replanAttempts: ledger.replanAttempts,
      totalAttempts: ledger.totalAttempts,
      seenAttemptFingerprints: ledger.seenAttemptFingerprints,
    },
  }

  return { decision, ledger, allowProceed }
}

/** 代码修正成功后提交账本 */
export function commitRepairAttempt(
  ledger: AttemptLedgerState,
  decision: RepairDecision,
): AttemptLedgerState {
  return recordAttempt(ledger, {
    attemptFingerprint: decision.attemptFingerprint,
    route: 'repair_code',
    consumeBusinessBudget: true,
  })
}

export function summarizeRepairDecision(decision: RepairDecision): string {
  const head =
    decision.route === 'repair_code'
      ? '将修正 handler 代码'
      : decision.route === 'replan'
        ? '结构/目标问题，需重新规划'
        : decision.route === 'clarify'
          ? '意图不完整，需澄清'
          : decision.route === 'reject'
            ? '策略拒绝，不再自动修正'
            : decision.duplicate
              ? '检测到无进展循环，已阻断'
              : decision.class === 'infrastructure'
                ? '预览基础设施阻塞，不消耗业务修正次数'
                : '修正已阻断'

  return `${head}（class=${decision.class}）${decision.reasons.slice(0, 3).join('；')}`
}
