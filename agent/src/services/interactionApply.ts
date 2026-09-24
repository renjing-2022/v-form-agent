import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput, InteractionScenario } from '../schemas/interactionOutput.js'
import { valuesMatch } from './eventApply.js'
import { applyInteractionOutput, scenarioFingerprint } from './interactionMerger.js'
import { interactionOutputSchema } from '../schemas/interactionOutput.js'
import { validateInteractionOutput } from './interactionValidate.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'
import { narrateScenarios } from './scenarioNarrator.js'

export type InteractionAssertActual = Record<string, unknown>

export type InteractionScenarioResult = {
  scenarioId: string
  ok: boolean
  actual?: InteractionAssertActual
  error?: string
  unverifiable?: boolean
}

export type InteractionVerificationReport = {
  runner: 'designer-preview' | 'playwright'
  results: InteractionScenarioResult[]
  pass: boolean
  networkHits?: string[]
  errors?: string[]
}

/** 服务端按场景 assert 重判；客户端 ok/pass 不可信 */
export function recomputeInteractionVerification(
  report: InteractionVerificationReport,
  scenarios: InteractionScenario[],
): InteractionVerificationReport {
  const byId = new Map(scenarios.map((s) => [s.id, s]))
  const results = (report.results || []).map((r) => {
    const sc = byId.get(r.scenarioId)
    if (!sc) {
      return { ...r, ok: false, error: r.error || `unknown scenarioId ${r.scenarioId}` }
    }
    if (r.unverifiable) {
      return { ...r, ok: false, error: r.error || 'unverifiable' }
    }
    const actual = r.actual || {}
    const failed: string[] = []
    for (const a of sc.assert) {
      if ('noNetwork' in a && a.noNetwork) {
        if (actual.noNetwork === false || (report.networkHits && report.networkHits.length > 0)) {
          failed.push('noNetwork')
        }
        continue
      }
      if ('noError' in a && a.noError) {
        if (actual.noError === false || (Array.isArray(actual.errors) && (actual.errors as unknown[]).length > 0)) {
          failed.push('noError')
        }
        continue
      }
      if ('field' in a && 'value' in a) {
        // Prefer namespaced key; do not use ?? — null is a valid observed value.
        const key = `field:${a.field}`
        const got = Object.prototype.hasOwnProperty.call(actual, key) ? actual[key] : actual[a.field]
        if (!valuesMatch(got, a.value)) failed.push(`field:${a.field}`)
        continue
      }
      if ('field' in a && 'hidden' in a) {
        if (!valuesMatch(actual[`hidden:${a.field}`], a.hidden)) failed.push(`hidden:${a.field}`)
        continue
      }
      if ('field' in a && 'disabled' in a) {
        if (!valuesMatch(actual[`disabled:${a.field}`], a.disabled)) failed.push(`disabled:${a.field}`)
        continue
      }
      if ('field' in a && 'required' in a) {
        if (!valuesMatch(actual[`required:${a.field}`], a.required)) failed.push(`required:${a.field}`)
        continue
      }
      if ('field' in a && 'label' in a) {
        if (!valuesMatch(actual[`label:${a.field}`], a.label)) failed.push(`label:${a.field}`)
        continue
      }
      if ('activeTab' in a) {
        if (!valuesMatch(actual.activeTab, a.activeTab)) failed.push('activeTab')
        continue
      }
      if ('focused' in a) {
        if (!valuesMatch(actual.focused, a.focused)) failed.push('focused')
        continue
      }
      if ('valid' in a) {
        if (!valuesMatch(actual.valid, a.valid)) failed.push('valid')
        continue
      }
      if ('dialogVisible' in a) {
        if (!valuesMatch(actual[`dialog:${a.dialogVisible}`], a.value)) failed.push(`dialog:${a.dialogVisible}`)
        continue
      }
      if ('subFormRows' in a) {
        if (!valuesMatch(actual[`subFormRows:${a.subFormRows}`], a.count)) failed.push(`subFormRows:${a.subFormRows}`)
      }
    }
    if (failed.length) {
      return { ...r, ok: false, error: r.error || `assert failed: ${failed.join(',')}` }
    }
    return { ...r, ok: true, error: undefined }
  })

  const covered = scenarios.every((s) => results.some((r) => r.scenarioId === s.id))
  const pass =
    covered &&
    results.length >= scenarios.length &&
    results.every((r) => r.ok === true) &&
    !(report.networkHits && report.networkHits.length > 0)

  return { ...report, results, pass }
}

export type InteractionApplyParams = {
  currentFormJson: FormJson
  output: InteractionOutput
  verificationReport?: InteractionVerificationReport
  userConfirmed?: boolean
  confirmOverwrite?: boolean
}

export type InteractionApplyResponse = {
  status: 'applied' | 'draft'
  summary: string
  warnings: string[]
  formJson: FormJson
  formJsonCandidate?: FormJson
  applied: boolean
  verificationReport?: InteractionVerificationReport
  scenarioNarration?: string[]
  output: InteractionOutput
}

export function planInteractionApply(params: InteractionApplyParams): {
  response: InteractionApplyResponse
  httpStatus: 200 | 422
} {
  const formJson = JSON.parse(JSON.stringify(params.currentFormJson)) as FormJson
  const output = interactionOutputSchema.parse(params.output)

  if (!params.userConfirmed) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: '未确认，不写入画布',
        warnings: ['missing-user-confirm'],
        formJson,
        applied: false,
        output,
        scenarioNarration: narrateScenarios(output.scenarios),
      },
    }
  }

  if (!params.verificationReport) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: '缺少 verificationReport，未验证不得 applied',
        warnings: ['missing-verification-report'],
        formJson,
        applied: false,
        output,
      },
    }
  }

  const report = recomputeInteractionVerification(params.verificationReport, output.scenarios)
  if (!report.pass) {
    return {
      httpStatus: 200,
      response: {
        status: 'draft',
        summary: '验证未全部通过，保持 draft，画布不变',
        warnings: ['verification-failed'],
        formJson,
        applied: false,
        verificationReport: report,
        output,
        scenarioNarration: narrateScenarios(output.scenarios),
      },
    }
  }

  const merged = applyInteractionOutput(formJson, output, {
    confirmOverwrite: params.confirmOverwrite,
  })
  if (!merged.ok) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: merged.error,
        warnings: ['merge-rejected'],
        formJson,
        applied: false,
        verificationReport: report,
        output,
      },
    }
  }

  return {
    httpStatus: 200,
    response: {
      status: 'applied',
      summary: '验证通过且已确认，结构与事件已写入画布',
      warnings: merged.warnings,
      formJson: merged.formJson,
      applied: true,
      verificationReport: report,
      output,
      scenarioNarration: narrateScenarios(output.scenarios),
    },
  }
}

export function buildInteractionCandidate(
  currentFormJson: FormJson,
  output: InteractionOutput,
): InteractionMergePreview {
  const issues = validateInteractionOutput(output, currentFormJson)
  if (issues.length) {
    return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join('; ') }
  }
  const net = checkHandlersNetworkStatic(output.handlers)
  if (!net.ok) return { ok: false, error: net.message }
  const merged = applyInteractionOutput(currentFormJson, output, { confirmOverwrite: true })
  if (!merged.ok) return { ok: false, error: merged.error }
  return {
    ok: true,
    formJsonCandidate: merged.formJson,
    warnings: merged.warnings,
    scenarioFingerprint: scenarioFingerprint(output.scenarios),
    scenarioNarration: narrateScenarios(output.scenarios),
  }
}

export type InteractionMergePreview =
  | {
      ok: true
      formJsonCandidate: FormJson
      warnings: string[]
      scenarioFingerprint: string
      scenarioNarration: string[]
    }
  | { ok: false; error: string }
