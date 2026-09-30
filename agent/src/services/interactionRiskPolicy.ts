/**
 * v0.10 Ask-before-act 风险重判（不信任模型自评）。
 */
import type { FormJson } from '../schemas/refinePlan.js'
import type { InteractionOutput } from '../schemas/interactionOutput.js'
import {
  L2_CLARIFY_BEFORE_GENERATE,
  RISK_CODES,
  type RiskCode,
  type RiskFact,
  type RiskLevel,
  maxRiskLevel,
} from '../schemas/clarification.js'
import { checkHandlersNetworkStatic, checkInteractionNetworkStatic } from './interactionNetworkPolicy.js'
import { readExistingHandlerCode } from './interactionMerger.js'

export type RiskAssessment = {
  riskLevel: RiskLevel
  riskFacts: RiskFact[]
  /** 须 need_clarification（不含仅 event_overwrite） */
  requiresClarification: boolean
  /** L3 → unsupported */
  reject: boolean
}

function fact(code: RiskCode, level: RiskLevel, message: string, relatedTargets?: string[]): RiskFact {
  return { code, level, message, ...(relatedTargets?.length ? { relatedTargets } : {}) }
}

function scanInstruction(instruction: string): RiskFact[] {
  const t = instruction || ''
  const facts: RiskFact[] = []
  if (/上传|upload|fileList|action\s*[:=]|oss|七牛|cos/i.test(t)) {
    facts.push(fact('upload_config', 'L2', '指令涉及上传或文件配置'))
  }
  if (/数据源|datasource|远程\s*数据|executeDataSource|接口请求|调接口/i.test(t)) {
    facts.push(fact('remote_datasource', 'L2', '指令涉及声明式远程数据源'))
  }
  if (/跳转|打开链接|window\.location|router\.|href|外链|导航到/i.test(t)) {
    facts.push(fact('navigation', 'L2', '指令涉及页面跳转或外链'))
  }
  if (/localStorage|sessionStorage|cookie|浏览器存储/i.test(t)) {
    facts.push(fact('browser_storage', 'L2', '指令涉及浏览器存储'))
  }
  if (/\beval\b|new\s+Function|动态执行|执行字符串代码/i.test(t)) {
    facts.push(fact('eval_like', 'L2', '指令涉及 eval / 动态代码执行'))
  }
  if (/批量删除|全部删|清空表单|重建表单|推倒重来/i.test(t)) {
    facts.push(fact('bulk_delete_rebuild', 'L2', '指令涉及批量删除或大范围重建'))
  }
  if (/((写入|保存|存入).*(密码|密钥|secret|api[_-]?key|凭据)|(密码|密钥|secret|api[_-]?key|凭据).*(写入|保存)|凭据写入|把\s*api[_-]?key)/i.test(t)) {
    facts.push(fact('credential_write', 'L3', '指令涉及凭据写入'))
  }
  if (/生产环境写|写生产|外部系统写|未授权\s*connector/i.test(t)) {
    facts.push(fact('production_external_write', 'L3', '指令涉及生产外部写'))
  }
  if (/永久删除且无法恢复|不可逆销毁/i.test(t)) {
    facts.push(fact('irreversible', 'L3', '指令涉及不可逆动作'))
  }
  if (/fetch\s*\(|XMLHttpRequest|axios\.|WebSocket/i.test(t)) {
    facts.push(fact('network_js', 'L3', '指令要求生成网络请求 JS'))
  }
  return facts
}

function codeHasEvalLike(code: string): boolean {
  return /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/.test(code)
}

function codeHasStorage(code: string): boolean {
  return /\blocalStorage\b|\bsessionStorage\b|\bdocument\.cookie\b/.test(code)
}

function codeHasNavigation(code: string): boolean {
  return /\blocation\.(href|assign|replace)\b|\bwindow\.open\b|\brouter\.(push|replace)\b/.test(code)
}

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

function readExistingEventCode(formJson: FormJson, target: string, eventKey: string): string {
  return readExistingHandlerCode(formJson, target, eventKey)
}

function scanOutput(formJson: FormJson, output: InteractionOutput): RiskFact[] {
  const facts: RiskFact[] = []
  const handlers = output.handlers || []

  for (const op of output.structure || []) {
    const rec = op as { op?: string; type?: string }
    if (rec.op === 'addButton') continue
    if (rec.op === 'removeField' || rec.op === 'removeFieldsInScope') {
      facts.push(fact('bulk_delete_rebuild', 'L2', `结构操作 ${rec.op}`, [rec.op || '']))
    }
    if (String(rec.type || '').toLowerCase().includes('upload')) {
      facts.push(fact('upload_config', 'L2', '结构含上传类控件'))
    }
  }

  const formConfig = formJson.formConfig || {}
  if (Array.isArray((formConfig as { dataSources?: unknown }).dataSources) || formConfig.dataSource) {
    // only flag if output tries to mutate — heuristic via summary/structure text
  }

  for (const h of handlers) {
    const existing = readExistingEventCode(formJson, h.target, h.eventKey)
    if (existing.trim()) {
      facts.push(
        fact('event_overwrite', 'L2', `事件键已有代码：${h.target}.${h.eventKey}`, [
          `${h.target}.${h.eventKey}`,
        ]),
      )
    }
    if (codeHasEvalLike(h.code || '')) {
      facts.push(fact('eval_like', 'L2', `handler 含 eval/Function：${h.target}.${h.eventKey}`, [
        `${h.target}.${h.eventKey}`,
      ]))
    }
    if (codeHasStorage(h.code || '')) {
      facts.push(
        fact('browser_storage', 'L2', `handler 含浏览器存储：${h.target}.${h.eventKey}`, [
          `${h.target}.${h.eventKey}`,
        ]),
      )
    }
    if (codeHasNavigation(h.code || '')) {
      facts.push(
        fact('navigation', 'L2', `handler 含跳转：${h.target}.${h.eventKey}`, [
          `${h.target}.${h.eventKey}`,
        ]),
      )
    }
  }

  if (handlers.length) {
    const net = checkHandlersNetworkStatic(handlers)
    if (!net.ok && net.reason === 'network') {
      facts.push(fact('network_js', 'L3', net.message, net.hits))
    }
  }

  return facts
}

function dedupeFacts(facts: RiskFact[]): RiskFact[] {
  const seen = new Set<string>()
  const out: RiskFact[] = []
  for (const f of facts) {
    const key = `${f.code}|${f.message}|${(f.relatedTargets || []).join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/**
 * 服务端风险重判。
 * - 仅 instruction：用于 generate 前门禁
 * - 带 output：用于模型产物后重判
 */
export function assessInteractionRisk(params: {
  instruction: string
  formJson: FormJson
  output?: InteractionOutput
}): RiskAssessment {
  const facts = dedupeFacts([
    ...scanInstruction(params.instruction),
    ...(params.output ? scanOutput(params.formJson, params.output) : []),
  ])

  const hasWrite =
    Boolean(params.output?.handlers?.length) ||
    Boolean(params.output?.structure?.length) ||
    /改|加|删|写|联动|计算|显示|隐藏|禁用|必填/.test(params.instruction || '')

  if (!facts.length) {
    if (!hasWrite && !params.output) {
      facts.push(fact('local_reversible', 'L1', '未检出高风险；按本地可逆默认'))
    } else if (!params.output?.handlers?.length && !params.output?.structure?.length && params.output) {
      facts.push(fact('read_only', 'L0', '无写入产物'))
    } else {
      facts.push(fact('local_reversible', 'L1', '本地可逆结构/交互候选'))
    }
  }

  const riskLevel = maxRiskLevel(facts)
  const reject = facts.some((f) => f.level === 'L3')
  const requiresClarification =
    !reject &&
    facts.some((f) => f.level === 'L2' && L2_CLARIFY_BEFORE_GENERATE.has(f.code))

  return { riskLevel, riskFacts: facts, requiresClarification, reject }
}

/** 设计 §4.1 code 表与实现枚举一致性 */
export function checkRiskPolicyParity(): string[] {
  const issues: string[] = []
  const expected = [
    'read_only',
    'local_reversible',
    'upload_config',
    'remote_datasource',
    'navigation',
    'browser_storage',
    'eval_like',
    'event_overwrite',
    'bulk_delete_rebuild',
    'credential_write',
    'network_js',
    'production_external_write',
    'irreversible',
  ]
  if (RISK_CODES.length !== expected.length) {
    issues.push(`RISK_CODES length ${RISK_CODES.length} != ${expected.length}`)
  }
  for (const c of expected) {
    if (!(RISK_CODES as readonly string[]).includes(c)) issues.push(`missing RISK_CODE ${c}`)
  }
  for (const c of RISK_CODES) {
    if (!expected.includes(c)) issues.push(`unexpected RISK_CODE ${c}`)
  }
  return issues
}

/** L2/L3 检测器正负例（供 check 脚本） */
export const RISK_POLICY_FIXTURES: Array<{
  id: string
  code: RiskCode
  positive: boolean
  instruction: string
  codeSnippet?: string
}> = [
  { id: 'upload-pos', code: 'upload_config', positive: true, instruction: '给表单加一个上传头像' },
  { id: 'upload-neg', code: 'upload_config', positive: false, instruction: '把标题改成订单信息' },
  { id: 'remote-pos', code: 'remote_datasource', positive: true, instruction: '下拉选项走远程数据源' },
  { id: 'remote-neg', code: 'remote_datasource', positive: false, instruction: '下拉选项写死三个城市' },
  { id: 'nav-pos', code: 'navigation', positive: true, instruction: '点击按钮跳转到首页' },
  { id: 'nav-neg', code: 'navigation', positive: false, instruction: '点击按钮显示成功提示' },
  { id: 'storage-pos', code: 'browser_storage', positive: true, instruction: '把表单缓存到 localStorage' },
  { id: 'storage-neg', code: 'browser_storage', positive: false, instruction: '把备注设为必填' },
  { id: 'eval-pos', code: 'eval_like', positive: true, instruction: '用 eval 执行用户输入的公式' },
  { id: 'eval-neg', code: 'eval_like', positive: false, instruction: '金额等于数量乘单价' },
  { id: 'bulk-pos', code: 'bulk_delete_rebuild', positive: true, instruction: '批量删除所有字段并重建' },
  { id: 'bulk-neg', code: 'bulk_delete_rebuild', positive: false, instruction: '删除备注字段' },
  { id: 'cred-pos', code: 'credential_write', positive: true, instruction: '把 api_key 密码写进表单' },
  { id: 'cred-neg', code: 'credential_write', positive: false, instruction: '增加一个密码输入框用于登录' },
  {
    id: 'net-pos',
    code: 'network_js',
    positive: true,
    instruction: 'onChange 里 fetch("/api") 拉数据',
  },
  { id: 'net-neg', code: 'network_js', positive: false, instruction: 'onChange 时本地计算金额' },
  {
    id: 'prod-pos',
    code: 'production_external_write',
    positive: true,
    instruction: '直接写生产环境外部系统',
  },
  { id: 'prod-neg', code: 'production_external_write', positive: false, instruction: '预览里验证表单' },
  {
    id: 'irr-pos',
    code: 'irreversible',
    positive: true,
    instruction: '永久删除且无法恢复所有历史数据',
  },
  { id: 'irr-neg', code: 'irreversible', positive: false, instruction: '隐藏备注字段' },
  {
    id: 'overwrite-pos',
    code: 'event_overwrite',
    positive: true,
    instruction: '改写已有 onChange',
    codeSnippet: '/* existing */',
  },
  {
    id: 'overwrite-neg',
    code: 'event_overwrite',
    positive: false,
    instruction: '给空事件写 onChange',
  },
]

export function runRiskPolicyFixtureChecks(emptyForm: FormJson): string[] {
  const issues: string[] = []
  for (const fx of RISK_POLICY_FIXTURES) {
    if (fx.code === 'event_overwrite') {
      const form: FormJson = JSON.parse(JSON.stringify(emptyForm))
      const widgets = walkWidgets(form.widgetList as WidgetNode[])
      const w = widgets.find((n) => n.type === 'input' || n.options?.name) || widgets[0]
      if (!w) {
        issues.push(`${fx.id}: no widget`)
        continue
      }
      const name = String(w.options?.name || w.id || 'field')
      if (fx.positive) {
        w.options = { ...(w.options || {}), name, onChange: 'console.log(1)' }
      } else {
        w.options = { ...(w.options || {}), name, onChange: '' }
      }
      const output = {
        intent: 'interaction' as const,
        summary: '',
        structure: [],
        handlers: [
          {
            target: name,
            eventKey: 'onChange',
            code: 'this.setValue(1)',
            explain: '',
          },
        ],
        scenarios: [],
        unsupported: [],
      }
      const a = assessInteractionRisk({ instruction: fx.instruction, formJson: form, output })
      const hit = a.riskFacts.some((f) => f.code === 'event_overwrite')
      if (fx.positive && !hit) issues.push(`${fx.id}: expected event_overwrite`)
      if (!fx.positive && hit) issues.push(`${fx.id}: unexpected event_overwrite`)
      continue
    }

    if (fx.code === 'network_js' && fx.positive) {
      const net = checkInteractionNetworkStatic('fetch("/api")')
      if (net.ok) issues.push(`${fx.id}: fetch should fail network policy`)
      const a = assessInteractionRisk({
        instruction: fx.instruction,
        formJson: emptyForm,
        output: {
          intent: 'interaction',
          summary: '',
          structure: [],
          handlers: [{ target: 'form', eventKey: 'onFormMounted', code: 'fetch("/api")', explain: '' }],
          scenarios: [],
          unsupported: [],
        },
      })
      if (!a.riskFacts.some((f) => f.code === 'network_js')) issues.push(`${fx.id}: expected network_js`)
      continue
    }

    const a = assessInteractionRisk({ instruction: fx.instruction, formJson: emptyForm })
    const hit = a.riskFacts.some((f) => f.code === fx.code)
    if (fx.positive && !hit) issues.push(`${fx.id}: expected ${fx.code}`)
    if (!fx.positive && hit) issues.push(`${fx.id}: unexpected ${fx.code}`)
  }
  return issues
}
