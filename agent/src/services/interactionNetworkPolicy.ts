/**
 * v0.9 交互管线：仅禁止网络请求（静态 AST 检查）。
 * 语法错误原样返回，供模型重写。
 */
import * as acorn from 'acorn'

export type NetworkPolicyResult =
  | { ok: true }
  | { ok: false; reason: 'syntax'; message: string }
  | { ok: false; reason: 'network'; message: string; hits: string[] }

const FORBIDDEN_IDENTIFIERS = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'axios',
  'executeDataSource',
  'runDataSourceRequest',
  'initDataSetRequest',
])

const FORBIDDEN_MEMBER = new Set([
  'sendBeacon',
  'open', // XMLHttpRequest.prototype.open — 仅当 object 为 XMLHttpRequest 时；保守：navigator.sendBeacon 已单独拦
])

function walk(node: any, hits: string[]) {
  if (!node || typeof node !== 'object') return

  if (node.type === 'Identifier' && FORBIDDEN_IDENTIFIERS.has(node.name)) {
    hits.push(node.name)
  }

  if (node.type === 'MemberExpression') {
    const prop = node.property
    const propName = prop?.type === 'Identifier' && !node.computed ? prop.name : null
    if (propName === 'sendBeacon') hits.push('navigator.sendBeacon')
    if (propName === 'fetch') hits.push('window.fetch')
  }

  if (node.type === 'NewExpression') {
    const callee = node.callee
    if (callee?.type === 'Identifier' && FORBIDDEN_IDENTIFIERS.has(callee.name)) {
      hits.push(`new ${callee.name}`)
    }
  }

  if (node.type === 'ImportExpression') {
    hits.push('import()')
  }

  if (node.type === 'CallExpression') {
    const c = node.callee
    if (c?.type === 'Identifier' && FORBIDDEN_IDENTIFIERS.has(c.name)) {
      hits.push(`${c.name}()`)
    }
    if (c?.type === 'MemberExpression') {
      const prop = c.property
      const obj = c.object
      const propName = prop?.type === 'Identifier' && !c.computed ? prop.name : ''
      const objName = obj?.type === 'Identifier' ? obj.name : ''
      if (objName === 'navigator' && propName === 'sendBeacon') hits.push('navigator.sendBeacon()')
      if ((objName === 'window' || objName === 'globalThis') && propName === 'fetch') hits.push(`${objName}.fetch()`)
      if (propName === 'executeDataSource') hits.push('executeDataSource()')
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    const child = node[key]
    if (Array.isArray(child)) child.forEach((c) => walk(c, hits))
    else if (child && typeof child === 'object' && child.type) walk(child, hits)
  }
}

export function checkInteractionNetworkStatic(code: string): NetworkPolicyResult {
  let ast: acorn.Node
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    })
  } catch (err) {
    return {
      ok: false,
      reason: 'syntax',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const hits: string[] = []
  walk(ast, hits)
  const unique = [...new Set(hits)]
  // open 单独太宽，上面未加入通用 open
  void FORBIDDEN_MEMBER
  if (unique.length) {
    return {
      ok: false,
      reason: 'network',
      message: `network call forbidden: ${unique.join(', ')}`,
      hits: unique,
    }
  }
  return { ok: true }
}

export function checkHandlersNetworkStatic(
  handlers: Array<{ code: string; target?: string; eventKey?: string }>,
): NetworkPolicyResult {
  const allHits: string[] = []
  for (const h of handlers) {
    const r = checkInteractionNetworkStatic(h.code || '')
    if (!r.ok && r.reason === 'syntax') return r
    if (!r.ok && r.reason === 'network') allHits.push(...r.hits.map((x) => `${h.target || '?'}.${h.eventKey || '?'}:${x}`))
  }
  if (allHits.length) {
    return {
      ok: false,
      reason: 'network',
      message: `network call forbidden: ${allHits.join('; ')}`,
      hits: allHits,
    }
  }
  return { ok: true }
}
