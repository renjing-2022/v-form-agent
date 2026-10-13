import { createHash } from 'node:crypto'
import type { FormJson } from '../schemas/refinePlan.js'
import { stableStringify } from './formFingerprint.js'

export type FormIndexNode = {
  key: string
  id?: string
  name?: string
  label?: string
  type?: string
  path: string
  depth: number
  parentKey?: string
  childKeys: string[]
  siblingKeys: string[]
  /** 公式/选项中引用到的其他 name（弱依赖） */
  dependsOnNames: string[]
}

export type FormIndex = {
  nodes: FormIndexNode[]
  byKey: Map<string, FormIndexNode>
  byName: Map<string, FormIndexNode[]>
  byLabel: Map<string, FormIndexNode[]>
  byId: Map<string, FormIndexNode[]>
  maxDepth: number
  fingerprint: string
}

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
  rows?: Array<WidgetNode & { cells?: WidgetNode[] }>
}

function extractDependsOnNames(options: Record<string, unknown>): string[] {
  const out = new Set<string>()
  const formula = options.formula
  if (typeof formula === 'string') {
    for (const m of formula.matchAll(/\$\{([^}]+)\}/g)) {
      const ref = m[1]?.trim()
      if (ref) out.add(ref)
    }
    for (const m of formula.matchAll(/\b([A-Za-z_][\w]*)\b/g)) {
      const ref = m[1]
      if (ref && !['Math', 'true', 'false', 'null', 'undefined'].includes(ref)) out.add(ref)
    }
  }
  return [...out]
}

function pushChildLists(
  w: WidgetNode,
  path: string,
): Array<{ list: WidgetNode[]; pathPrefix: string }> {
  const out: Array<{ list: WidgetNode[]; pathPrefix: string }> = []
  if (Array.isArray(w.widgetList)) out.push({ list: w.widgetList, pathPrefix: `${path}.widgetList` })
  if (Array.isArray(w.tabs)) out.push({ list: w.tabs, pathPrefix: `${path}.tabs` })
  if (Array.isArray(w.cols)) {
    w.cols.forEach((col, c) => {
      if (Array.isArray(col?.widgetList)) {
        out.push({ list: col.widgetList, pathPrefix: `${path}.cols[${c}].widgetList` })
      }
    })
  }
  if (Array.isArray(w.rows)) {
    w.rows.forEach((row, r) => {
      const cells = (row?.cols || row?.cells || []) as WidgetNode[]
      cells.forEach((cell, c) => {
        if (Array.isArray(cell?.widgetList)) {
          out.push({ list: cell.widgetList, pathPrefix: `${path}.rows[${r}].cols[${c}].widgetList` })
        }
      })
    })
  }
  return out
}

/**
 * 全量分片索引：不截断节点数与深度；记录父子/兄弟与弱依赖。
 */
export function buildFormIndex(formJson: FormJson): FormIndex {
  const nodes: FormIndexNode[] = []
  const byKey = new Map<string, FormIndexNode>()
  let maxDepth = 0

  const walk = (widgets: WidgetNode[], pathPrefix: string, parentKey: string | undefined, depth: number) => {
    const siblingKeys: string[] = []
    for (let i = 0; i < widgets.length; i++) {
      const w = widgets[i]
      if (!w || typeof w !== 'object') continue
      const path = `${pathPrefix}[${i}]`
      const options = w.options || {}
      const key = path
      const node: FormIndexNode = {
        key,
        id: typeof w.id === 'string' ? w.id : undefined,
        name: typeof options.name === 'string' ? options.name : undefined,
        label: typeof options.label === 'string' ? options.label : undefined,
        type: typeof w.type === 'string' ? w.type : undefined,
        path,
        depth,
        parentKey,
        childKeys: [],
        siblingKeys: [],
        dependsOnNames: extractDependsOnNames(options),
      }
      nodes.push(node)
      byKey.set(key, node)
      siblingKeys.push(key)
      maxDepth = Math.max(maxDepth, depth)

      if (parentKey) {
        const parent = byKey.get(parentKey)
        if (parent) parent.childKeys.push(key)
      }

      for (const child of pushChildLists(w, path)) {
        walk(child.list, child.pathPrefix, key, depth + 1)
      }
    }
    for (const key of siblingKeys) {
      const node = byKey.get(key)
      if (!node) continue
      node.siblingKeys = siblingKeys.filter((k) => k !== key)
    }
  }

  walk((formJson.widgetList || []) as WidgetNode[], 'widgetList', undefined, 0)

  const byName = new Map<string, FormIndexNode[]>()
  const byLabel = new Map<string, FormIndexNode[]>()
  const byId = new Map<string, FormIndexNode[]>()
  for (const n of nodes) {
    if (n.name) {
      const list = byName.get(n.name) || []
      list.push(n)
      byName.set(n.name, list)
    }
    if (n.label) {
      const list = byLabel.get(n.label) || []
      list.push(n)
      byLabel.set(n.label, list)
    }
    if (n.id) {
      const list = byId.get(n.id) || []
      list.push(n)
      byId.set(n.id, list)
    }
  }

  const fingerprint = createHash('sha256')
    .update(
      stableStringify(
        nodes.map((n) => ({
          path: n.path,
          id: n.id || '',
          name: n.name || '',
          label: n.label || '',
          type: n.type || '',
          parentKey: n.parentKey || '',
          dependsOnNames: n.dependsOnNames,
        })),
      ),
    )
    .digest('hex')

  return { nodes, byKey, byName, byLabel, byId, maxDepth, fingerprint }
}

export type IntentRetrieveOptions = {
  budget?: number
  expandAncestors?: boolean
  expandSiblings?: boolean
  expandDependencies?: boolean
}

export type IntentRetrieveResult = {
  selectedKeys: string[]
  hitKeys: string[]
  scoreByKey: Map<string, number>
}

function tokenizeIntent(instruction: string): string[] {
  const text = instruction.trim()
  if (!text) return []
  const tokens = new Set<string>()
  for (const m of text.matchAll(/「([^」]{1,40})」|"([^"]{1,40})"|'([^']{1,40})'/g)) {
    const t = (m[1] || m[2] || m[3] || '').trim()
    if (t) tokens.add(t)
  }
  // 字段70 / f12 / qty2 等带数字标识
  for (const m of text.matchAll(/[\u4e00-\u9fff]{1,12}\d{1,6}|[A-Za-z_][\w-]{0,31}/g)) {
    tokens.add(m[0])
  }
  for (const m of text.matchAll(/[\u4e00-\u9fff]{2,12}/g)) {
    tokens.add(m[0])
  }
  return [...tokens]
}

function scoreNode(node: FormIndexNode, tokens: string[]): number {
  if (!tokens.length) return 0
  let score = 0
  const name = node.name || ''
  const label = node.label || ''
  const id = node.id || ''
  const type = node.type || ''
  for (const t of tokens) {
    if (!t) continue
    if (name === t || label === t || id === t) score += 100
    else if (name.includes(t) || label.includes(t) || id.includes(t)) score += 40
    else if (type === t || type.includes(t)) score += 8
  }
  return score
}

/**
 * 按意图检索候选节点，并扩展祖先 / 兄弟 / 弱依赖。
 */
export function retrieveFormContext(
  index: FormIndex,
  instruction: string,
  opts: IntentRetrieveOptions = {},
): IntentRetrieveResult {
  const budget = opts.budget ?? 120
  const tokens = tokenizeIntent(instruction)
  const scoreByKey = new Map<string, number>()

  for (const node of index.nodes) {
    const s = scoreNode(node, tokens)
    if (s > 0) scoreByKey.set(node.key, s)
  }

  // 无命中时取浅层前缀，保证摘要仍有骨架
  let ranked = [...scoreByKey.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!ranked.length) {
    ranked = index.nodes
      .slice()
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
      .slice(0, Math.min(budget, 40))
      .map((n) => [n.key, 1] as [string, number])
    for (const [k, s] of ranked) scoreByKey.set(k, s)
  }

  const hitKeys = ranked.map(([k]) => k)
  const selected = new Set<string>()

  const addWithExpand = (key: string) => {
    if (selected.size >= budget) return
    if (selected.has(key)) return
    selected.add(key)
    const node = index.byKey.get(key)
    if (!node) return

    if (opts.expandAncestors !== false) {
      let pk = node.parentKey
      while (pk && selected.size < budget) {
        if (selected.has(pk)) break
        selected.add(pk)
        pk = index.byKey.get(pk)?.parentKey
      }
    }
    if (opts.expandSiblings !== false) {
      for (const sk of node.siblingKeys) {
        if (selected.size >= budget) break
        selected.add(sk)
      }
    }
    if (opts.expandDependencies !== false) {
      for (const dep of node.dependsOnNames) {
        const deps = index.byName.get(dep) || []
        for (const d of deps) {
          if (selected.size >= budget) break
          selected.add(d.key)
        }
      }
    }
  }

  for (const key of hitKeys) {
    if (selected.size >= budget) break
    addWithExpand(key)
  }

  // 稳定顺序：按 path
  const selectedKeys = [...selected].sort((a, b) => a.localeCompare(b))
  return { selectedKeys, hitKeys, scoreByKey }
}

export function extractIntentMentions(instruction: string): string[] {
  return tokenizeIntent(instruction).filter((t) => t.length >= 2)
}

/**
 * 指令中出现的画布 name/label，若同一文案对应多个节点 → 歧义。
 * 用索引反查子串，避免中文分词把「备注」吞进更长 token。
 */
export function findAmbiguousTargetMentions(
  index: FormIndex,
  instruction: string,
): Array<{ mention: string; matches: FormIndexNode[] }> {
  const text = instruction.trim()
  if (!text) return []
  const out: Array<{ mention: string; matches: FormIndexNode[] }> = []
  const seen = new Set<string>()

  const consider = (mention: string, matches: FormIndexNode[]) => {
    if (seen.has(mention) || matches.length <= 1) return
    if (!text.includes(mention)) return
    // 过短或纯功能词易误报
    if (mention.length < 2) return
    if (/^(字段|控件|表单|按钮|输入|点击|修改|设置|必填|联动)$/.test(mention)) return
    seen.add(mention)
    out.push({ mention, matches })
  }

  for (const [label, matches] of index.byLabel) {
    consider(label, matches)
  }
  for (const [name, matches] of index.byName) {
    consider(name, matches)
  }

  // 补充：引号内 mention 精确命中
  for (const mention of extractIntentMentions(instruction)) {
    if (seen.has(mention)) continue
    const byName = index.byName.get(mention) || []
    const byLabel = index.byLabel.get(mention) || []
    const merged = new Map<string, FormIndexNode>()
    for (const n of [...byName, ...byLabel]) merged.set(n.key, n)
    consider(mention, [...merged.values()])
  }

  return out
}
