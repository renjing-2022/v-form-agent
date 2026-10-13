import type { FormJson } from '../schemas/refinePlan.js'
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import { MAX_FIELDS } from '../knowledge/widgetWhitelist.js'
import {
  buildFormIndex,
  retrieveFormContext,
  type FormIndex,
  type FormIndexNode,
} from './formIndex.js'

export type FormFieldSummary = {
  id?: string
  name?: string
  label?: string
  type?: string
  path: string
  parent?: { type?: string; name?: string; label?: string }
  writableSnapshot?: Record<string, unknown>
}

export type FormSummaryCoverage = {
  indexedNodes: number
  includedNodes: number
  maxDepthSeen: number
  budget: number
  truncated: boolean
  retrievalHits: number
}

export type FormSummaryOmission = {
  reason: 'budget' | 'not_retrieved'
  count: number
  examples: string[]
}

export type FormSummaryReport = {
  fields: FormFieldSummary[]
  coverage: FormSummaryCoverage
  omissions: FormSummaryOmission[]
  fingerprint: string
  index: FormIndex
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

const SNAPSHOT_KEYS = [
  'placeholder',
  'labelWidth',
  'labelWrap',
  'labelHidden',
  'labelAlign',
  'displayStyle',
  'columnWidth',
  'required',
  'hidden',
  'customClass',
  'size',
]

const ON_DEMAND_SNAPSHOT_KEYS = ['optionItems', 'defaultValue', 'validation', 'optionValueType']

/** 保留常量供外部引用；摘要预算默认与 MAX_FIELDS 对齐，不再静默截断索引 */
export const FORM_SUMMARY_MAX_DEPTH = 8
export { MAX_FIELDS as FORM_SUMMARY_MAX_FIELDS }

function inferOnDemandSnapshotKeys(instruction?: string): string[] {
  if (!instruction) return []
  const keys: string[] = []
  if (/选项值类型|optionValueType|数值类型/.test(instruction)) keys.push('optionValueType')
  if (/选项|optionItems|分值|单选|多选/.test(instruction)) keys.push('optionItems')
  if (/默认|defaultValue|默认值/.test(instruction)) keys.push('defaultValue')
  if (/校验|validation/.test(instruction)) keys.push('validation')
  return keys
}

function snapshotFor(
  type: string,
  options: Record<string, unknown>,
  instruction?: string,
): Record<string, unknown> {
  const catalog = getWidgetCatalog()
  const entry = catalog.widgets.find((w) => w.type === type)
  const allowed = new Set(entry?.writableKeys || SNAPSHOT_KEYS)
  const keys = [
    ...SNAPSHOT_KEYS,
    ...inferOnDemandSnapshotKeys(instruction).filter((k) => ON_DEMAND_SNAPSHOT_KEYS.includes(k)),
  ]
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (!allowed.has(key)) continue
    if (options[key] !== undefined) out[key] = options[key]
  }
  return out
}

function readOptionsAtPath(formJson: FormJson, path: string): Record<string, unknown> {
  const parts = path.replace(/^widgetList/, '').split(/\.|\[|\]/).filter(Boolean)
  let cur: unknown = formJson.widgetList
  for (const part of parts) {
    if (cur == null) return {}
    if (/^\d+$/.test(part)) {
      cur = (cur as unknown[])[Number(part)]
    } else {
      cur = (cur as Record<string, unknown>)[part]
    }
  }
  const options = (cur as WidgetNode | undefined)?.options
  return options && typeof options === 'object' ? options : {}
}

function nodeToSummary(
  formJson: FormJson,
  index: FormIndex,
  node: FormIndexNode,
  instruction?: string,
): FormFieldSummary {
  const parent = node.parentKey ? index.byKey.get(node.parentKey) : undefined
  const options = readOptionsAtPath(formJson, node.path)
  const type = node.type
  const snap = type ? snapshotFor(type, options, instruction) : {}
  return {
    id: node.id,
    name: node.name,
    label: node.label,
    type,
    path: node.path,
    parent: parent
      ? {
          type: parent.type,
          name: parent.name,
          label: parent.label,
        }
      : undefined,
    writableSnapshot: Object.keys(snap).length ? snap : undefined,
  }
}

/**
 * 可感知摘要：全量索引 + 意图检索切片；返回 coverage / omissions / fingerprint。
 */
export function buildFormSummaryReport(
  formJson: FormJson,
  instruction?: string,
  opts?: { budget?: number },
): FormSummaryReport {
  const index = buildFormIndex(formJson)
  const budget = opts?.budget ?? MAX_FIELDS
  const retrieved = retrieveFormContext(index, instruction || '', { budget })
  const selectedSet = new Set(retrieved.selectedKeys)
  const fields = retrieved.selectedKeys
    .map((key) => index.byKey.get(key))
    .filter((n): n is FormIndexNode => Boolean(n))
    .map((n) => nodeToSummary(formJson, index, n, instruction))

  const omitted = index.nodes.filter((n) => !selectedSet.has(n.key))
  const omissions: FormSummaryOmission[] = []
  if (omitted.length) {
    const reason: FormSummaryOmission['reason'] =
      index.nodes.length > budget || retrieved.selectedKeys.length >= budget ? 'budget' : 'not_retrieved'
    omissions.push({
      reason,
      count: omitted.length,
      examples: omitted
        .slice(0, 8)
        .map((n) => n.name || n.label || n.id || n.path)
        .filter(Boolean),
    })
  }

  return {
    fields,
    coverage: {
      indexedNodes: index.nodes.length,
      includedNodes: fields.length,
      maxDepthSeen: index.maxDepth,
      budget,
      truncated: omissions.length > 0,
      retrievalHits: retrieved.hitKeys.length,
    },
    omissions,
    fingerprint: index.fingerprint,
    index,
  }
}

/** 兼容旧调用方：仅返回检索后的字段切片（索引本身不截断） */
export function buildFormSummary(formJson: FormJson, instruction?: string): FormFieldSummary[] {
  return buildFormSummaryReport(formJson, instruction).fields
}

/** 目标解析用：返回全量节点摘要，不再受 120/深度静默截断 */
export function indexFormFields(formJson: FormJson): FormFieldSummary[] {
  const index = buildFormIndex(formJson)
  return index.nodes.map((n) => nodeToSummary(formJson, index, n))
}

/** 供 prompt 附加的可见截断说明 */
export function formatFormSummaryMeta(report: FormSummaryReport): string {
  const c = report.coverage
  const lines = [
    `formIndexFingerprint=${report.fingerprint.slice(0, 16)}…`,
    `coverage: indexed=${c.indexedNodes}, included=${c.includedNodes}, maxDepth=${c.maxDepthSeen}, truncated=${c.truncated}`,
  ]
  for (const o of report.omissions) {
    lines.push(
      `omissions(${o.reason}): count=${o.count}` +
        (o.examples.length ? `; examples=${o.examples.join(',')}` : ''),
    )
  }
  return lines.join('\n')
}
