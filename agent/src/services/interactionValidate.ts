import { EVENT_KEYS_NEVER } from '../knowledge/eventShapeRegistry.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: Array<WidgetNode & { cells?: WidgetNode[] }>
}

/** 纯前端可写事件键（排除接口类） */
export const INTERACTION_EVENT_KEYS = new Set([
  'onFormCreated',
  'onFormMounted',
  'onFormDataChange',
  'onFormValidate',
  'onCreated',
  'onMounted',
  'onClick',
  'onInput',
  'onChange',
  'onFocus',
  'onBlur',
  'onValidate',
  'onAppendButtonClick',
  'onTabClick',
  'onSubFormRowAdd',
  'onSubFormRowInsert',
  'onSubFormRowDelete',
  'onSubFormRowChange',
])

export function collectFormNames(formJson: { widgetList?: unknown[] }): {
  names: Set<string>
  ids: Set<string>
  typesByName: Map<string, string>
} {
  const names = new Set<string>()
  const ids = new Set<string>()
  const typesByName = new Map<string, string>()

  function walk(list: WidgetNode[] | undefined) {
    if (!list) return
    for (const w of list) {
      if (!w || typeof w !== 'object') continue
      if (typeof w.id === 'string') ids.add(w.id)
      const name = typeof w.options?.name === 'string' ? w.options.name : undefined
      if (name) {
        names.add(name)
        if (typeof w.type === 'string') typesByName.set(name, w.type)
      }
      walk(w.widgetList)
      walk(w.tabs)
      walk(w.cols)
      if (Array.isArray(w.rows)) {
        for (const row of w.rows) walk(row.cells)
      }
    }
  }

  walk(formJson.widgetList as WidgetNode[] | undefined)
  return { names, ids, typesByName }
}

/** 计划中将新建的按钮 name */
export function plannedButtonNames(output: InteractionOutput): Set<string> {
  const names = new Set<string>()
  for (const op of output.structure) {
    if (op.op !== 'addButton') continue
    const btn = op as { name?: string }
    if (btn.name) names.add(btn.name)
  }
  return names
}

export type InteractionValidationIssue = { path: string; message: string }

export function validateInteractionOutput(
  output: InteractionOutput,
  formJson: { widgetList?: unknown[] },
): InteractionValidationIssue[] {
  const issues: InteractionValidationIssue[] = []
  const { names, typesByName } = collectFormNames(formJson)
  const planned = plannedButtonNames(output)
  const knownTargets = new Set<string>([...names, ...planned, 'form'])

  if (output.intent === 'need_clarification') {
    if (!output.questions || output.questions.length === 0) {
      issues.push({ path: 'questions', message: 'need_clarification requires questions[]' })
    }
    return issues
  }

  if (output.intent === 'structure_only') {
    return issues
  }

  if (output.intent === 'unsupported') {
    if (output.unsupported.length === 0) {
      issues.push({ path: 'unsupported', message: 'unsupported intent requires unsupported[]' })
    }
    return issues
  }

  if (output.handlers.length === 0 && output.structure.length === 0) {
    issues.push({ path: 'handlers', message: 'interaction/mixed requires handlers or structure' })
  }

  output.handlers.forEach((h, i) => {
    const hid = h.id || `${h.target}:${h.eventKey}:${i}`
    if (!knownTargets.has(h.target) && h.target !== 'form') {
      issues.push({
        path: `handlers[${i}].target`,
        message: `unknown target "${h.target}" (not in form and not planned addButton)`,
      })
    }
    if (!INTERACTION_EVENT_KEYS.has(h.eventKey) || EVENT_KEYS_NEVER.has(h.eventKey)) {
      issues.push({
        path: `handlers[${i}].eventKey`,
        message: `eventKey "${h.eventKey}" not allowed for interaction pipeline`,
      })
    }
    if (h.target !== 'form') {
      const t = typesByName.get(h.target)
      if (t === 'button' && h.eventKey === 'onChange') {
        issues.push({
          path: `handlers[${i}].eventKey`,
          message: 'button target should use onClick, not onChange',
        })
      }
    }
    if (!String(h.code || '').trim()) {
      issues.push({ path: `handlers[${i}].code`, message: 'handler code must not be empty' })
    }
    void hid
  })

  if (output.handlers.length > 0 && output.scenarios.length === 0) {
    issues.push({ path: 'scenarios', message: 'handlers require at least one scenario' })
  }

  for (const [si, sc] of output.scenarios.entries()) {
    for (const ref of sc.handlerRefs) {
      const matched = output.handlers.some((h, i) => {
        const id = h.id || `${h.target}:${h.eventKey}:${i}`
        return id === ref || `${h.target}:${h.eventKey}` === ref || h.target === ref
      })
      if (!matched) {
        issues.push({
          path: `scenarios[${si}].handlerRefs`,
          message: `handlerRef "${ref}" does not match any handler`,
        })
      }
    }
  }

  output.handlers.forEach((h, i) => {
    const hid = h.id || `${h.target}:${h.eventKey}:${i}`
    const covered = output.scenarios.some((sc) =>
      sc.handlerRefs.some(
        (ref) => ref === hid || ref === `${h.target}:${h.eventKey}` || ref === h.target || ref === h.id,
      ),
    )
    if (!covered) {
      issues.push({
        path: `handlers[${i}]`,
        message: `handler ${hid} is not covered by any scenario.handlerRefs`,
      })
    }
  })

  return issues
}
