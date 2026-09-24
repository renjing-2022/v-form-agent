import fs from 'node:fs'
import path from 'node:path'
import { chatCompletion, type ChatMessage } from './deepseek.js'
import { buildFormSummary } from './formSummary.js'
import { renderInteractionApiReferenceMarkdown } from '../knowledge/interactionApiReference.js'
import {
  interactionOutputSchema,
  type InteractionOutput,
} from '../schemas/interactionOutput.js'
import type { FormJson as RefineFormJson } from '../schemas/refinePlan.js'
import { validateInteractionOutput } from './interactionValidate.js'
import { checkHandlersNetworkStatic } from './interactionNetworkPolicy.js'
import { buildInteractionCandidate } from './interactionApply.js'

function withCandidate(
  formJson: RefineFormJson,
  base: GenerateInteractionResult,
): GenerateInteractionResult {
  if (base.status !== 'generated') return base
  const preview = buildInteractionCandidate(formJson, base.output)
  if (!preview.ok) {
    return {
      ...base,
      status: 'error',
      error: preview.error,
      issues: [{ path: 'merge', message: preview.error }],
    }
  }
  return {
    ...base,
    formJsonCandidate: preview.formJsonCandidate,
    scenarioNarration: preview.scenarioNarration,
    scenarioFingerprint: preview.scenarioFingerprint,
    mergeWarnings: preview.warnings,
  }
}

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

/** 将模型常见的 act/assert 别名收敛到契约形状，减少无意义 rewrite */
function normalizeActItem(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const o = raw as Record<string, unknown>
  if ('input' in o || 'click' in o || 'switchTab' in o || 'mount' in o || 'addSubFormRow' in o || 'submit' in o || 'wait' in o) {
    return o
  }
  const type = String(o.type || o.action || o.op || '').toLowerCase()
  const field = String(o.field || o.name || o.target || o.input || '')
  if ((type === 'input' || type === 'set' || type === 'setvalue' || type === 'change' || ('value' in o && field)) && field) {
    return { input: field, value: o.value }
  }
  if (type === 'click' || type === 'tap') {
    const t = String(o.click || o.target || o.name || o.button || field)
    if (t) return { click: t }
  }
  if (type === 'switchtab' || type === 'tab') {
    return { switchTab: o.switchTab ?? o.index ?? o.value ?? o.tab ?? 0 }
  }
  if (type === 'mount' || o.mount === true) return { mount: true }
  if (type === 'submit' || o.submit === true) return { submit: true }
  if (type === 'wait' || typeof o.wait === 'number') return { wait: Number(o.wait || o.ms || 100) }
  if (type === 'addsubformrow' || type === 'addrow') {
    return { addSubFormRow: String(o.addSubFormRow || o.subForm || field), values: o.values as Record<string, unknown> | undefined }
  }
  if (typeof o.click === 'string') return { click: o.click }
  if (typeof o.input === 'string') return { input: o.input, value: o.value }
  return o
}

function normalizeAssertItem(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const o = raw as Record<string, unknown>
  if (
    ('field' in o && ('value' in o || 'hidden' in o || 'disabled' in o || 'required' in o || 'label' in o)) ||
    'activeTab' in o ||
    'focused' in o ||
    'valid' in o ||
    'dialogVisible' in o ||
    'subFormRows' in o ||
    'noNetwork' in o ||
    'noError' in o
  ) {
    return o
  }
  if (o.noError === true || o.noerror === true) return { noError: true }
  if (o.noNetwork === true || o.nonetwork === true) return { noNetwork: true }
  if ('equals' in o && (o.field || o.name)) return { field: String(o.field || o.name), value: o.equals }
  if ('expected' in o && (o.field || o.name)) return { field: String(o.field || o.name), value: o.expected }
  if (typeof o.valid === 'boolean') return { valid: o.valid }
  if (o.activeTab !== undefined || o.tab !== undefined) return { activeTab: o.activeTab ?? o.tab }
  if (typeof o.focused === 'string' || typeof o.focus === 'string') return { focused: String(o.focused || o.focus) }
  if (o.dialog || o.dialogVisible) {
    return { dialogVisible: String(o.dialogVisible || o.dialog), value: o.value !== undefined ? Boolean(o.value) : true }
  }
  // { amount: 200 } → field/value（单键且非保留字）
  const keys = Object.keys(o)
  if (keys.length === 1) {
    const k = keys[0]
    if (!['type', 'action', 'op', 'expect', 'assert'].includes(k)) return { field: k, value: o[k] }
  }
  if (o.expect && typeof o.expect === 'object' && !Array.isArray(o.expect)) {
    const e = o.expect as Record<string, unknown>
    const ek = Object.keys(e)
    if (ek.length === 1) return { field: ek[0], value: e[ek[0]] }
  }
  return o
}

function normalizeInteractionRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const root = { ...(raw as Record<string, unknown>) }
  if (Array.isArray(root.scenarios)) {
    root.scenarios = root.scenarios.map((sc) => {
      if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return sc
      const s = { ...(sc as Record<string, unknown>) }
      if (Array.isArray(s.act)) s.act = s.act.map(normalizeActItem)
      if (Array.isArray(s.assert)) s.assert = s.assert.map(normalizeAssertItem)
      if (!Array.isArray(s.handlerRefs) && typeof s.handlerRef === 'string') s.handlerRefs = [s.handlerRef]
      if (!s.id && s.name) s.id = s.name
      if (!s.title) s.title = String(s.id || 'scenario')
      return s
    })
  }
  if (Array.isArray(root.handlers)) {
    root.handlers = root.handlers.map((h, i) => {
      if (!h || typeof h !== 'object' || Array.isArray(h)) return h
      const hh = { ...(h as Record<string, unknown>) }
      if (!hh.id) hh.id = `h${i + 1}`
      if (!hh.explain) hh.explain = ''
      if (hh.code == null && typeof hh.body === 'string') hh.code = hh.body
      return hh
    })
  }
  return root
}

function resolveRepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'agent', 'package.json')) && fs.existsSync(path.join(dir, 'v-form'))) {
      return dir
    }
    if (path.basename(dir) === 'agent' && fs.existsSync(path.join(dir, 'package.json'))) {
      return path.dirname(dir)
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(process.cwd(), '..')
}

export function getInteractionFixtureDir(root = resolveRepoRoot()): string {
  return path.join(root, 'agent', 'fixtures', 'interaction', 'replay')
}

type ReplayFile = {
  match: { instructionIncludes?: string[]; instructionEquals?: string; scenarioId?: string }
  output: unknown
  repairs?: unknown[]
}

function loadReplayFixture(instruction: string, root = resolveRepoRoot()): ReplayFile | null {
  const dir = getInteractionFixtureDir(root)
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as ReplayFile
    if (raw.match?.instructionEquals && raw.match.instructionEquals === instruction) return raw
    if (
      raw.match?.instructionIncludes?.length &&
      raw.match.instructionIncludes.every((s) => instruction.includes(s))
    ) {
      return raw
    }
  }
  return null
}

/**
 * mock 无 fixture 时的本地意图回退：避免把纯结构/澄清/禁网指令误报成 error，
 * 以便 AiChat 仍能 route_refine → /refine（v0.7/v0.6 回归路径）。
 * 未识别的交互类指令仍返回 null，由调用方诚实报错（禁止模板回退）。
 */
function localIntentFallback(instruction: string): InteractionOutput | null {
  const text = String(instruction || '').trim()
  if (!text) {
    return interactionOutputSchema.parse({
      intent: 'need_clarification',
      summary: '请描述要做的交互或结构变更',
      questions: ['你想改结构属性，还是写字段联动/按钮/校验？'],
    })
  }
  if (/接口|调用api|fetch|axios|上传|附件|数据源|executeDataSource|发到后端|保存到服务器|网络请求/i.test(text)) {
    return interactionOutputSchema.parse({
      intent: 'unsupported',
      summary: '需求包含网络请求，本管线仅支持纯前端交互',
      unsupported: [{ text, reason: 'network' }],
    })
  }
  if (/加点交互|改一下那个|那个字段/i.test(text)) {
    return interactionOutputSchema.parse({
      intent: 'need_clarification',
      summary: '交互意图不完整，需要补充',
      questions: ['触发条件是什么（改哪个字段/点哪个按钮）？', '期望发生什么（赋值、显隐、校验）？', '如何验收（输入与期望值）？'],
    })
  }
  const structureCue =
    /标签宽度|labelWidth|labelAlign|对齐|删掉|删除|去掉|移除|新增.*字段|加一个.*字段|加一列|删.*列|列宽度|宽度改为|改成多行|多行文本|placeholder|占位|字号|选项|移到|复制|必填|非必填|cssCode|行号|showRowNumber|弹窗标题|子表显示|空白行/i.test(
      text,
    )
  const interactionCue =
    /联动|自动算|显示.*并|隐藏|禁用|启用|校验|提交前|点击|按钮|下一页|上一页|onChange|onClick|重置|填入|打开表单时|默认停在|金额等于|实付|打开.*弹窗/i.test(
      text,
    )
  if (structureCue && !interactionCue) {
    return interactionOutputSchema.parse({
      intent: 'structure_only',
      summary: '判定为纯结构/属性优化，应交 /refine',
    })
  }
  return null
}

const systemPrompt = `你是 v-form 纯前端交互工程师。根据用户自然语言与当前表单，直接写出事件 JS（像前端程序员），并给出可自动执行的验证场景。
只输出 JSON（不要 Markdown），字段：
- intent: interaction | mixed | structure_only | unsupported | need_clarification
- summary: 中文说明
- structure: 结构操作数组。需要新按钮时用 { "op":"addButton", "label":"下一页", "name":"btnNext", "eachTabPane":true }
- handlers: [{ "id", "target"(控件 name 或 "form"), "eventKey", "code"(函数体), "explain" }]
- scenarios: [{ "id", "handlerRefs"(指向 handler id 或 target:eventKey), "title", "arrange", "act", "assert" }]
- unsupported: [{ "text", "reason" }]
- questions: need_clarification 时必填

scenarios 形状必须严格如下（不要自造 type/action/expect 字段）：
- arrange: { "values": { "qty": 2, "price": 100 }, "activeTab": 0 }
- act 数组元素只能是其一：
  { "input": "qty", "value": 2 } | { "click": "btnNext" } | { "switchTab": 1 } | { "mount": true } |
  { "addSubFormRow": "detail", "values": { "qty": 1 } } | { "submit": true } | { "wait": 100 }
- assert 数组元素只能是其一：
  { "field": "amount", "value": 200 } | { "field": "x", "hidden": true } | { "field": "x", "disabled": true } |
  { "field": "x", "required": true } | { "activeTab": 1 } | { "focused": "name" } | { "valid": false } |
  { "dialogVisible": "helpDlg", "value": true } | { "subFormRows": "detail", "count": 2 } |
  { "noNetwork": true } | { "noError": true }
示例 scenario：
{ "id":"s1", "handlerRefs":["h-qty"], "title":"算金额", "arrange":{"values":{"qty":2,"price":100,"discount":10}},
  "act":[{"input":"qty","value":2}], "assert":[{"field":"amount","value":200},{"field":"pay","value":190},{"noError":true}] }

规则：
1. 纯前端：禁止 fetch / XMLHttpRequest / WebSocket / axios / executeDataSource / 上传 / 数据源请求。
2. 代码通过 this 或 this.getFormRef() 调用 VForm 渲染态 API（见参考手册）；可写任意纯前端 JS。
3. 每个 handler 至少被一个 scenario 覆盖；有分支的交互要覆盖正反两侧。
4. 指代不清 → need_clarification + questions；纯改结构无交互 → structure_only；核心意图含网络 → unsupported。
5. target 必须是表单已有 name，或本输出 structure 里 addButton 的 name；form 级事件 target 为 "form"。
6. onFormValidate 返回 false 表示失败；按钮用 onClick。
7. 用户指令已足够清晰时直接 intent=interaction 或 mixed，不要无故 need_clarification。`

export type GenerateInteractionResult = {
  output: InteractionOutput
  status:
    | 'generated'
    | 'need_clarification'
    | 'route_refine'
    | 'unsupported'
    | 'error'
  usedMock: boolean
  rewriteCount: number
  issues?: { path: string; message: string }[]
  error?: string
  formJsonCandidate?: RefineFormJson
  scenarioNarration?: string[]
  scenarioFingerprint?: string
  mergeWarnings?: string[]
}

function mapStatus(output: InteractionOutput): GenerateInteractionResult['status'] {
  if (output.intent === 'need_clarification') return 'need_clarification'
  if (output.intent === 'structure_only') return 'route_refine'
  if (output.intent === 'unsupported') return 'unsupported'
  return 'generated'
}

function parseAndValidate(
  raw: unknown,
  formJson: RefineFormJson,
): { ok: true; output: InteractionOutput } | { ok: false; issues: { path: string; message: string }[]; output?: InteractionOutput } {
  const parsed = interactionOutputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    }
  }
  const issues = validateInteractionOutput(parsed.data, formJson)
  if (issues.length) return { ok: false, issues, output: parsed.data }
  if (parsed.data.handlers.length > 0) {
    const net = checkHandlersNetworkStatic(parsed.data.handlers)
    if (!net.ok) {
      return {
        ok: false,
        issues: [{ path: 'handlers', message: net.message }],
        output: parsed.data,
      }
    }
  }
  return { ok: true, output: parsed.data }
}

export async function generateInteraction(params: {
  instruction: string
  currentFormJson: RefineFormJson
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<GenerateInteractionResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  const allowMock = process.env.AGENT_ALLOW_MOCK === '1'

  if (!apiKey) {
    if (!allowMock) {
      return {
        output: interactionOutputSchema.parse({
          intent: 'need_clarification',
          summary: '模型不可用',
          questions: ['服务端未配置 DEEPSEEK_API_KEY'],
        }),
        status: 'error',
        usedMock: false,
        rewriteCount: 0,
        error: 'DEEPSEEK_API_KEY is not configured',
      }
    }
    const replay = loadReplayFixture(params.instruction)
    if (!replay) {
      const local = localIntentFallback(params.instruction)
      if (local) {
        return {
          output: local,
          status: mapStatus(local),
          usedMock: true,
          rewriteCount: 0,
        }
      }
      return {
        output: interactionOutputSchema.parse({
          intent: 'need_clarification',
          summary: '无回放 fixture',
          questions: ['mock 模式缺少匹配的 interaction fixture'],
        }),
        status: 'error',
        usedMock: true,
        rewriteCount: 0,
        error: 'no interaction replay fixture matched instruction (no template fallback)',
      }
    }
    const checked = parseAndValidate(replay.output, params.currentFormJson)
    if (!checked.ok) {
      return {
        output:
          checked.output ||
          interactionOutputSchema.parse({
            intent: 'need_clarification',
            summary: 'fixture 无效',
            questions: checked.issues.map((i) => i.message),
          }),
        status: 'error',
        usedMock: true,
        rewriteCount: 0,
        issues: checked.issues,
        error: 'replay fixture failed validation',
      }
    }
    return withCandidate(params.currentFormJson, {
      output: checked.output,
      status: mapStatus(checked.output),
      usedMock: true,
      rewriteCount: 0,
    })
  }

  const history = (params.messages || []).slice(-12).map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }))
  const formSummary = buildFormSummary(params.currentFormJson, params.instruction)
  const apiManual = renderInteractionApiReferenceMarkdown()

  const userPayload = {
    instruction: params.instruction,
    formSummary,
    apiManual,
  }

  let rewriteCount = 0
  let lastIssues: { path: string; message: string }[] = []
  let content = await chatCompletion([
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: JSON.stringify(userPayload) },
  ])

  for (;;) {
    let raw: unknown
    try {
      raw = extractJsonObject(content)
    } catch (err) {
      lastIssues = [{ path: '(root)', message: err instanceof Error ? err.message : String(err) }]
      if (rewriteCount >= 1) break
      rewriteCount++
      content = await chatCompletion([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify({
            ...userPayload,
            previousInvalid: content.slice(0, 2000),
            fixErrors: lastIssues,
            note: '上次输出不是合法 JSON，请只输出修正后的 JSON 对象',
          }),
        },
      ])
      continue
    }

    const checked = parseAndValidate(normalizeInteractionRaw(raw), params.currentFormJson)
    if (checked.ok) {
      return withCandidate(params.currentFormJson, {
        output: checked.output,
        status: mapStatus(checked.output),
        usedMock: false,
        rewriteCount,
      })
    }
    lastIssues = checked.issues
    if (rewriteCount >= 1) {
      return {
        output:
          checked.output ||
          interactionOutputSchema.parse({
            intent: 'need_clarification',
            summary: '模型输出校验失败',
            questions: lastIssues.map((i) => `${i.path}: ${i.message}`),
          }),
        status: 'need_clarification',
        usedMock: false,
        rewriteCount,
        issues: lastIssues,
      }
    }
    rewriteCount++
    content = await chatCompletion([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          ...userPayload,
          previousOutput: raw,
          fixErrors: lastIssues,
          note:
            '请按 fixErrors 修正后重新输出完整 JSON。act/assert 必须使用契约键（input/click/field/value/noError 等），不要使用 type/action/expect。',
        }),
      },
    ])
  }

  return {
    output: interactionOutputSchema.parse({
      intent: 'need_clarification',
      summary: '模型输出无法解析',
      questions: lastIssues.map((i) => `${i.path}: ${i.message}`),
    }),
    status: 'need_clarification',
    usedMock: false,
    rewriteCount,
    issues: lastIssues,
  }
}

