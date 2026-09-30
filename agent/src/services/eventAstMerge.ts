/**
 * 事件 AST 安全合并（prepend / append）；不确定则 mergeSafe=false。
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

function tryParse(code: string): { ok: true; body: acorn.Node[] } | { ok: false; message: string } {
  try {
    const ast = acorn.parse(code || '', PARSE_OPTS) as acorn.Node & { body?: acorn.Node[] }
    const body = Array.isArray(ast.body) ? ast.body : []
    return { ok: true, body }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function collectUnconditionalAssignTargets(nodes: acorn.Node[], out: Set<string>) {
  for (const n of nodes as any[]) {
    if (!n || typeof n !== 'object') continue
    if (n.type === 'ReturnStatement') {
      out.add('__return__')
    }
    if (n.type === 'ExpressionStatement' && n.expression?.type === 'AssignmentExpression') {
      const left = n.expression.left
      if (left?.type === 'Identifier') out.add(`id:${left.name}`)
      if (left?.type === 'MemberExpression' && !left.computed && left.property?.type === 'Identifier') {
        const obj = left.object?.type === 'Identifier' ? left.object.name : '?'
        out.add(`mem:${obj}.${left.property.name}`)
      }
    }
    if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations || []) {
        if (d.id?.type === 'Identifier') out.add(`var:${d.id.name}`)
      }
    }
  }
}

function hasAssignConflict(a: acorn.Node[], b: acorn.Node[]): boolean {
  const sa = new Set<string>()
  const sb = new Set<string>()
  collectUnconditionalAssignTargets(a, sa)
  collectUnconditionalAssignTargets(b, sb)
  for (const x of sa) {
    if (x === '__return__' && sb.has('__return__')) return true
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
  mergedPrepend?: string
  mergedAppend?: string
}

export function assessEventMergeSafety(existingCode: string, incomingCode: string): MergeSafety {
  const oldP = tryParse(existingCode)
  const newP = tryParse(incomingCode)
  if (!oldP.ok || !newP.ok) {
    return {
      mergeSafe: false,
      suggestedModes: ['overwrite', 'cancel'],
      reason: !oldP.ok ? `existing parse: ${oldP.message}` : `incoming parse: ${(newP as { message: string }).message}`,
    }
  }
  if (hasAssignConflict(oldP.body, newP.body)) {
    return {
      mergeSafe: false,
      suggestedModes: ['overwrite', 'cancel'],
      reason: 'unconditional assign/return conflict',
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
        suggestedModes: ['overwrite', 'cancel'],
        reason: `merged ${label}: ${net.message}`,
      }
    }
  }

  return {
    mergeSafe: true,
    suggestedModes: ['prepend', 'append', 'overwrite', 'cancel'],
    mergedPrepend: prepend,
    mergedAppend: append,
  }
}

export function buildEventConflict(params: {
  target: string
  eventKey: string
  existingCode: string
  incomingCode: string
}): EventConflict {
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
  }
}

export function applyMergeMode(
  mode: EventMergeMode,
  existingCode: string,
  incomingCode: string,
): { ok: true; code: string } | { ok: false; skip: true } | { ok: false; error: string } {
  if (mode === 'cancel') return { ok: false, skip: true }
  if (mode === 'overwrite') return { ok: true, code: incomingCode }
  if (mode === 'prepend' || mode === 'append') {
    const safety = assessEventMergeSafety(existingCode, incomingCode)
    if (!safety.mergeSafe) {
      return { ok: false, error: safety.reason || 'merge not safe' }
    }
    return { ok: true, code: wrapMergedCode(mode, existingCode, incomingCode) }
  }
  return { ok: false, error: `unknown mode ${mode}` }
}
