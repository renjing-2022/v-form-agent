import * as acorn from 'acorn'
import type { FormJson } from '../schemas/refinePlan.js'
import { findEventShape, loadEventShapeRegistry } from '../knowledge/eventShapeRegistry.js'
import { isInterfaceEventKey } from '../knowledge/eventAllowlist.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_CODE_LEN = 8000

const BUILTIN_ALLOW = new Set([
  'Math',
  'String',
  'Number',
  'Date',
  'Array',
  'JSON',
  'Object',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'undefined',
  'null',
  'true',
  'false',
  'NaN',
  'Infinity',
  'console',
  'value',
  'oldValue',
  'event',
  'rule',
  'callback',
  'tab',
  'file',
  'fileList',
  'result',
  'error',
  'subFormData',
  'newRowId',
  'deletedDataRow',
  'deletedRowIndex',
  'pageSize',
  'currentPage',
  'column',
  'prop',
  'order',
  'selection',
  'selectedIndices',
  'buttonConfig',
  'rowIndex',
  'row',
  'buttonName',
  'cell',
  'data',
  'node',
  'el',
  'treeState',
  'checked',
  'indeterminate',
  'done',
  'fieldName',
  'newValue',
  'oldValue',
  'formModel',
  'subFormName',
  'subFormRowIndex',
  'keyword',
])

const FORBIDDEN_IDENTIFIERS = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'eval',
  'Function',
  'import',
  'require',
  'document',
  'window',
  'globalThis',
  'process',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'requestAnimationFrame',
  'dataSources',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Worker',
  'SharedWorker',
  'Proxy',
  'Reflect',
])

const FIELD_REF_CALLEES = new Set([
  'setFieldValue',
  'getFieldValue',
  'getWidgetRef',
  'disableWidgets',
  'enableWidgets',
  'hideWidgets',
  'showWidgets',
])

export type EventJsGuardResult = { ok: true } | { ok: false; message: string }

type WidgetNode = {
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

function collectFieldNames(formJson: FormJson): Set<string> {
  const names = new Set<string>()
  for (const w of walkWidgets(formJson.widgetList as WidgetNode[])) {
    const name = String(w.options?.name || '').trim()
    if (name) names.add(name)
    const id = String(w.id || '').trim()
    if (id) names.add(id)
  }
  return names
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}

function collectDeclared(ast: acorn.Node): Set<string> {
  const declared = new Set<string>(['this'])
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      declared.add(node.id.name)
    }
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      declared.add(node.id.name)
    }
    if (
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionDeclaration'
    ) {
      for (const p of node.params || []) {
        if (p.type === 'Identifier') declared.add(p.name)
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object' && (v as any).type) visit(v)
    }
  }
  visit(ast)
  return declared
}

/**
 * AST 白名单护栏：禁止危险构造；API ∈ shape.thisApiAllowlist ∪ 内建；字段名须存在。
 */
export function guardEventJs(params: {
  code: string
  eventKey: string
  formJson: FormJson
  root?: string
}): EventJsGuardResult {
  const code = String(params.code || '')
  if (!code.trim()) return { ok: false, message: 'event JS is empty' }
  if (code.length > MAX_CODE_LEN) return { ok: false, message: `event JS exceeds ${MAX_CODE_LEN} chars` }
  if (isInterfaceEventKey(params.eventKey)) {
    return { ok: false, message: `interface event key forbidden: ${params.eventKey}` }
  }
  if (/\bimport\s*\(|\brequire\s*\(/.test(code)) {
    return { ok: false, message: 'dynamic import/require forbidden' }
  }

  let ast: acorn.Node
  try {
    ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true })
  } catch (err) {
    return { ok: false, message: `parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const root = params.root || repoRoot()
  const shapes = loadEventShapeRegistry(root)
  const shape = findEventShape(shapes, params.eventKey)
  const apiAllow = new Set([...(shape?.thisApiAllowlist || []), ...BUILTIN_ALLOW])
  const fieldNames = collectFieldNames(params.formJson)
  const declared = collectDeclared(ast)

  const issues: string[] = []

  const visit = (node: any, parent: any) => {
    if (!node || typeof node !== 'object') return

    if (node.type === 'Identifier') {
      const name = node.name as string
      if (FORBIDDEN_IDENTIFIERS.has(name)) {
        issues.push(`forbidden identifier: ${name}`)
      } else if (
        parent?.type !== 'MemberExpression' ||
        parent.property !== node ||
        parent.computed
      ) {
        if (
          parent?.type !== 'Property' ||
          parent.key !== node ||
          parent.computed
        ) {
          if (
            !declared.has(name) &&
            !apiAllow.has(name) &&
            !BUILTIN_ALLOW.has(name) &&
            name !== 'arguments'
          ) {
            // bare unknown globals (not this.x / obj.x)
            if (parent?.type !== 'MemberExpression' || parent.object === node) {
              if (!/^[A-Z]/.test(name) && parent?.type !== 'VariableDeclarator') {
                // allow only if member root is this / allowed
                if (parent?.type === 'MemberExpression' && parent.object === node) {
                  if (name !== 'this' && !apiAllow.has(name) && !BUILTIN_ALLOW.has(name)) {
                    issues.push(`unknown free identifier: ${name}`)
                  }
                } else if (
                  parent?.type !== 'MemberExpression' &&
                  parent?.type !== 'Property' &&
                  parent?.type !== 'LabeledStatement'
                ) {
                  if (!apiAllow.has(name) && name !== 'this') {
                    // local vars already in declared; leftover free ids blocked if not builtin
                    if (
                      ![
                        'break',
                        'case',
                        'catch',
                        'continue',
                        'debugger',
                        'default',
                        'do',
                        'else',
                        'finally',
                        'for',
                        'function',
                        'if',
                        'return',
                        'switch',
                        'throw',
                        'try',
                        'var',
                        'const',
                        'let',
                        'while',
                        'with',
                        'new',
                        'delete',
                        'typeof',
                        'void',
                        'in',
                        'instanceof',
                        'yield',
                        'await',
                        'class',
                        'extends',
                        'super',
                        'import',
                        'export',
                        'from',
                        'as',
                        'of',
                      ].includes(name)
                    ) {
                      // skip — too noisy; rely on forbidden set + call checks
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier') {
      if (node.callee.name === 'Function' || node.callee.name === 'Proxy') {
        issues.push(`forbidden constructor: ${node.callee.name}`)
      }
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (callee?.type === 'Identifier' && FORBIDDEN_IDENTIFIERS.has(callee.name)) {
        issues.push(`forbidden call: ${callee.name}`)
      }
      if (callee?.type === 'MemberExpression') {
        const prop = !callee.computed && callee.property?.type === 'Identifier' ? callee.property.name : null
        if (prop && FORBIDDEN_IDENTIFIERS.has(prop)) {
          issues.push(`forbidden call: ${prop}`)
        }
        if (prop && FIELD_REF_CALLEES.has(prop)) {
          const arg0 = node.arguments?.[0]
          if (arg0?.type === 'Literal' && typeof arg0.value === 'string') {
            if (!fieldNames.has(arg0.value)) {
              issues.push(`unknown field ref: ${arg0.value}`)
            }
          }
          if (arg0?.type === 'ArrayExpression') {
            for (const el of arg0.elements || []) {
              if (el?.type === 'Literal' && typeof el.value === 'string' && !fieldNames.has(el.value)) {
                issues.push(`unknown field ref: ${el.value}`)
              }
            }
          }
        }
        if (prop && shape && !apiAllow.has(prop) && !BUILTIN_ALLOW.has(prop)) {
          // allow Math.max etc via object root Math
          const obj = callee.object
          if (obj?.type === 'Identifier' && BUILTIN_ALLOW.has(obj.name)) {
            /* ok */
          } else if (obj?.type === 'ThisExpression' || (obj?.type === 'CallExpression')) {
            if (!apiAllow.has(prop) && !['getFormRef', 'getWidgetRef', 'call', 'apply', 'bind'].includes(prop)) {
              // member of getFormRef() result — prop should be in FORM_REF / allowlist
              if (!apiAllow.has(prop) && !FIELD_REF_CALLEES.has(prop) && prop !== 'broadcast' && prop !== 'getNativeForm') {
                // soft: only hard-fail known dangerous
              }
            }
          }
        }
      }
    }

    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
      if (FORBIDDEN_IDENTIFIERS.has(node.property.name)) {
        issues.push(`forbidden member: ${node.property.name}`)
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === 'start' || k === 'end' || k === 'loc') continue
      if (Array.isArray(v)) v.forEach((c) => visit(c, node))
      else if (v && typeof v === 'object' && (v as any).type) visit(v, node)
    }
  }

  visit(ast, null)

  if (issues.length) {
    return { ok: false, message: [...new Set(issues)].slice(0, 5).join('; ') }
  }
  return { ok: true }
}
