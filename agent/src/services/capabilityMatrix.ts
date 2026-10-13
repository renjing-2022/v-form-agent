/**
 * v0.13 全组件 capability matrix：
 * type × create × 属性 × 事件 × 动作 × 断言 × 风险，正/负/blocked 须有解释。
 */
import { getWidgetCatalog } from '../knowledge/widgetCatalogStore.js'
import {
  buildWidgetCreateCapability,
  type PreviewAct,
  type PreviewAssert,
} from '../knowledge/createCapabilityPolicy.js'
import {
  CREATE_NON_GOAL,
  isCreateAllowedType,
  UPLOAD_CREATE_WHITELIST,
} from '../knowledge/createWhitelistPolicy.js'
import {
  discoverExtensionSurface,
  getExtensionManifest,
  listExtensionManifests,
} from '../knowledge/extensionManifestPolicy.js'

export type CapabilityVerdict = 'positive' | 'negative' | 'blocked'

export type CapabilityMatrixRow = {
  type: string
  source: 'catalog' | 'runtime-extension' | 'blocked-without-manifest'
  createKind: string
  create: CapabilityVerdict
  createReason: string
  writableKeys: string[]
  eventKeys: string[]
  acts: PreviewAct[]
  asserts: PreviewAssert[]
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'blocked'
  riskNotes: string[]
}

export type CapabilityMatrix = {
  generatedAt: string
  rows: CapabilityMatrixRow[]
  holes: string[]
}

function riskForType(type: string): { level: CapabilityMatrixRow['riskLevel']; notes: string[] } {
  const notes: string[] = []
  const manifest = getExtensionManifest(type)
  if (manifest) {
    const level = (manifest.riskLevel as CapabilityMatrixRow['riskLevel']) || 'L2'
    notes.push(`extension manifest risk=${level}`)
    return { level, notes }
  }
  if ((UPLOAD_CREATE_WHITELIST as readonly string[]).includes(type)) {
    notes.push('upload create surface → L2')
    return { level: 'L2', notes }
  }
  if (CREATE_NON_GOAL[type]) {
    notes.push(`CREATE_NON_GOAL: ${CREATE_NON_GOAL[type]}`)
    return { level: 'blocked', notes }
  }
  if (isCreateAllowedType(type)) {
    notes.push('static create whitelist → L1')
    return { level: 'L1', notes }
  }
  notes.push('not on create whitelist')
  return { level: 'L1', notes }
}

export function buildCapabilityMatrix(): CapabilityMatrix {
  const catalog = getWidgetCatalog()
  const rows: CapabilityMatrixRow[] = []
  const seen = new Set<string>()

  for (const entry of catalog.widgets) {
    seen.add(entry.type)
    const cap = buildWidgetCreateCapability(entry)
    const createAllowed = isCreateAllowedType(entry.type) || Boolean(getExtensionManifest(entry.type))
    const nonGoal = CREATE_NON_GOAL[entry.type]
    let create: CapabilityVerdict = 'positive'
    let createReason = `createKind=${cap.createKind}`
    if (nonGoal) {
      create = 'blocked'
      createReason = String(nonGoal)
    } else if (!createAllowed && cap.createKind !== 'runtime-extension') {
      create = 'negative'
      createReason = 'not in create whitelist'
    }
    const risk = riskForType(entry.type)
    rows.push({
      type: entry.type,
      source: 'catalog',
      createKind: cap.createKind,
      create,
      createReason,
      writableKeys: [...(entry.writableKeys || [])].sort(),
      eventKeys: [...cap.eventKeys].sort(),
      acts: [...cap.previewCapabilities.acts],
      asserts: [...cap.previewCapabilities.asserts],
      riskLevel: risk.level,
      riskNotes: risk.notes,
    })
  }

  for (const m of listExtensionManifests()) {
    if (seen.has(m.type)) continue
    seen.add(m.type)
    const risk = riskForType(m.type)
    const preview = m.previewCapabilities || { acts: [], asserts: [] }
    rows.push({
      type: m.type,
      source: 'runtime-extension',
      createKind: 'runtime-extension',
      create: 'positive',
      createReason: 'registered extension manifest',
      writableKeys: [...(m.writableKeys || [])].sort(),
      eventKeys: [...(m.eventKeys || [])].sort(),
      acts: [...(preview.acts || [])] as PreviewAct[],
      asserts: [...(preview.asserts || [])] as PreviewAssert[],
      riskLevel: risk.level,
      riskNotes: risk.notes,
    })
  }

  const surface = discoverExtensionSurface()
  for (const blocked of surface.blockedWithoutManifest || []) {
    const type = `blocked:${blocked.category}`
    if (seen.has(type)) continue
    seen.add(type)
    rows.push({
      type,
      source: 'blocked-without-manifest',
      createKind: 'blocked',
      create: 'blocked',
      createReason: blocked.note || 'manifest required',
      writableKeys: [],
      eventKeys: [],
      acts: [],
      asserts: [],
      riskLevel: 'blocked',
      riskNotes: [blocked.note || 'blocked without manifest'],
    })
  }

  rows.sort((a, b) => a.type.localeCompare(b.type))
  const holes = findCapabilityHoles(rows)
  return {
    generatedAt: new Date().toISOString(),
    rows,
    holes,
  }
}

/** 无正例/负例/blocked 解释，或能力面空洞 */
export function findCapabilityHoles(rows: CapabilityMatrixRow[]): string[] {
  const holes: string[] = []
  if (!rows.length) holes.push('matrix empty')
  for (const row of rows) {
    if (!row.createReason.trim()) holes.push(`${row.type}: missing createReason`)
    if (row.create === 'positive' && row.source === 'catalog') {
      // 展示/占位类组件可无事件；但至少应有 acts 或 asserts 或 writableKeys 之一说明能力面
      if (!row.eventKeys.length && !row.acts.length && !row.asserts.length && !row.writableKeys.length) {
        holes.push(`${row.type}: positive row has empty capability surfaces`)
      }
    }
    if (row.create === 'blocked' && !row.riskNotes.length) {
      holes.push(`${row.type}: blocked without riskNotes`)
    }
  }
  return holes
}

export function assertCapabilityMatrixComplete(matrix: CapabilityMatrix = buildCapabilityMatrix()): string[] {
  const issues = [...matrix.holes]
  const catalog = getWidgetCatalog()
  for (const w of catalog.widgets) {
    if (!matrix.rows.some((r) => r.type === w.type && r.source === 'catalog')) {
      issues.push(`catalog type ${w.type} missing from matrix`)
    }
  }
  return issues
}
