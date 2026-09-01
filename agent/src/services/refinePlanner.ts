import { refinePlanSchema, type FormJson, type RefinePlan } from '../schemas/refinePlan.js'
import { chatCompletion, type ChatMessage } from './deepseek.js'
import { REFINE_CREATE_WHITELIST } from '../knowledge/widgetWhitelist.js'

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('model output is not valid JSON')
  }
}

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
}

function summarizeForm(formJson: FormJson) {
  const fields: Array<{ id?: string; name?: string; label?: string; type?: string }> = []
  const walk = (widgets: WidgetNode[]) => {
    for (const w of widgets) {
      fields.push({
        id: w.id,
        name: typeof w.options?.name === 'string' ? w.options.name : undefined,
        label: typeof w.options?.label === 'string' ? w.options.label : undefined,
        type: w.type,
      })
      if (Array.isArray(w.widgetList)) walk(w.widgetList)
      if (Array.isArray(w.tabs)) walk(w.tabs)
      if (Array.isArray(w.cols)) {
        for (const col of w.cols) {
          if (Array.isArray(col.widgetList)) walk(col.widgetList)
        }
      }
    }
  }
  walk((formJson.widgetList || []) as WidgetNode[])
  return fields.slice(0, 80)
}

const systemPrompt = `你是 v-form 表单优化规划器。根据用户指令与当前表单摘要，输出 RefinePlan JSON（不要 Markdown）。
只能输出 operations，禁止直接输出完整 formJson。
允许的 op：
- updateField: { op, target:{id?|name?}, patch:{label?, required?, optionItems?, textContent?} }
- setFormula: { op, target, formula, formulaEnabled? }  （仅 number；formula 可用字段 name，如 score1+score2）
- addField: { op, field:{key,label,type,required?,options?,formula?}, parent? }
- wrapInTabs: { op, tabName?, panes:[{label, targets:[{id:"..."} 或 {name:"..."}]}] }
重要：target / targets 必须是对象，禁止写成字符串。正确示例 targets:[{"name":"input1"},{"id":"radio2"}]；错误示例 targets:["input1","radio2"]。
可新建 type 仅限：${REFINE_CREATE_WHITELIST.join(', ')}
不要输出事件回调或 cssCode。
输出字段：summary, warnings[], operations[]`

export async function planRefine(params: {
  instruction: string
  currentFormJson: FormJson
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<{ plan: RefinePlan; usedMock: boolean }> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    if (process.env.AGENT_ALLOW_MOCK === '1') {
      return { plan: mockRefinePlan(params.instruction, params.currentFormJson), usedMock: true }
    }
    throw new Error('DEEPSEEK_API_KEY is not configured')
  }

  const history = (params.messages || []).slice(-12).map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }))

  const content = await chatCompletion([
    { role: 'system', content: systemPrompt },
    ...history,
    {
      role: 'user',
      content: JSON.stringify({
        instruction: params.instruction,
        formSummary: summarizeForm(params.currentFormJson),
        note: '请基于 formSummary 中的 id/name 定位控件；未提及的控件必须保持不变。',
      }),
    },
  ])

  const raw = normalizeRefinePlanRaw(extractJsonObject(content))
  const parsed = refinePlanSchema.parse(raw)
  return { plan: parsed, usedMock: false }
}

/** 容忍模型把 targets/target 写成字符串等常见偏差 */
export function normalizeRefinePlanRaw(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  const plan = input as Record<string, unknown>
  const ops = plan.operations
  if (!Array.isArray(ops)) return plan

  const coerceTarget = (t: unknown) => {
    if (typeof t === 'string') {
      const s = t.trim()
      return s ? { id: s, name: s } : t
    }
    return t
  }

  plan.operations = ops.map((op) => {
    if (!op || typeof op !== 'object') return op
    const o = { ...(op as Record<string, unknown>) }
    if (o.target !== undefined) o.target = coerceTarget(o.target)
    if (o.parent !== undefined) o.parent = coerceTarget(o.parent)
    if (o.op === 'wrapInTabs' && Array.isArray(o.panes)) {
      o.panes = o.panes.map((pane) => {
        if (!pane || typeof pane !== 'object') return pane
        const p = { ...(pane as Record<string, unknown>) }
        if (Array.isArray(p.targets)) p.targets = p.targets.map(coerceTarget)
        return p
      })
    }
    return o
  })
  return plan
}

export function mockRefinePlan(instruction: string, current: FormJson): RefinePlan {
  const root = (current.widgetList || []) as WidgetNode[]
  const flat = summarizeForm(current)
  const warnings: string[] = ['当前使用 mock refine 规划（未配置 DeepSeek Key）']
  const operations: RefinePlan['operations'] = []

  const wantTabs = /tab|标签|页签|选项卡/i.test(instruction)
  const wantOptions = /选项|option|分值|改成|改为/i.test(instruction)
  const wantFormula = /公式|总分|合计|计算|求和/i.test(instruction)

  if (wantTabs && !root.some((w) => w.type === 'tab')) {
    const mid = Math.max(1, Math.ceil(flat.length / 2))
    const left = flat.slice(0, mid).filter((f) => f.id || f.name)
    const right = flat.slice(mid).filter((f) => f.id || f.name)
    operations.push({
      op: 'wrapInTabs',
      tabName: 'main_tabs',
      panes: [
        {
          label: /基本|信息/.test(instruction) ? '基本信息' : '分组一',
          targets: left.map((f) => (f.id ? { id: f.id } : { name: f.name! })),
        },
        {
          label: /评估|题目/.test(instruction) ? '评估题目' : '分组二',
          targets: right.map((f) => (f.id ? { id: f.id } : { name: f.name! })),
        },
      ],
    })
  }

  if (wantOptions) {
    const choice = flat.find((f) => f.type === 'radio' || f.type === 'select')
    if (choice) {
      operations.push({
        op: 'updateField',
        target: choice.id ? { id: choice.id } : { name: choice.name! },
        patch: {
          optionItems: [
            { value: 4, label: '4分：很好' },
            { value: 2, label: '2分：一般' },
            { value: 0, label: '0分：较差' },
          ],
        },
      })
    } else {
      warnings.push('未找到 radio/select，跳过选项优化')
    }
  }

  if (wantFormula) {
    const numberField = flat.find((f) => f.type === 'number')
    const scoreFields = flat.filter((f) => f.type === 'radio' || f.type === 'number').slice(0, 3)
    if (numberField && scoreFields.length > 0) {
      const expr = scoreFields
        .map((f) => f.name || f.id)
        .filter(Boolean)
        .join('+')
      operations.push({
        op: 'setFormula',
        target: numberField.id ? { id: numberField.id } : { name: numberField.name! },
        formula: expr || '0',
        formulaEnabled: true,
      })
    } else {
      const names = scoreFields.map((f) => f.name).filter(Boolean) as string[]
      operations.push({
        op: 'addField',
        field: {
          key: 'total_score',
          label: '总分',
          type: 'number',
          required: false,
          formulaEnabled: true,
          formula: names.length >= 2 ? names.join('+') : names[0] || '0',
        },
      })
    }
  }

  if (operations.length === 0) {
    operations.push({
      op: 'addField',
      field: {
        key: 'ai_note',
        label: '优化备注',
        type: 'textarea',
        required: false,
      },
    })
    warnings.push('指令未匹配到 tab/选项/公式模式，已降级为追加备注字段')
  }

  return refinePlanSchema.parse({
    summary: `已根据指令规划 ${operations.length} 项变更`,
    warnings,
    operations,
  })
}
