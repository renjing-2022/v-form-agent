import { EVENT_KEYS_NEVER } from '../knowledge/eventShapeRegistry.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import type { PreviewAct } from '../knowledge/createCapabilityPolicy.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: Array<WidgetNode & { cells?: WidgetNode[] }>
}

/** 纯前端可写事件键（排除接口类）；须与 Catalog create.eventKeys 取交集 */
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

const FORM_EVENT_KEYS = new Set([
  'onFormCreated',
  'onFormMounted',
  'onFormDataChange',
  'onFormValidate',
])

/** scenario act 键 → Catalog previewCapabilities.acts */
const ACT_TO_PREVIEW: Record<string, PreviewAct | 'global'> = {
  input: 'input',
  clear: 'clear',
  select: 'select',
  toggle: 'toggle',
  rate: 'rate',
  slide: 'slide',
  pickDate: 'pickDate',
  pickTime: 'pickTime',
  click: 'click',
  mount: 'mount',
  switchTab: 'switchTab',
  observeText: 'observeText',
  submit: 'global',
  wait: 'global',
  addSubFormRow: 'global',
}

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

/** 计划中将新建的控件 name / tempRef → type */
export function collectPlannedCreates(output: InteractionOutput): {
  names: Set<string>
  typesByTarget: Map<string, string>
} {
  const names = new Set<string>()
  const typesByTarget = new Map<string, string>()
  for (const op of output.structure) {
    if (op.op === 'addButton') {
      const btn = op as { name?: string; eachTabPane?: boolean }
      if (btn.name) {
        names.add(btn.name)
        typesByTarget.set(btn.name, 'button')
      }
      continue
    }
    if (op.op === 'createWidget') {
      const cw = op as { name?: string; tempRef?: string; type: string }
      if (cw.name) {
        names.add(cw.name)
        typesByTarget.set(cw.name, cw.type)
      }
      if (cw.tempRef) {
        names.add(cw.tempRef)
        typesByTarget.set(cw.tempRef, cw.type)
      }
    }
  }
  return { names, typesByTarget }
}

/** @deprecated 使用 collectPlannedCreates().names */
export function plannedButtonNames(output: InteractionOutput): Set<string> {
  return collectPlannedCreates(output).names
}

export function catalogEventKeysForType(type: string): string[] {
  const entry = getWidgetCatalog().widgets.find((w) => w.type === type)
  return entry?.create?.eventKeys ? [...entry.create.eventKeys] : []
}

export function catalogPreviewActsForType(type: string): string[] {
  const entry = getWidgetCatalog().widgets.find((w) => w.type === type)
  return entry?.create?.previewCapabilities?.acts
    ? [...entry.create.previewCapabilities.acts]
    : []
}

function resolveTargetType(
  target: string,
  typesByName: Map<string, string>,
  plannedTypes: Map<string, string>,
): string | undefined {
  return typesByName.get(target) || plannedTypes.get(target)
}

function fieldNameFromAct(step: Record<string, unknown>): string | undefined {
  for (const key of [
    'input',
    'clear',
    'select',
    'toggle',
    'rate',
    'slide',
    'pickDate',
    'pickTime',
    'click',
  ] as const) {
    if (key in step && typeof step[key] === 'string') return String(step[key])
  }
  return undefined
}

export type InteractionValidationIssue = { path: string; message: string }

export function validateInteractionOutput(
  output: InteractionOutput,
  formJson: { widgetList?: unknown[] },
): InteractionValidationIssue[] {
  const issues: InteractionValidationIssue[] = []
  const { names, typesByName } = collectFormNames(formJson)
  const planned = collectPlannedCreates(output)
  const knownTargets = new Set<string>([...names, ...planned.names, 'form'])

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

  const net = checkHandlersNetworkStatic(output.handlers)
  if (!net.ok) {
    issues.push({ path: 'handlers', message: net.message })
  }

  output.handlers.forEach((h, i) => {
    const hid = h.id || `${h.target}:${h.eventKey}:${i}`
    if (!knownTargets.has(h.target) && h.target !== 'form') {
      issues.push({
        path: `handlers[${i}].target`,
        message: `unknown target "${h.target}" (not in form and not planned createWidget/addButton)`,
      })
    }
    if (!INTERACTION_EVENT_KEYS.has(h.eventKey) || EVENT_KEYS_NEVER.has(h.eventKey)) {
      issues.push({
        path: `handlers[${i}].eventKey`,
        message: `eventKey "${h.eventKey}" not allowed for interaction pipeline`,
      })
    } else if (h.target === 'form') {
      if (!FORM_EVENT_KEYS.has(h.eventKey)) {
        issues.push({
          path: `handlers[${i}].eventKey`,
          message: `form target 仅允许 ${[...FORM_EVENT_KEYS].join('/')}`,
        })
      }
    } else {
      const type = resolveTargetType(h.target, typesByName, planned.typesByTarget)
      if (type) {
        const allowed = catalogEventKeysForType(type)
        if (allowed.length && !allowed.includes(h.eventKey)) {
          issues.push({
            path: `handlers[${i}].eventKey`,
            message: `eventKey "${h.eventKey}" 不在 type=${type} 的 Catalog create.eventKeys`,
          })
        }
        if (type === 'button' && h.eventKey === 'onChange') {
          issues.push({
            path: `handlers[${i}].eventKey`,
            message: 'button target should use onClick, not onChange',
          })
        }
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
      // 纯结构事务（handlers 为空）允许 scenario 引用 createWidget 计划目标（name/tempRef），
      // 前提是该 ref 确实是本事务计划创建的控件，而不是表单上不存在的目标。
      if (!matched && output.handlers.length === 0 && planned.names.has(ref)) continue
      if (!matched) {
        issues.push({
          path: `scenarios[${si}].handlerRefs`,
          message: `handlerRef "${ref}" does not match any handler`,
        })
      }
    }

    sc.act.forEach((step, ai) => {
      const rec = step as Record<string, unknown>
      const actKey = Object.keys(rec).find((k) => k in ACT_TO_PREVIEW)
      if (!actKey) return
      const previewAct = ACT_TO_PREVIEW[actKey]
      if (previewAct === 'global') return
      const field = fieldNameFromAct(rec)
      if (!field) return
      const type = resolveTargetType(field, typesByName, planned.typesByTarget)
      if (!type) return
      const allowedActs = catalogPreviewActsForType(type)
      if (allowedActs.length && !allowedActs.includes(previewAct)) {
        issues.push({
          path: `scenarios[${si}].act[${ai}]`,
          message: `act "${actKey}" 不在 type=${type} 的 previewCapabilities.acts`,
        })
      }
    })

    sc.assert.forEach((a, ai) => {
      if (!('field' in a && 'text' in a)) return
      const type = resolveTargetType(String(a.field), typesByName, planned.typesByTarget)
      if (!type) return
      const entry = getWidgetCatalog().widgets.find((w) => w.type === type)
      const asserts = entry?.create?.previewCapabilities?.asserts || []
      if (asserts.length && !asserts.includes('text')) {
        issues.push({
          path: `scenarios[${si}].assert[${ai}]`,
          message: `assert text 不在 type=${type} 的 previewCapabilities.asserts`,
        })
      }
    })
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
