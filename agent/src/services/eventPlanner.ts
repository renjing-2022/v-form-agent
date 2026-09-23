import type { FormJson } from '../schemas/refinePlan.js'
import type { EventResponse, EventSpec } from '../schemas/eventSpec.js'
import { isInterfaceEventKey } from '../knowledge/eventShapeRegistry.js'

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: WidgetNode[]
}

function walkWidgets(nodes: WidgetNode[] | undefined, out: WidgetNode[] = []): WidgetNode[] {
  if (!nodes) return out
  for (const n of nodes) {
    out.push(n)
    walkWidgets(n.widgetList, out)
    walkWidgets(n.tabs, out)
    walkWidgets(n.cols, out)
    if (Array.isArray(n.rows)) {
      for (const row of n.rows) walkWidgets((row as WidgetNode).cols || (row as WidgetNode).widgetList, out)
    }
  }
  return out
}

function findByHint(formJson: FormJson, hint: string): WidgetNode | undefined {
  const all = walkWidgets(formJson.widgetList as WidgetNode[])
  const h = hint.trim()
  return (
    all.find((w) => w.id === h) ||
    all.find((w) => String(w.options?.name || '') === h) ||
    all.find((w) => String(w.options?.label || '') === h) ||
    all.find((w) => String(w.options?.label || '').includes(h))
  )
}

function assertNoEventWrite(summary: string): void {
  if (/已更新事件|已应用\s*JS|已写入事件|事件代码已/i.test(summary)) {
    throw new Error(`event planner summary must not claim event write: ${summary}`)
  }
}

function cloneForm(formJson: FormJson): FormJson {
  return JSON.parse(JSON.stringify(formJson)) as FormJson
}

function allEventKeysEmpty(formJson: FormJson): boolean {
  const nodes = walkWidgets(formJson.widgetList as WidgetNode[])
  for (const n of nodes) {
    const opts = n.options || {}
    for (const [k, v] of Object.entries(opts)) {
      if (/^on[A-Z]/.test(k) && typeof v === 'string' && v.trim()) return false
    }
  }
  const fc = formJson.formConfig || {}
  for (const [k, v] of Object.entries(fc)) {
    if ((/^on[A-Z]/.test(k) || k === 'functions') && typeof v === 'string' && v.trim()) return false
  }
  return true
}

function isDangerInstruction(text: string): boolean {
  return /请求接口|远程搜索|远程查询|onRemoteQuery|上传|dataSources|fetch\(|xhr|http:\/\/|https:\/\//i.test(
    text,
  )
}

function buildSpec(partial: {
  eventKey: string
  sinkKind: EventSpec['sink']['kind']
  widget?: WidgetNode
  examples: EventSpec['examples']
  notes?: string[]
}): EventSpec {
  const widgetRef = partial.widget
    ? {
        id: partial.widget.id,
        name: String(partial.widget.options?.name || '') || undefined,
        label: String(partial.widget.options?.label || '') || undefined,
      }
    : undefined
  return {
    trigger: {
      widgetRef: partial.sinkKind === 'form-event' ? undefined : widgetRef,
      eventKey: partial.eventKey,
    },
    sink: {
      kind: partial.sinkKind,
      eventKey: partial.eventKey,
    },
    overwritePolicy: 'reject-if-present',
    examples: partial.examples,
    notes: partial.notes || [],
  }
}

/**
 * v0.7 澄清规划：只产出 need_clarification / spec_ready，禁止生成事件 JS。
 * 无 Key 时走 mock 规则；有 Key 时仍可用 mock 覆盖（验收确定性）。
 */
export function planEventClarify(params: {
  instruction: string
  currentFormJson: FormJson
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): { response: EventResponse; httpStatus: 200 | 422 } {
  const instruction = params.instruction.trim()
  const historyText = (params.messages || []).map((m) => m.content).join('\n')
  const combined = `${historyText}\n${instruction}`
  const formJson = cloneForm(params.currentFormJson)

  if (isDangerInstruction(instruction) || isDangerInstruction(combined)) {
    const summary =
      '本版不支持接口/远程/上传类交互（onRemoteQuery、上传事件、dataSources）。请改用纯前端字段联动或手动配置数据源。'
    assertNoEventWrite(summary)
    return {
      httpStatus: 422,
      response: {
        status: 'need_clarification',
        summary,
        warnings: ['interface-event-forbidden'],
        questions: [],
        formJson,
        applied: false,
      },
    }
  }

  // ---- lifecycle ----
  if (/打开表单|表单挂载|onFormMounted|onMounted|onCreated|初始化时|一打开/.test(combined)) {
    const eventKey = /onFormCreated/.test(combined)
      ? 'onFormCreated'
      : /onFormMounted|打开表单/.test(combined)
        ? 'onFormMounted'
        : /onCreated/.test(combined)
          ? 'onCreated'
          : 'onMounted'
    const sinkKind = eventKey.startsWith('onForm') ? 'form-event' : 'widget-event'
    let widget: WidgetNode | undefined
    if (sinkKind === 'widget-event') {
      const m = combined.match(/(?:控件|字段|组件)[「"']?([^」"'\s]+)[」"']?/)
      widget = m ? findByHint(formJson, m[1]) : walkWidgets(formJson.widgetList as WidgetNode[])[0]
      if (!widget) {
        return clarify(formJson, '请指定要挂载初始化逻辑的控件（label/name）。', [
          '目标控件是哪一个？',
          '挂载后期望哪些字段的值或显隐状态？',
        ])
      }
    }
    const expectMatch = combined.match(/期望[：:]\s*(\{[\s\S]*?\})/)
    let expect: Record<string, unknown> = { initialized: true }
    if (expectMatch) {
      try {
        expect = JSON.parse(expectMatch[1]) as Record<string, unknown>
      } catch {
        /* keep default */
      }
    }
    if (!/期望[：:]/.test(combined) && !/示例[：:]/.test(combined)) {
      return clarify(formJson, '生命周期意图已识别，还需要可判定示例（挂载后的期望状态）。', [
        '挂载完成后哪些字段的值或 hidden/disabled 应变为什么？请用「期望：{...}」给出。',
      ])
    }
    const spec = buildSpec({
      eventKey,
      sinkKind,
      widget,
      examples: [{ given: {}, expect, note: 'preview load / mounted' }],
      notes: ['v0.7 仅澄清：不生成、不合入事件 JS'],
    })
    return specReady(formJson, `已澄清生命周期意图 → ${eventKey}（本版不写入事件代码）`, spec)
  }

  // ---- sub-form row ----
  if (/子表|onSubFormRow|增行|插入行|删行/.test(combined)) {
    const eventKey = /删行|Delete/i.test(combined)
      ? 'onSubFormRowDelete'
      : /插入|Insert/i.test(combined)
        ? 'onSubFormRowInsert'
        : /变化|Change/i.test(combined)
          ? 'onSubFormRowChange'
          : 'onSubFormRowAdd'
    const sub =
      walkWidgets(formJson.widgetList as WidgetNode[]).find((w) => w.type === 'sub-form') ||
      findByHint(formJson, '子表')
    if (!sub) {
      return clarify(formJson, '未找到子表控件，请确认画布上已有 sub-form。', [
        '子表的 name/label 是什么？',
        '行事件触发后期望的字段默认值或计算结果？',
      ])
    }
    if (!/期望[：:]/.test(combined) && !/示例[：:]/.test(combined)) {
      return clarify(formJson, '子表行事件意图已识别，还需要可判定示例。', [
        '增/删/改行后期望哪些字段状态？请用「期望：{...}」给出。',
      ])
    }
    let expect: Record<string, unknown> = { rowTouched: true }
    const expectMatch = combined.match(/期望[：:]\s*(\{[\s\S]*?\})/)
    if (expectMatch) {
      try {
        expect = JSON.parse(expectMatch[1]) as Record<string, unknown>
      } catch {
        /* keep */
      }
    }
    const spec = buildSpec({
      eventKey,
      sinkKind: 'widget-event',
      widget: sub,
      examples: [{ given: { action: 'row' }, expect }],
      notes: ['v0.7 仅澄清：不生成、不合入事件 JS'],
    })
    return specReady(formJson, `已澄清子表行事件 → ${eventKey}（本版不写入事件代码）`, spec)
  }

  // ---- linkage / compute onChange ----
  const link =
    combined.match(
      /改[「"']?([^」"'\s,，]+)[」"']?时[\s\S]*?(?:把|将)[「"']?([^」"'\s,，设成]+)[」"']?/,
    ) ||
    combined.match(
      /改[「"']?([^」"'\s,，]+)[」"']?时\s*(?:把|将)?\s*(?:隐藏|显示|禁用|启用)[「"']?([^」"'\s,，]+)[」"']?/,
    ) ||
    combined.match(/当[「"']?([^」"'\s,，]+)[」"']?变化[\s\S]*?[「"']?([^」"'\s,，设成]+)[」"']?/)
  if (link || /联动|onChange|计分|加权|显示|隐藏|禁用/.test(combined)) {
    const sourceHint = link?.[1]
    const targetHint = link?.[2]
    const source = sourceHint ? findByHint(formJson, sourceHint) : undefined
    const target = targetHint ? findByHint(formJson, targetHint) : undefined
    const questions: string[] = []
    if (!source) questions.push('触发字段是哪一个（label/name）？')
    if (!target && /把|将|赋给|写入|显示|隐藏/.test(combined)) {
      questions.push('目标字段或控件是哪一个？')
    }
    if (!/期望[：:]/.test(combined) && !/示例[：:]/.test(combined) && !/例如/.test(combined)) {
      questions.push('请给出可判定示例，如：期望：{"总分":6}（给定输入可用「例如 语文=2,数学=4」）')
    }
    if (questions.length) {
      return clarify(formJson, '交互意图需继续澄清后才能形成 EventSpec。', questions)
    }
    const given: Record<string, unknown> = {}
    const eg = combined.match(/例如[：:]?\s*(.+?)(?=\s*期望[：:]|$)/)
    if (eg) {
      for (const part of eg[1].split(/[,，]/)) {
        const kv = part.split(/=|＝|:/)
        if (kv.length >= 2) given[kv[0].trim()] = Number.isNaN(Number(kv[1].trim())) ? kv[1].trim() : Number(kv[1].trim())
      }
    }
    let expect: Record<string, unknown> = {}
    const expectMatch = combined.match(/期望[：:]\s*(\{[\s\S]*?\})/)
    if (expectMatch) {
      try {
        expect = JSON.parse(expectMatch[1]) as Record<string, unknown>
      } catch {
        expect = { updated: true }
      }
    } else {
      expect = { updated: true }
    }
    const spec = buildSpec({
      eventKey: 'onChange',
      sinkKind: 'widget-event',
      widget: source!,
      examples: [{ given, expect }],
      notes: [
        target ? `targetHint=${String(target.options?.name || target.id)}` : '',
        'v0.7 仅澄清：不生成、不合入事件 JS',
      ].filter(Boolean),
    })
    return specReady(formJson, `已澄清字段联动意图 → onChange（本版不写入事件代码）`, spec)
  }

  return clarify(formJson, '请补充交互意图细节。', [
    '触发时机是什么（改字段 / 点按钮 / 表单挂载 / 子表增行 / 提交前）？',
    '涉及哪些控件（label 或 name）？',
    '请给出至少一条可判定示例：期望：{...}',
  ])
}

function clarify(formJson: FormJson, summary: string, questions: string[]): {
  response: EventResponse
  httpStatus: 200
} {
  assertNoEventWrite(summary)
  if (!allEventKeysEmpty(formJson) && !hasPreexistingEvents(formJson)) {
    /* allow preexisting empty */
  }
  return {
    httpStatus: 200,
    response: {
      status: 'need_clarification',
      summary,
      warnings: [],
      questions,
      formJson,
      applied: false,
    },
  }
}

function hasPreexistingEvents(formJson: FormJson): boolean {
  return !allEventKeysEmpty(formJson)
}

function specReady(formJson: FormJson, summary: string, eventSpec: EventSpec): {
  response: EventResponse
  httpStatus: 200
} {
  assertNoEventWrite(summary)
  if (isInterfaceEventKey(eventSpec.trigger.eventKey)) {
    throw new Error('spec_ready must not use interface event keys')
  }
  return {
    httpStatus: 200,
    response: {
      status: 'spec_ready',
      summary,
      warnings: ['v0.7-no-event-write'],
      eventSpec,
      formJson,
      applied: false,
    },
  }
}

/** 断言响应未写入任何事件键（相对输入） */
export function assertEventKeysUnchanged(before: FormJson, after: FormJson): void {
  const beforeNodes = walkWidgets(before.widgetList as WidgetNode[])
  const afterNodes = walkWidgets(after.widgetList as WidgetNode[])
  const beforeById = new Map(beforeNodes.map((n) => [n.id, n]))
  for (const n of afterNodes) {
    const b = beforeById.get(n.id)
    const bOpts = b?.options || {}
    const aOpts = n.options || {}
    for (const [k, v] of Object.entries(aOpts)) {
      if (!/^on[A-Z]/.test(k)) continue
      const bv = bOpts[k]
      if (String(v ?? '') !== String(bv ?? '')) {
        throw new Error(`event key mutated: ${n.id}.${k}`)
      }
    }
  }
  for (const [k, v] of Object.entries(after.formConfig || {})) {
    if (!/^on[A-Z]/.test(k) && k !== 'functions') continue
    if (String(v ?? '') !== String((before.formConfig || {})[k] ?? '')) {
      throw new Error(`formConfig event mutated: ${k}`)
    }
  }
}
