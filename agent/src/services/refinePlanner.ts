import { refinePlanSchema, type FormJson, type RefinePlan } from '../schemas/refinePlan.js'
import { chatCompletion, type ChatMessage } from './deepseek.js'
import { REFINE_CREATE_WHITELIST } from '../knowledge/widgetWhitelist.js'
import { buildCatalogSnippets } from '../knowledge/catalogContext.js'
import { buildFormSummary } from './formSummary.js'

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

const systemPrompt = `你是 v-form 表单优化规划器。根据用户指令与当前表单摘要，输出 RefinePlan JSON（不要 Markdown）。
只能输出 operations，禁止直接输出完整 formJson。
允许的 op：
- updateField: { op, target:{id?|name?}, patch:{...常见可写属性} }  属性必须属于该控件 Catalog writableKeys
- setFormula: { op, target, formula, formulaEnabled? }  （仅 number；formula 可用字段 name，如 score1+score2）
- addField: { op, field:{key,label,type,required?,options?,formula?}, parent? }
- wrapInTabs: { op, tabName?, panes:[{label, targets:[{id:"..."} 或 {name:"..."}]}] }
- patchFormConfig: { op, patch:{labelWidth?,labelPosition?,labelAlign?,size?,layoutType?,cssCode?,customClass?,...} }
- setCustomClass: { op, target, customClass }
- setCssCode: { op, css, mode?:append|replace, target?, customClass? }  css 应尽量绑定 target/customClass，避免全局选择器
重要：target / targets 必须是对象，禁止写成字符串。正确示例 targets:[{"name":"input1"},{"id":"radio2"}]；错误示例 targets:["input1","radio2"]。

属性与样式规则（必须遵守）：
- 能用组件属性表达的（placeholder、labelWidth、labelWrap、displayStyle、columnWidth、size 等）优先 updateField / patchFormConfig，不要先写 CSS。
- 仅当用户明确要改文字/标题/选项文案/描述时，才可修改 label、textContent 或 optionItems 的 label。
- 用户描述样式/布局/对齐/间距/重叠/颜色/字体等视觉问题时：禁止通过改字段或选项文案来「假装」修复；应改可写属性，或输出 setCssCode / setCustomClass。
- 禁止输出事件回调（onChange、onCreated 等）以及 functions/dataSources。

可新建 type 仅限：${REFINE_CREATE_WHITELIST.join(', ')}
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

  const formSummary = buildFormSummary(params.currentFormJson)
  const catalogSnippets = buildCatalogSnippets(formSummary)

  const content = await chatCompletion([
    { role: 'system', content: systemPrompt },
    ...history,
    {
      role: 'user',
      content: JSON.stringify({
        instruction: params.instruction,
        formSummary,
        catalogSnippets,
        note: '请基于 formSummary 的 id/name/path/parent 精确定位；属性写入必须属于 catalogSnippets.writableKeys；未提及控件保持不变。',
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
  const flat = buildFormSummary(current)
  const warnings: string[] = ['当前使用 mock refine 规划（未配置 DeepSeek Key）']
  const operations: RefinePlan['operations'] = []

  const styleIntent =
    /样式|布局|对齐|间距|重叠|遮挡|换行|溢出|颜色|字体|字号|美观|排版|错位|margin|padding|overlap|style|layout|align|css/i.test(
      instruction,
    )
  const explicitTextIntent =
    /文案|改(?:文字|标题|标签)|标题(?:改|换成)|标签名|改(?:成|为|叫)|替换|缩短|加长|rename|wording|内容|措辞|描述|说明文字|字段名|\blabel\b/i.test(
      instruction,
    )
  const wantPlaceholder = /placeholder|占位|提示文字/i.test(instruction)
  const wantPreciseRequired = /时间定向.*必填|必填.*时间定向/i.test(instruction)
  const wantCssApply =
    styleIntent && /cssCode|用CSS|受控样式|css修复/i.test(instruction)
  const wantDangerousCss = /E2E危险CSS/i.test(instruction)
  const wantExplicitRename =
    /改(?:成|为|叫)|标题改成|标签名/i.test(instruction) && !wantPlaceholder
  const wantTabs = /tab|页签|选项卡/i.test(instruction) || (/标签/i.test(instruction) && /tab|页签|选项卡/i.test(instruction))
  const wantOptions = /选项|option|分值|改(?:选项|分值)/i.test(instruction)
  const wantFormula = /公式|总分|合计|计算|求和/i.test(instruction)

  if (wantDangerousCss) {
    return refinePlanSchema.parse({
      summary: 'E2E 危险 CSS 拦截验收',
      warnings,
      operations: [
        {
          op: 'setCssCode',
          css: '@import url(https://evil.example/x.css); body{color:red}',
          mode: 'append',
        },
      ],
    })
  }

  if (wantPlaceholder) {
    const input =
      flat.find((f) => f.type === 'input' && /姓名|name/i.test(f.label || f.name || '')) ||
      flat.find((f) => f.type === 'input')
    if (input) {
      return refinePlanSchema.parse({
        summary: '按 Catalog 修改 input placeholder',
        warnings,
        operations: [
          {
            op: 'updateField',
            target: input.id ? { id: input.id } : { name: input.name! },
            patch: { placeholder: '请输入姓名' },
          },
        ],
      })
    }
  }

  if (wantPreciseRequired) {
    const target = flat.find((f) => /时间定向/.test(f.label || ''))
    if (target) {
      return refinePlanSchema.parse({
        summary: '精准命中时间定向字段并设为必填',
        warnings,
        operations: [
          {
            op: 'updateField',
            target: target.id ? { id: target.id } : { name: target.name! },
            patch: { required: true },
          },
        ],
      })
    }
  }

  if (wantCssApply) {
    const radio =
      flat.find((f) => f.type === 'radio' && /时间定向/.test(f.label || '')) ||
      flat.find((f) => f.type === 'radio')
    if (radio) {
      const cls = `field-${radio.name || radio.id || 'radio'}`
      return refinePlanSchema.parse({
        summary: '受控 cssCode 修复布局重叠',
        warnings,
        operations: [
          {
            op: 'setCssCode',
            css: `.${cls} { margin-top: 12px; display: block; }`,
            mode: 'append',
            target: radio.id ? { id: radio.id } : { name: radio.name! },
            customClass: cls,
          },
        ],
      })
    }
  }

  if (wantExplicitRename && flat[0]) {
    const target = flat[0]
    return refinePlanSchema.parse({
      summary: '按用户要求修改字段标题',
      warnings,
      operations: [
        {
          op: 'updateField',
          target: target.id ? { id: target.id } : { name: target.name! },
          patch: { label: '评估项A' },
        },
      ],
    })
  }

  // 模拟 LLM 用改 label 规避样式问题的错误规划（供 FR-6 / enforceRefineTextPolicy 验收）
  if (
    styleIntent &&
    !explicitTextIntent &&
    !wantOptions &&
    !wantFormula &&
    !wantTabs &&
    !wantCssApply &&
    flat[0]
  ) {
    const target = flat[0]
    return refinePlanSchema.parse({
      summary: '通过缩短标题缓解重叠（模拟错误规划）',
      warnings,
      operations: [
        {
          op: 'updateField',
          target: target.id ? { id: target.id } : { name: target.name! },
          patch: { label: '短标题' },
        },
      ],
    })
  }

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
