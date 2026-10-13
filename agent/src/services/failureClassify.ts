import type { InteractionOutput } from '../schemas/interactionOutput.js'
import type { FailureClassification, FailureClass, RepairRoute } from '../schemas/autonomyCritic.js'
import type { InteractionVerificationReport } from './interactionApply.js'
import { failureFingerprint } from './attemptLedger.js'

const STRUCTURE_HINT =
  /unknown (target|field|scenario)|not found|missing (target|field|widget)|parent|tempRef|createWidget|structure|depth|MAX_FIELDS|节点|控件不存在|目标不存在/i
const INTENT_HINT = /ambiguous|歧义|澄清|need_clarification|incomplete|不明确|哪个/i
const POLICY_HINT =
  /network|禁网|unsupported|risk|L3|upload|remote|eval|policy|策略|拒绝|不允许|forbidden/i
const INFRA_HINT =
  /unverifiable|preview|infrastructure|timeout|runner|mountPreview|location|沙箱|基础设施/i

function routeForClass(cls: FailureClass): RepairRoute {
  switch (cls) {
    case 'code':
      return 'repair_code'
    case 'structure':
      return 'replan'
    case 'intent':
      return 'clarify'
    case 'policy':
      return 'reject'
    case 'infrastructure':
      return 'blocked'
  }
}

function classifyText(text: string): FailureClass | null {
  if (!text) return null
  if (INFRA_HINT.test(text)) return 'infrastructure'
  if (POLICY_HINT.test(text)) return 'policy'
  if (INTENT_HINT.test(text)) return 'intent'
  if (STRUCTURE_HINT.test(text)) return 'structure'
  return null
}

/**
 * 将预览失败 / 静态问题分类为 code|structure|intent|policy|infrastructure。
 * infrastructure 不消耗业务修正预算。
 */
export function classifyInteractionFailure(params: {
  verificationReport: InteractionVerificationReport
  output: InteractionOutput
  staticIssues?: Array<{ path: string; message: string }>
  mergeError?: string
}): FailureClassification {
  const reasons: string[] = []
  const report = params.verificationReport
  const fp = failureFingerprint(report)

  if (Array.isArray(report.errors) && report.errors.length) {
    for (const e of report.errors) {
      reasons.push(`runner:${e}`)
      const hit = classifyText(e)
      if (hit === 'infrastructure' || hit === 'policy') {
        return {
          class: hit,
          route: routeForClass(hit),
          reasons,
          consumeBusinessBudget: hit !== 'infrastructure',
          failureFingerprint: fp,
        }
      }
    }
  }

  const failed = (report.results || []).filter((r) => !r.ok)
  const unverifiable = failed.filter((r) => r.unverifiable)
  if (unverifiable.length && unverifiable.length === failed.length) {
    reasons.push('全部失败场景为 unverifiable（预览基础设施）')
    return {
      class: 'infrastructure',
      route: 'blocked',
      reasons,
      consumeBusinessBudget: false,
      failureFingerprint: fp,
    }
  }
  if (unverifiable.length) {
    reasons.push(`${unverifiable.length} 个场景 unverifiable`)
  }

  if (params.mergeError) {
    reasons.push(`merge:${params.mergeError}`)
    const hit = classifyText(params.mergeError) || 'structure'
    return {
      class: hit,
      route: routeForClass(hit),
      reasons,
      consumeBusinessBudget: hit !== 'infrastructure',
      failureFingerprint: fp,
    }
  }

  for (const issue of params.staticIssues || []) {
    const text = `${issue.path}:${issue.message}`
    reasons.push(text)
    const hit = classifyText(text)
    if (hit && hit !== 'code') {
      return {
        class: hit,
        route: routeForClass(hit),
        reasons,
        consumeBusinessBudget: hit !== 'infrastructure',
        failureFingerprint: fp,
      }
    }
  }

  for (const u of params.output.unsupported || []) {
    const text = `${u.text}:${u.reason}`
    reasons.push(text)
    if (POLICY_HINT.test(text) || /不支持/.test(text)) {
      return {
        class: 'policy',
        route: 'reject',
        reasons,
        consumeBusinessBudget: true,
        failureFingerprint: fp,
      }
    }
  }

  for (const r of failed) {
    const text = r.error || ''
    reasons.push(`${r.scenarioId}:${text || 'assert failed'}`)
    const hit = classifyText(text)
    if (hit && hit !== 'code') {
      return {
        class: hit,
        route: routeForClass(hit),
        reasons,
        consumeBusinessBudget: hit !== 'infrastructure',
        failureFingerprint: fp,
      }
    }
  }

  if (!failed.length && report.pass) {
    reasons.push('verification passed')
    return {
      class: 'code',
      route: 'repair_code',
      reasons,
      consumeBusinessBudget: false,
      failureFingerprint: fp,
    }
  }

  reasons.push('默认按 handler code defect 修正')
  return {
    class: 'code',
    route: 'repair_code',
    reasons,
    consumeBusinessBudget: true,
    failureFingerprint: fp,
  }
}
