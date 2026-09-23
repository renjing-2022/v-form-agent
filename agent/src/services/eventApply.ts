import type { FormJson } from '../schemas/refinePlan.js'
import type { EventResponse, EventSpec, ExecutionReport } from '../schemas/eventSpec.js'
import { generateEventCode, type EventPatch } from './eventCodegen.js'
import { applyEventPatches } from './eventMerger.js'
import { PREVIEW_EXECUTION_CONSTRAINTS } from '../knowledge/eventAllowlist.js'

function cloneForm(formJson: FormJson): FormJson {
  return JSON.parse(JSON.stringify(formJson)) as FormJson
}

export function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === undefined || actual === null) return expected === actual
  if (typeof expected === 'boolean') return actual === expected || String(actual) === String(expected)
  if (typeof expected === 'number') {
    return actual !== '' && !Number.isNaN(Number(actual)) && Number(actual) === expected
  }
  return JSON.stringify(actual) === JSON.stringify(expected) || String(actual) === String(expected)
}

/** 客户端的 ok/pass 不可信：逐条以 actual 对照 EventSpec.examples[i].expect 重判 */
function recomputePass(report: ExecutionReport, examples: EventSpec['examples']): ExecutionReport {
  const runnerOk = (PREVIEW_EXECUTION_CONSTRAINTS.runnerAllowed as readonly string[]).includes(report.runner)
  const results = (report.results || []).map((r, i) => {
    const expect = examples[i]?.expect || {}
    const actual = r.actual || {}
    const keys = Object.keys(expect)
    const matched =
      r.exampleIndex === i &&
      keys.length > 0 &&
      keys.every((k) => Object.prototype.hasOwnProperty.call(actual, k) && valuesMatch(actual[k], expect[k]))
    return matched ? r : { ...r, ok: false, error: r.error || 'actual 与 expect 不一致或缺失' }
  })
  const pass = runnerOk && results.length === examples.length && results.every((r) => r.ok === true)
  return { ...report, pass, results }
}

export function planEventGenerate(params: {
  instruction: string
  currentFormJson: FormJson
  eventSpec: EventSpec
}): { response: EventResponse; httpStatus: 200 | 422 } {
  const formJson = cloneForm(params.currentFormJson)
  const gen = generateEventCode({
    instruction: params.instruction,
    eventSpec: params.eventSpec,
    formJson,
  })
  if ('error' in gen) {
    return {
      httpStatus: gen.httpStatus,
      response: {
        status: 'draft',
        summary: gen.error,
        warnings: ['generate-rejected'],
        eventSpec: params.eventSpec,
        formJson,
        applied: false,
      },
    }
  }

  const candidate = applyEventPatches(formJson, gen.patches, { confirmOverwrite: true })
  if ('error' in candidate) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: candidate.error,
        warnings: ['candidate-build-failed'],
        eventSpec: params.eventSpec,
        formJson,
        applied: false,
      },
    }
  }

  return {
    httpStatus: 200,
    response: {
      status: 'code_preview',
      summary: '已生成受约束事件代码，请在预览中验证后再写入画布',
      warnings: ['awaiting-preview-execution'],
      eventSpec: params.eventSpec,
      code: gen.code,
      patches: gen.patches,
      formJsonCandidate: candidate.formJson,
      formJson,
      applied: false,
    },
  }
}

export function planEventApply(params: {
  instruction: string
  currentFormJson: FormJson
  eventSpec: EventSpec
  patches?: EventPatch[]
  executionReport?: ExecutionReport
  confirmOverwrite?: boolean
}): { response: EventResponse; httpStatus: 200 | 422 } {
  const formJson = cloneForm(params.currentFormJson)

  if (!params.executionReport) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: '缺少 executionReport，未预览验证不得 applied',
        warnings: ['missing-execution-report'],
        eventSpec: params.eventSpec,
        formJson,
        applied: false,
      },
    }
  }

  const report = recomputePass(params.executionReport, params.eventSpec.examples)
  if (!report.pass) {
    return {
      httpStatus: 200,
      response: {
        status: 'draft',
        summary: '预览执行未全部通过，保持 draft，事件键不写入',
        warnings: ['execution-failed'],
        eventSpec: params.eventSpec,
        formJson,
        applied: false,
        executionReport: report,
      },
    }
  }

  let patches = params.patches
  if (!patches?.length) {
    const gen = generateEventCode({
      instruction: params.instruction,
      eventSpec: params.eventSpec,
      formJson,
    })
    if ('error' in gen) {
      return {
        httpStatus: 422,
        response: {
          status: 'draft',
          summary: gen.error,
          warnings: ['regen-failed'],
          eventSpec: params.eventSpec,
          formJson,
          applied: false,
          executionReport: report,
        },
      }
    }
    patches = gen.patches
  }

  const merged = applyEventPatches(formJson, patches, {
    confirmOverwrite: params.confirmOverwrite,
  })
  if ('error' in merged) {
    return {
      httpStatus: 422,
      response: {
        status: 'draft',
        summary: merged.error,
        warnings: ['apply-rejected'],
        eventSpec: params.eventSpec,
        formJson,
        applied: false,
        executionReport: report,
      },
    }
  }

  return {
    httpStatus: 200,
    response: {
      status: 'applied',
      summary: '预览验证通过，事件代码已写入画布',
      warnings: merged.warnings,
      eventSpec: params.eventSpec,
      code: patches.map((p) => p.code).join('\n\n'),
      patches,
      formJson: merged.formJson,
      applied: true,
      executionReport: report,
    },
  }
}
