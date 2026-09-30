/**
 * 澄清选项服务端重写：不信任模型伪造的组件名 / 事件键。
 * 真源 = 当前表单字段 + Catalog 认可的交互事件键集合。
 */
import type { FormJson } from '../schemas/refinePlan.js'
import {
  CONFIRM_YES_NO_OPTIONS,
  clarificationPayloadSchema,
  clarificationQuestionSchema,
  type ClarificationOption,
  type ClarificationPayload,
  type ClarificationQuestion,
} from '../schemas/clarification.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import { isInterfaceEventKey } from '../knowledge/eventAllowlist.js'
import { buildFormSummary, type FormFieldSummary } from './formSummary.js'
import { INTERACTION_EVENT_KEYS } from './interactionValidate.js'

const FORM_EVENT_OPTIONS = ['onFormCreated', 'onFormMounted', 'onFormDataChange', 'onFormValidate'] as const

function slugId(prefix: string, raw: string): string {
  const s = String(raw || '')
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${prefix}_${s || 'x'}`
}

/** Catalog 中是否存在该 type（用于标注，不用于发明控件） */
export function isCatalogWidgetType(type: string | undefined): boolean {
  if (!type) return false
  return getWidgetCatalog().widgets.some((w) => w.type === type)
}

export function listFormWidgetOptions(formJson: FormJson, instruction?: string): ClarificationOption[] {
  const fields = buildFormSummary(formJson, instruction)
  const opts: ClarificationOption[] = []
  const seen = new Set<string>()

  for (const f of fields) {
    const name = f.name || f.id
    if (!name || seen.has(name)) continue
    // 跳过纯容器无 name 的噪声；保留有 name 的字段/按钮
    seen.add(name)
    const inCatalog = isCatalogWidgetType(f.type)
    opts.push({
      id: slugId('w', name),
      label: f.label ? `${f.label}（${name}）` : name,
      description: [f.type, inCatalog ? undefined : '未在 Catalog 登记'].filter(Boolean).join(' · ') || undefined,
      value: name,
    })
  }

  // 表单级目标
  opts.unshift({
    id: 'w_form',
    label: '整个表单（form）',
    description: '表单生命周期事件',
    value: 'form',
  })

  return opts
}

export function listEventKeyOptions(params: {
  formJson: FormJson
  target?: string
}): ClarificationOption[] {
  const target = params.target || ''
  if (target === 'form') {
    return FORM_EVENT_OPTIONS.filter((k) => INTERACTION_EVENT_KEYS.has(k)).map((k) => ({
      id: slugId('e', k),
      label: k,
      value: k,
    }))
  }

  let type: string | undefined
  if (target) {
    const fields = buildFormSummary(params.formJson)
    const hit = fields.find((f) => f.name === target || f.id === target)
    type = hit?.type
  }

  // 交互管线允许的键 ∩ 非接口键；若 Catalog 有该 type，仅作存在性标注
  const keys = [...INTERACTION_EVENT_KEYS]
    .filter((k) => !isInterfaceEventKey(k))
    .filter((k) => !k.startsWith('onForm') || target === 'form')
    .sort()

  return keys.map((k) => ({
    id: slugId('e', k),
    label: k,
    description: type ? `控件类型 ${type}` : undefined,
    value: k,
  }))
}

function looksLikeWidgetQuestion(prompt: string): boolean {
  return /哪个|哪一个|什么字段|哪个字段|哪个控件|哪个组件|目标字段|选择字段|指代|那个字段|那个控件/.test(
    prompt,
  )
}

function looksLikeEventQuestion(prompt: string): boolean {
  return /哪个事件|什么事件|触发条件|onChange|onClick|事件键|绑定到哪个事件|监听/.test(prompt)
}

function optionValueAsString(v: ClarificationOption['value']): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name: unknown }).name)
  return JSON.stringify(v)
}

/**
 * 将模型给的 options 与真源求交；无交集则整表替换。
 * confirm 固定 yes/no。
 */
export function rewriteClarificationQuestion(
  question: ClarificationQuestion,
  formJson: FormJson,
  ctx?: { selectedWidget?: string; instruction?: string },
): ClarificationQuestion {
  if (question.type === 'confirm') {
    return clarificationQuestionSchema.parse({
      ...question,
      options: CONFIRM_YES_NO_OPTIONS,
    })
  }

  if (question.type === 'text') {
    return question
  }

  const slot = question.binds?.slot
  const prompt = question.prompt || ''

  if (slot === 'target.widget' || (!slot && looksLikeWidgetQuestion(prompt))) {
    const truth = listFormWidgetOptions(formJson, ctx?.instruction)
    const modelValues = new Set((question.options || []).map((o) => optionValueAsString(o.value)))
    const recommended = new Set(question.recommendedOptionIds || [])
    const intersect = truth.filter((o) => modelValues.has(optionValueAsString(o.value)))
    const options = intersect.length > 0 ? intersect : truth
    // 保留推荐：若模型推荐的 value 仍在真源中
    const withRec = options.map((o) => ({
      ...o,
      recommended:
        recommended.has(o.id) ||
        (question.options || []).some(
          (m) => m.recommended && optionValueAsString(m.value) === optionValueAsString(o.value),
        ),
    }))
    return clarificationQuestionSchema.parse({
      ...question,
      type: question.type === 'multiple_choice' ? 'multiple_choice' : 'single_choice',
      options: withRec,
      allowCustom: false,
      binds: { slot: 'target.widget' },
      recommendedOptionIds: withRec.filter((o) => o.recommended).map((o) => o.id),
    })
  }

  if (slot === 'target.eventKey' || (!slot && looksLikeEventQuestion(prompt))) {
    const truth = listEventKeyOptions({ formJson, target: ctx?.selectedWidget })
    const modelValues = new Set((question.options || []).map((o) => optionValueAsString(o.value)))
    const intersect = truth.filter((o) => modelValues.has(optionValueAsString(o.value)))
    const options = intersect.length > 0 ? intersect : truth
    return clarificationQuestionSchema.parse({
      ...question,
      type: 'single_choice',
      options,
      allowCustom: false,
      binds: { slot: 'target.eventKey' },
    })
  }

  // 无 binds：若 options 看起来像控件名，按表单过滤
  if (question.options?.length) {
    const names = new Set(
      buildFormSummary(formJson)
        .map((f) => f.name || f.id)
        .filter(Boolean) as string[],
    )
    names.add('form')
    const kept = question.options.filter((o) => names.has(optionValueAsString(o.value)))
    if (kept.length > 0 && kept.length < question.options.length) {
      // 部分伪造 → 丢掉伪造，保留真源命中；并补全为完整表单列表更安全
      return clarificationQuestionSchema.parse({
        ...question,
        options: listFormWidgetOptions(formJson, ctx?.instruction),
        allowCustom: false,
        binds: question.binds || { slot: 'target.widget' },
      })
    }
    if (kept.length === 0 && question.options.every((o) => typeof o.value === 'string')) {
      // 全部像名字但都不在表单 → 整表替换
      const allLookNames = question.options.every((o) => /^[\w.\u4e00-\u9fff-]+$/.test(optionValueAsString(o.value)))
      if (allLookNames) {
        return clarificationQuestionSchema.parse({
          ...question,
          type: 'single_choice',
          options: listFormWidgetOptions(formJson, ctx?.instruction),
          allowCustom: false,
          binds: { slot: 'target.widget' },
        })
      }
    }
  }

  return question
}

export function rewriteClarificationPayload(
  payload: ClarificationPayload,
  formJson: FormJson,
  instruction?: string,
): ClarificationPayload {
  let selectedWidget: string | undefined
  const questions = payload.questions.map((q) => {
    const next = rewriteClarificationQuestion(q, formJson, { selectedWidget, instruction })
    return next
  })
  return clarificationPayloadSchema.parse({
    protocol: 'structured-clarify-v1',
    questions,
  })
}

/**
 * 从模型 string questions[] 或已有 structured 构建经重写的 clarification。
 */
export function buildClarificationFromNeedClarification(params: {
  formJson: FormJson
  instruction?: string
  questions?: string[]
  clarification?: ClarificationPayload
}): ClarificationPayload {
  if (params.clarification?.questions?.length) {
    return rewriteClarificationPayload(params.clarification, params.formJson, params.instruction)
  }

  const strings = params.questions || []
  const built: ClarificationQuestion[] = []

  if (!strings.length) {
    built.push(
      clarificationQuestionSchema.parse({
        id: 'q_widget_0',
        type: 'single_choice',
        prompt: '请选择要操作的控件',
        required: true,
        options: listFormWidgetOptions(params.formJson, params.instruction),
        binds: { slot: 'target.widget' },
      }),
    )
  } else {
    let widgetAsked = false
    let eventAsked = false
    strings.forEach((prompt, i) => {
      if (!widgetAsked && looksLikeWidgetQuestion(prompt)) {
        widgetAsked = true
        built.push(
          clarificationQuestionSchema.parse({
            id: `q_widget_${i}`,
            type: 'single_choice',
            prompt,
            required: true,
            options: listFormWidgetOptions(params.formJson, params.instruction),
            binds: { slot: 'target.widget' },
          }),
        )
        return
      }
      if (!eventAsked && looksLikeEventQuestion(prompt)) {
        eventAsked = true
        built.push(
          clarificationQuestionSchema.parse({
            id: `q_event_${i}`,
            type: 'single_choice',
            prompt,
            required: true,
            options: listEventKeyOptions({ formJson: params.formJson }),
            binds: { slot: 'target.eventKey' },
          }),
        )
        return
      }
      // 首条含糊且尚未问控件时，升级为控件单选（覆盖「那个字段」类）
      if (!widgetAsked && i === 0 && /字段|控件|组件|联动|交互/.test(prompt)) {
        widgetAsked = true
        built.push(
          clarificationQuestionSchema.parse({
            id: `q_widget_${i}`,
            type: 'single_choice',
            prompt,
            required: true,
            options: listFormWidgetOptions(params.formJson, params.instruction),
            binds: { slot: 'target.widget' },
          }),
        )
        return
      }
      built.push(
        clarificationQuestionSchema.parse({
          id: `q_text_${i}`,
          type: 'text',
          prompt,
          required: true,
        }),
      )
    })
  }

  return rewriteClarificationPayload(
    clarificationPayloadSchema.parse({
      protocol: 'structured-clarify-v1',
      questions: built,
    }),
    params.formJson,
    params.instruction,
  )
}

/** 测试辅助：表单字段名集合 */
export function formFieldNames(formJson: FormJson): string[] {
  return buildFormSummary(formJson)
    .map((f: FormFieldSummary) => f.name || f.id || '')
    .filter(Boolean)
}
