import type { EventMergeMode, EventResolution } from '../schemas/clarification.js'
import type { EventConflict } from '../schemas/clarification.js'
import type { InteractionOutput, InteractionScenario } from '../schemas/interactionOutput.js'

export type OverwriteRollback = {
  target: string
  eventKey: string
  previousCode: string
  incomingCode: string
}

function resolutionFor(
  resolutions: EventResolution[] | undefined,
  target: string,
  eventKey: string,
): EventMergeMode | undefined {
  return resolutions?.find((r) => r.target === target && r.eventKey === eventKey)?.mode
}

function handlerRef(output: InteractionOutput, target: string, eventKey: string): string {
  const h = (output.handlers || []).find((x) => x.target === target && x.eventKey === eventKey)
  return h?.id || `${target}:${eventKey}`
}

function scenarioCoversHandler(sc: InteractionScenario, ref: string, target: string, eventKey: string): boolean {
  const refs = sc.handlerRefs || []
  if (refs.includes(ref) || refs.includes(`${target}:${eventKey}`) || refs.includes(target)) return true
  const blob = JSON.stringify(sc)
  return blob.includes(target) && blob.includes(eventKey)
}

/**
 * 为保留既有行为构造冒烟场景（前置/后置合并后须能跑通）。
 */
export function buildExistingBehaviorSmokeScenario(params: {
  target: string
  eventKey: string
  handlerRef: string
}): InteractionScenario {
  const act =
    params.eventKey === 'onClick'
      ? [{ click: params.target }]
      : params.eventKey === 'onFormMounted' || params.eventKey === 'onMounted'
        ? [{ mount: true as const }]
        : params.target === 'form'
          ? [{ mount: true as const }]
          : [{ input: params.target, value: 1 }]
  return {
    id: `legacy-smoke-${params.target}-${params.eventKey}`.slice(0, 64),
    title: `保留既有 ${params.target}.${params.eventKey} 行为`,
    handlerRefs: [params.handlerRef],
    arrange: {},
    act,
    assert: [{ noError: true as const }, { noNetwork: true as const }],
  }
}

/**
 * 合并后场景覆盖：prepend/append 保留既有冒烟；overwrite/cancel 不强制旧行为。
 * 所有非 cancel 冲突键至少要有一个场景引用。
 */
export function ensurePostMergeScenarioCoverage(
  output: InteractionOutput,
  conflicts: EventConflict[],
  resolutions?: EventResolution[],
): { output: InteractionOutput; added: string[]; issues: string[] } {
  if (!conflicts.length) return { output, added: [], issues: [] }
  const scenarios = [...(output.scenarios || [])]
  const added: string[] = []
  const issues: string[] = []

  for (const c of conflicts) {
    const mode = resolutionFor(resolutions, c.target, c.eventKey)
    const ref = handlerRef(output, c.target, c.eventKey)
    const covered = scenarios.some((s) => scenarioCoversHandler(s, ref, c.target, c.eventKey))

    if (mode === 'cancel') continue

    if (mode === 'prepend' || mode === 'append' || (c.mergeSafe && !mode)) {
      const smokeId = `legacy-smoke-${c.target}-${c.eventKey}`.slice(0, 64)
      if (!scenarios.some((s) => s.id === smokeId)) {
        scenarios.push(
          buildExistingBehaviorSmokeScenario({
            target: c.target,
            eventKey: c.eventKey,
            handlerRef: ref,
          }),
        )
        added.push(smokeId)
      }
    }

    if (!covered && mode !== 'prepend' && mode !== 'append' && !(c.mergeSafe && !mode)) {
      // overwrite：要求模型/产物已带场景；缺则记 issue（调用方可拒绝 apply）
      if (mode === 'overwrite' || !mode) {
        issues.push(`missing scenario coverage for ${c.target}.${c.eventKey} (mode=${mode || 'unresolved'})`)
      }
    }
  }

  // 重新检查：非 cancel 必须有覆盖（含刚注入的 smoke）
  for (const c of conflicts) {
    const mode = resolutionFor(resolutions, c.target, c.eventKey)
    if (mode === 'cancel') continue
    const ref = handlerRef(output, c.target, c.eventKey)
    const covered = scenarios.some((s) => scenarioCoversHandler(s, ref, c.target, c.eventKey))
    if (!covered) {
      issues.push(`uncovered conflict handler ${c.target}.${c.eventKey}`)
    }
  }

  return {
    output: { ...output, scenarios },
    added,
    issues: [...new Set(issues)],
  }
}

export function collectOverwriteRollbacks(
  conflicts: EventConflict[],
  resolutions: EventResolution[] | undefined,
): OverwriteRollback[] {
  const out: OverwriteRollback[] = []
  for (const c of conflicts) {
    const mode = resolutionFor(resolutions, c.target, c.eventKey)
    if (mode !== 'overwrite') continue
    out.push({
      target: c.target,
      eventKey: c.eventKey,
      previousCode: c.rollbackCode || c.existingCode,
      incomingCode: c.incomingCode,
    })
  }
  return out
}
