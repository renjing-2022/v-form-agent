/**
 * 事件 AST 安全合并（prepend / append / overwrite / cancel）。
 * 仅在可证明不冲突时 mergeSafe=true；不确定或越出支持语法子集 → 需显式四选一。
 */
import * as acorn from 'acorn'
import { checkInteractionNetworkStatic } from './interactionNetworkPolicy.js'
import type { EventConflict, EventMergeMode } from '../schemas/clarification.js'

const PARSE_OPTS: acorn.Options = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
}

/** 支持语法子集：顶层顺序语句 + 简单声明；越出则无法证明安全 */
const UNSAFE_NODE_TYPES = new Set([
  'WithStatement',
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'ClassDeclaration',
  'ClassExpression',
  'MetaProperty',
  'ImportExpression',
])

export type AstSubsetReport = {
  ok: boolean
  reasons: string[]
}

function tryParse(code: string): { ok: true; body: acorn.Node[] } | { ok: false; message: string } {
  try {
    const ast = acorn.parse(code || '', PARSE_OPTS) as acorn.Node & { body?: acorn.Node[] }
    const body = Array.isArray(ast.body) ? ast.body : []
    return { ok: true, body }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function walkNodes(nodes: acorn.Node[], visit: (n: any) => void) {
  const stack = [...nodes]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    visit(n)
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue
      const v = (n as any)[key]
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && c.type) stack.push(c)
      } else if (v && typeof v === 'object' && v.type) {
        stack.push(v)
      }
    }
  }
}

/** 静态检查是否落在支持语法子集内（不含网络策略） */
export function analyzeSupportedSyntaxSubset(code: string): AstSubsetReport {
  const parsed = tryParse(code)
  if (!parsed.ok) {
    return { ok: false, reasons: [`parse: ${parsed.message}`] }
  }
  const reasons: string[] = []
  walkNodes(parsed.body, (n) => {
    if (UNSAFE_NODE_TYPES.has(n.type)) {
      reasons.push(`unsupported:${n.type}`)
    }
    if (n.type === 'Identifier' && n.name === 'eval') {
      reasons.push('eval_like:eval')
    }
    if (n.type === 'Identifier' && n.name === 'Function') {
      reasons.push('eval_like:Function')
    }
    if (n.type === 'NewExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'Function') {
      reasons.push('eval_like:new Function')
    }
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'eval') {
      reasons.push('eval_like:eval()')
    }
    // 动态成员赋值/读取：无法证明目标集合
    if (n.type === 'MemberExpression' && n.computed) {
      reasons.push('dynamic_member')
    }
    if (
      n.type === 'IfStatement' ||
      n.type === 'SwitchStatement' ||
      n.type === 'TryStatement' ||
      n.type === 'WhileStatement' ||
      n.type === 'DoWhileStatement' ||
      n.type === 'ForStatement' ||
      n.type === 'ForInStatement' ||
      n.type === 'ForOfStatement'
    ) {
      reasons.push(`control_flow:${n.type}`)
    }
    if (n.type === 'AwaitExpression' || n.type === 'YieldExpression') {
      reasons.push(`async_effect:${n.type}`)
    }
  })
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] }
}

function leftTargetKey(left: any): string | null {
  if (!left) return null
  if (left.type === 'Identifier') return `id:${left.name}`
  if (left.type === 'MemberExpression' && !left.computed && left.property?.type === 'Identifier') {
    const obj = left.object?.type === 'Identifier' ? left.object.name : '?'
    return `mem:${obj}.${left.property.name}`
  }
  return 'dyn:member'
}

/**
 * 仅收集「顶层无条件」副作用目标；嵌套控制流由子集分析判为不确定。
 */
function collectTopLevelEffectTargets(nodes: acorn.Node[], out: Set<string>) {
  for (const n of nodes as any[]) {
    if (!n || typeof n !== 'object') continue
    if (n.type === 'ReturnStatement') {
      out.add('__return__')
      continue
    }
    if (n.type === 'ExpressionStatement') {
      const expr = n.expression
      if (expr?.type === 'AssignmentExpression') {
        const key = leftTargetKey(expr.left)
        if (key) out.add(key)
      }
      if (expr?.type === 'UpdateExpression') {
        const key = leftTargetKey(expr.argument)
        if (key) out.add(key)
      }
      if (expr?.type === 'CallExpression') {
        // 顶层调用视为副作用，但不与其它调用自动冲突（除非同 callee+粗粒度）
        const callee =
          expr.callee?.type === 'Identifier'
            ? expr.callee.name
            : expr.callee?.type === 'MemberExpression' && expr.callee.property?.type === 'Identifier'
              ? `memcall:${expr.callee.property.name}`
              : 'call'
        out.add(`call:${callee}`)
      }
      continue
    }
    if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations || []) {
        if (d.id?.type === 'Identifier') out.add(`var:${d.id.name}`)
      }
    }
  }
}

function hasEffectConflict(a: acorn.Node[], b: acorn.Node[]): boolean {
  const sa = new Set<string>()
  const sb = new Set<string>()
  collectTopLevelEffectTargets(a, sa)
  collectTopLevelEffectTargets(b, sb)
  for (const x of sa) {
    if (x === '__return__' && sb.has('__return__')) return true
    if (x.startsWith('call:')) continue // 调用不互斥（前后置常见）
    if (x !== '__return__' && sb.has(x)) return true
  }
  return false
}

export function wrapMergedCode(mode: 'prepend' | 'append', existing: string, incoming: string): string {
  const oldPart = String(existing || '').trimEnd()
  const newPart = String(incoming || '').trimEnd()
  if (mode === 'append') {
    return `/* --- existing --- */\n${oldPart}\n/* --- agent --- */\n${newPart}\n`
  }
  return `/* --- agent --- */\n${newPart}\n/* --- existing --- */\n${oldPart}\n`
}

export type MergeSafety = {
  mergeSafe: boolean
  suggestedModes: EventMergeMode[]
  reason?: string
  reasons?: string[]
  mergedPrepend?: string
  mergedAppend?: string
  /** 覆盖前可回滚的旧代码 */
  rollbackCode: string
}

const FOUR_MODES: EventMergeMode[] = ['prepend', 'append', 'overwrite', 'cancel']

export function assessEventMergeSafety(existingCode: string, incomingCode: string): MergeSafety {
  const rollbackCode = String(existingCode || '')
  const oldP = tryParse(existingCode)
  const newP = tryParse(incomingCode)
  if (!oldP.ok || !newP.ok) {
    return {
      mergeSafe: false,
      suggestedModes: [...FOUR_MODES],
      reason: !oldP.ok ? `existing parse: ${oldP.message}` : `incoming parse: ${(newP as { message: string }).message}`,
      reasons: [!oldP.ok ? `existing parse: ${oldP.message}` : `incoming parse: ${(newP as { message: string }).message}`],
      rollbackCode,
    }
  }

  const oldSubset = analyzeSupportedSyntaxSubset(existingCode)
  const newSubset = analyzeSupportedSyntaxSubset(incomingCode)
  if (!oldSubset.ok || !newSubset.ok) {
    const reasons = [...oldSubset.reasons.map((r) => `existing:${r}`), ...newSubset.reasons.map((r) => `incoming:${r}`)]
    return {
      mergeSafe: false,
      suggestedModes: [...FOUR_MODES],
      reason: reasons[0] || 'outside supported syntax subset',
      reasons,
      rollbackCode,
    }
  }

  if (hasEffectConflict(oldP.body, newP.body)) {
    return {
      mergeSafe: false,
      suggestedModes: [...FOUR_MODES],
      reason: 'unconditional effect conflict',
      reasons: ['unconditional effect conflict'],
      rollbackCode,
    }
  }

  const prepend = wrapMergedCode('prepend', existingCode, incomingCode)
  const append = wrapMergedCode('append', existingCode, incomingCode)
  for (const [label, code] of [
    ['prepend', prepend],
    ['append', append],
  ] as const) {
    const net = checkInteractionNetworkStatic(code)
    if (!net.ok) {
      return {
        mergeSafe: false,
        suggestedModes: [...FOUR_MODES],
        reason: `merged ${label}: ${net.message}`,
        reasons: [`merged ${label}: ${net.message}`],
        rollbackCode,
      }
    }
    const mergedSubset = analyzeSupportedSyntaxSubset(code)
    if (!mergedSubset.ok) {
      return {
        mergeSafe: false,
        suggestedModes: [...FOUR_MODES],
        reason: `merged ${label}: ${mergedSubset.reasons[0]}`,
        reasons: mergedSubset.reasons.map((r) => `merged ${label}: ${r}`),
        rollbackCode,
      }
    }
  }

  return {
    mergeSafe: true,
    suggestedModes: [...FOUR_MODES],
    mergedPrepend: prepend,
    mergedAppend: append,
    rollbackCode,
  }
}

export function buildEventConflict(params: {
  target: string
  eventKey: string
  existingCode: string
  incomingCode: string
}): EventConflict & { rollbackCode: string; reasons?: string[] } {
  const safety = assessEventMergeSafety(params.existingCode, params.incomingCode)
  return {
    target: params.target,
    eventKey: params.eventKey,
    existingCode: params.existingCode,
    incomingCode: params.incomingCode,
    mergeSafe: safety.mergeSafe,
    suggestedModes: safety.suggestedModes,
    diffPreview: {
      old: params.existingCode,
      incoming: params.incomingCode,
      ...(safety.mergedPrepend ? { mergedPrepend: safety.mergedPrepend } : {}),
      ...(safety.mergedAppend ? { mergedAppend: safety.mergedAppend } : {}),
    },
    rollbackCode: safety.rollbackCode,
    reasons: safety.reasons,
  }
}

export function applyMergeMode(
  mode: EventMergeMode,
  existingCode: string,
  incomingCode: string,
  opts?: { force?: boolean },
): { ok: true; code: string; rollbackCode?: string } | { ok: false; skip: true } | { ok: false; error: string } {
  if (mode === 'cancel') return { ok: false, skip: true }
  if (mode === 'overwrite') {
    return { ok: true, code: incomingCode, rollbackCode: String(existingCode || '') }
  }
  if (mode === 'prepend' || mode === 'append') {
    const safety = assessEventMergeSafety(existingCode, incomingCode)
    if (!safety.mergeSafe && !opts?.force) {
      return { ok: false, error: safety.reason || 'merge not safe' }
    }
    // force：仍拒绝无法解析的代码
    const oldP = tryParse(existingCode)
    const newP = tryParse(incomingCode)
    if (!oldP.ok || !newP.ok) {
      return { ok: false, error: !oldP.ok ? oldP.message : (newP as { message: string }).message }
    }
    const net = checkInteractionNetworkStatic(wrapMergedCode(mode, existingCode, incomingCode))
    if (!net.ok) return { ok: false, error: net.message }
    return {
      ok: true,
      code: wrapMergedCode(mode, existingCode, incomingCode),
      rollbackCode: String(existingCode || ''),
    }
  }
  return { ok: false, error: `unknown mode ${mode}` }
}

/** 冲突决策的结构化四选一问题（Ask-before-act） */
export function buildEventMergeClarifyQuestion(conflict: {
  target: string
  eventKey: string
  mergeSafe: boolean
  reason?: string
}): {
  id: string
  type: 'single_choice'
  prompt: string
  required: true
  options: Array<{ id: string; label: string; value: EventMergeMode; recommended?: boolean }>
  riskNote?: string
} {
  const key = `${conflict.target}.${conflict.eventKey}`
  return {
    id: `q_event_merge_${conflict.target}_${conflict.eventKey}`.slice(0, 64),
    type: 'single_choice',
    prompt: conflict.mergeSafe
      ? `事件 ${key} 已有代码，可安全合并。请选择：前置 / 后置 / 覆盖 / 取消`
      : `事件 ${key} 无法证明安全合并${conflict.reason ? `（${conflict.reason}）` : ''}。请显式选择：前置 / 后置 / 覆盖 / 取消`,
    required: true,
    riskNote: conflict.reason,
    options: [
      {
        id: 'prepend',
        label: '前置合并（新代码在前）',
        value: 'prepend',
        recommended: conflict.mergeSafe,
      },
      {
        id: 'append',
        label: '后置合并（旧代码在前）',
        value: 'append',
        recommended: conflict.mergeSafe,
      },
      { id: 'overwrite', label: '覆盖（可回滚候选）', value: 'overwrite' },
      { id: 'cancel', label: '取消该事件写入', value: 'cancel' },
    ],
  }
}
