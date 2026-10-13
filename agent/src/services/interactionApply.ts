import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput, InteractionScenario } from '../schemas/interactionOutput.js'
import { valuesMatch } from './eventApply.js'
import { applyInteractionOutput, scenarioFingerprint, collectEventConflicts } from './interactionMerger.js'
import { interactionOutputSchema } from '../schemas/interactionOutput.js'
import { validateInteractionOutput } from './interactionValidate.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'
import { narrateScenarios } from './scenarioNarrator.js'
import { collectWidgetIds, validateFormJson } from './validator.js'
import { buildFormIndex } from './formIndex.js'
import {
  ensurePostMergeScenarioCoverage,
  type OverwriteRollback,
} from './eventMergeScenarios.js'
import { buildEventMergeClarifyQuestion } from './eventAstMerge.js'
import { clarificationPayloadSchema } from '../schemas/clarification.js'
import {
  buildPreviewProvenance,
  verifyTransactionFingerprint,
  type PreviewProvenance,
} from './previewProvenance.js'
import { recordQualityEvent } from './qualityMetrics.js'

/**
 * apply / candidate 前完整画布结构校验。
 * 聚焦 id/name 重复、深度、节点上限、非法新建 type；
 * 不把存量控件的 catalog 选项细项（如 defaultValue:null）当作合入阻断。
 */
export function validateFullCanvas(formJson: FormJson, baseline?: FormJson): string[] {
  const index = buildFormIndex(formJson)
  const messages: string[] = []
  if (!index.nodes.length && Array.isArray(formJson.widgetList) && formJson.widgetList.length) {
    messages.push('form index empty but widgetList non-empty')
  }

  const nameCounts = new Map<string, number>()
  const idCounts = new Map<string, number>()
  for (const n of index.nodes) {
    if (n.name) nameCounts.set(n.name, (nameCounts.get(n.name) || 0) + 1)
    if (n.id) idCounts.set(n.id, (idCounts.get(n.id) || 0) + 1)
    if (n.depth > 8) {
      messages.push(`${n.path}: widget nesting too deep`)
    }
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) messages.push(`duplicate name "${name}"`)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) messages.push(`duplicate widget id "${id}"`)
  }
  if (index.nodes.length > 120) {
    messages.push(`field count exceeds 120 (indexed=${index.nodes.length})`)
  }

  // 新建 type 合法性：相对 baseline 新增的 id
  const existing = collectWidgetIds(baseline || { widgetList: [] })
  const issues = validateFormJson(formJson, {
    mode: 'refine',
    existingIds: existing,
    catalogMode: 'event-apply',
  })
  for (const issue of issues) {
    // 仅保留 type / 结构 / 重复类硬错误；忽略存量 option 约束噪声
    if (
      /\.type$/.test(issue.path) ||
      /duplicate|nesting too deep|field count exceeds|invalid widget|widgetList must|formConfig must/.test(
        issue.message,
      )
    ) {
      messages.push(`${issue.path}: ${issue.message}`)
    }
  }

  return [...new Set(messages)]
}

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
      if ('field' in a && 'text' in a) {
        const key = `text:${a.field}`
        const got = Object.prototype.hasOwnProperty.call(actual, key) ? actual[key] : actual[a.field]
        if (!valuesMatch(got, a.text)) failed.push(`text:${a.field}`)
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
  eventResolutions?: import('../schemas/clarification.js').EventResolution[]
  transactionFingerprint?: string
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

  const txn = verifyTransactionFingerprint(params.transactionFingerprint, formJson, output)
  if (!txn.ok) {
    recordQualityEvent({
      stage: 'apply',
      outcome: 'rejected',
      notes: ['transaction-fingerprint-mismatch'],
      fingerprints: { transaction: params.transactionFingerprint },
    })
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: txn.error,
        warnings: ['transaction-fingerprint-mismatch'],
        formJson,
        applied: false,
        output,
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
    eventResolutions: params.eventResolutions,
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

  const postCanvas = validateFullCanvas(merged.formJson, formJson)
  if (postCanvas.length) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: `合入后画布校验失败，未写入：${postCanvas.slice(0, 3).join('; ')}`,
        warnings: ['post-apply-canvas-invalid', ...postCanvas.slice(0, 8)],
        formJson,
        applied: false,
        verificationReport: report,
        output,
      },
    }
  }

  const conflicts = collectEventConflicts(formJson, output)
  const coverage = ensurePostMergeScenarioCoverage(output, conflicts, params.eventResolutions)
  if (coverage.issues.length) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: `合并场景覆盖不足：${coverage.issues.slice(0, 3).join('; ')}`,
        warnings: ['merge-scenario-coverage', ...coverage.issues.slice(0, 8)],
        formJson,
        applied: false,
        verificationReport: report,
        output,
      },
    }
  }

  // 用覆盖补全后的 scenarios 重判（含 legacy smoke）
  const reportWithCoverage = recomputeInteractionVerification(
    params.verificationReport,
    coverage.output.scenarios,
  )
  if (!reportWithCoverage.pass && coverage.added.length) {
    // 旧 verificationReport 可能未包含新注入 smoke；不因缺失结果单独失败——要求调用方重验。
    // 但若原有 scenarios 已全过且仅新增 smoke，允许在调用方重跑前以 draft 提示。
    const missingSmoke = coverage.added.filter(
      (id) => !(params.verificationReport.results || []).some((r) => r.scenarioId === id),
    )
    if (missingSmoke.length) {
      return {
        httpStatus: 200,
        response: {
          status: 'draft',
          summary: `已补充既有行为场景（${missingSmoke.join(',')}），请重新预览验证后再写入`,
          warnings: ['need-reverify-legacy-smoke', ...missingSmoke],
          formJson,
          formJsonCandidate: merged.formJson,
          applied: false,
          verificationReport: report,
          output: coverage.output,
          scenarioNarration: narrateScenarios(coverage.output.scenarios),
        },
      }
    }
  }

  return {
    httpStatus: 200,
    response: {
      status: 'applied',
      summary: '验证通过且已确认，结构与事件已写入画布',
      warnings: [
        ...merged.warnings,
        ...(merged.overwriteRollbacks?.length
          ? [`overwrite-rollbacks:${merged.overwriteRollbacks.length}`]
          : []),
      ],
      formJson: merged.formJson,
      applied: true,
      verificationReport: report,
      output: coverage.output,
      scenarioNarration: narrateScenarios(coverage.output.scenarios),
    },
  }
}

export function buildInteractionCandidate(
  currentFormJson: FormJson,
  output: InteractionOutput,
  opts?: {
    eventResolutions?: import('../schemas/clarification.js').EventResolution[]
    confirmOverwrite?: boolean
  },
): InteractionMergePreview {
  const issues = validateInteractionOutput(output, currentFormJson)
  if (issues.length) {
    return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join('; ') }
  }
  const net = checkHandlersNetworkStatic(output.handlers)
  if (!net.ok) return { ok: false, error: net.message }
  const eventConflicts = collectEventConflicts(currentFormJson, output)
  const merged = applyInteractionOutput(currentFormJson, output, {
    confirmOverwrite: opts?.confirmOverwrite,
    eventResolutions: opts?.eventResolutions,
    previewForceOverwrite: !opts?.confirmOverwrite && !(opts?.eventResolutions?.length),
  })
  if (!merged.ok) return { ok: false, error: merged.error }
  const canvasIssues = validateFullCanvas(merged.formJson, currentFormJson)
  if (canvasIssues.length) {
    return {
      ok: false,
      error: `候选画布全图校验失败：${canvasIssues.slice(0, 5).join('; ')}`,
    }
  }
  const coverage = ensurePostMergeScenarioCoverage(
    merged.outputResolved,
    eventConflicts,
    opts?.eventResolutions,
  )
  const mergeClarify =
    eventConflicts.length > 0
      ? clarificationPayloadSchema.parse({
          protocol: 'structured-clarify-v1',
          questions: eventConflicts.map((c) =>
            buildEventMergeClarifyQuestion({
              target: c.target,
              eventKey: c.eventKey,
              mergeSafe: c.mergeSafe,
              reason: c.reasons?.[0],
            }),
          ),
        })
      : undefined
  const provenance = buildPreviewProvenance({
    formJson: currentFormJson,
    output: coverage.output,
    formJsonCandidate: merged.formJson,
    runner: 'designer-preview',
  })
  recordQualityEvent({
    stage: 'preview',
    outcome: 'success',
    fingerprints: {
      form: provenance.formFingerprint,
      candidate: provenance.handlerFingerprint,
      transaction: provenance.transactionFingerprint,
    },
    notes: eventConflicts.length ? [`conflicts:${eventConflicts.length}`] : undefined,
  })
  return {
    ok: true,
    formJsonCandidate: merged.formJson,
    warnings: [
      ...merged.warnings,
      ...(coverage.added.length ? [`legacy-smoke-added:${coverage.added.join(',')}`] : []),
    ],
    scenarioFingerprint: scenarioFingerprint(coverage.output.scenarios),
    scenarioNarration: narrateScenarios(coverage.output.scenarios),
    eventConflicts,
    outputResolved: coverage.output,
    overwriteRollbacks: merged.overwriteRollbacks,
    eventMergeClarification: mergeClarify,
    provenance,
  }
}

export type InteractionMergePreview =
  | {
      ok: true
      formJsonCandidate: FormJson
      warnings: string[]
      scenarioFingerprint: string
      scenarioNarration: string[]
      eventConflicts?: import('../schemas/clarification.js').EventConflict[]
      /** tempRef 已解析为真实 name，供预览/合入使用 */
      outputResolved: InteractionOutput
      overwriteRollbacks?: OverwriteRollback[]
      /** 四选一澄清（无法证明安全时仍提供全部模式） */
      eventMergeClarification?: import('../schemas/clarification.js').ClarificationPayload
      provenance?: PreviewProvenance
    }
  | { ok: false; error: string }
