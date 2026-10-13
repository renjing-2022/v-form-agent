/**
 * v0.12 Runtime extension manifest：机器可读注册表 + fingerprint。
 * - slot（静态 Catalog adjacent）与 card/alert（runtime-only）均须 manifest 才可 create
 * - 无 manifest / 版本漂移 / 非法权限 → 诚实拒绝
 * - custom/chart 仅发现 register API，无 manifest 不可猜测创建
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

/** 与 extensionBoundaryPolicy.EXTENSION_LOADER_REL 对齐（避免循环依赖） */
export const EXTENSION_MANIFEST_LOADER_REL = 'v-form/src/extension/extension-loader.js'

export const EXTENSION_DISCOVERY_REGISTER_APIS = [
  'addContainerWidgetSchema',
  'addBasicFieldSchema',
  'addAdvancedFieldSchema',
  'addCustomWidgetSchema',
  'addChartContainerSchema',
  'addChartSchema',
  'loadExtension',
] as const

export const EXTENSION_MANIFEST_SCHEMA_VERSION = 1 as const

export const extensionPreviewActSchema = z.enum(['mount', 'click', 'observeText', 'switchTab'])
export const extensionPreviewAssertSchema = z.enum([
  'hidden',
  'disabled',
  'label',
  'text',
  'noError',
  'noNetwork',
])

export const extensionManifestSchema = z.object({
  schemaVersion: z.literal(EXTENSION_MANIFEST_SCHEMA_VERSION),
  type: z.string().min(1).max(64),
  alias: z.array(z.string().min(1).max(64)).max(20).default([]),
  version: z.string().min(1).max(32),
  category: z.enum(['container', 'custom', 'advanced', 'chart-container', 'chart-widget']),
  source: z.enum(['static-catalog', 'runtime-loader']),
  sourceRel: z.string().min(1),
  defaultSchema: z.object({
    type: z.string().min(1),
    icon: z.string().optional(),
    formItemFlag: z.boolean().optional(),
    category: z.string().optional(),
    options: z.record(z.unknown()),
    widgetList: z.array(z.unknown()).optional(),
  }),
  allowedParents: z.array(z.string().min(1)).min(1),
  allowedChildren: z.array(z.string().min(1)).default([]),
  childSlots: z
    .array(
      z.object({
        key: z.string().min(1),
        allowedTypes: z.array(z.string()),
        minCount: z.number().int().min(0).default(0),
      }),
    )
    .default([]),
  writableOptions: z.array(z.string().min(1)),
  forbiddenOptions: z.array(z.string().min(1)).default([]),
  events: z.array(z.string().min(1)).default([]),
  preview: z.object({
    acts: z.array(extensionPreviewActSchema).min(1),
    asserts: z.array(extensionPreviewAssertSchema).min(1),
  }),
  risk: z.object({
    network: z.boolean(),
    requiresL2: z.boolean().default(false),
    allowsProductionWrite: z.boolean().default(false),
    allowsCredentials: z.boolean().default(false),
  }),
  permissions: z.array(z.string().min(1)).default([]),
})
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>

/** 非法权限：出现则拒绝注册/创建 */
export const ILLEGAL_EXTENSION_PERMISSIONS = new Set([
  'network.fetch',
  'network.xhr',
  'credential.store',
  'production.write',
  'eval.execute',
])

const SLOT_MANIFEST: ExtensionManifest = extensionManifestSchema.parse({
  schemaVersion: 1,
  type: 'slot',
  alias: ['插槽'],
  version: 'v0.12.0',
  category: 'advanced',
  source: 'static-catalog',
  sourceRel: 'v-form/src/components/form-designer/widget-panel/widgetsConfig.js',
  defaultSchema: {
    type: 'slot',
    icon: 'slot',
    formItemFlag: false,
    options: { name: '', label: '', customClass: '' },
  },
  allowedParents: ['root', 'tab-pane', 'grid-col'],
  allowedChildren: [],
  childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
  writableOptions: ['customClass', 'label', 'name'],
  forbiddenOptions: [],
  events: [],
  preview: { acts: ['mount'], asserts: ['label', 'noError', 'noNetwork'] },
  risk: { network: false, requiresL2: false, allowsProductionWrite: false, allowsCredentials: false },
  permissions: ['structure.create'],
})

const CARD_MANIFEST: ExtensionManifest = extensionManifestSchema.parse({
  schemaVersion: 1,
  type: 'card',
  alias: ['卡片'],
  version: 'v0.12.0',
  category: 'container',
  source: 'runtime-loader',
  sourceRel: EXTENSION_MANIFEST_LOADER_REL,
  defaultSchema: {
    type: 'card',
    icon: 'card',
    category: 'container',
    formItemFlag: false,
    options: {
      name: '',
      label: 'card',
      hidden: false,
      headerHidden: false,
      folded: false,
      showFold: true,
      cardWidth: '100%',
      shadow: 'never',
      customClass: '',
    },
    widgetList: [],
  },
  allowedParents: ['root', 'tab-pane', 'grid-col'],
  allowedChildren: [],
  childSlots: [{ key: 'widgetList', allowedTypes: [], minCount: 0 }],
  writableOptions: [
    'name',
    'label',
    'hidden',
    'headerHidden',
    'folded',
    'showFold',
    'cardWidth',
    'shadow',
    'customClass',
  ],
  forbiddenOptions: [],
  events: [],
  preview: { acts: ['mount'], asserts: ['hidden', 'label', 'noError', 'noNetwork'] },
  risk: { network: false, requiresL2: false, allowsProductionWrite: false, allowsCredentials: false },
  permissions: ['structure.create', 'runtime.register:addContainerWidgetSchema'],
})

const ALERT_MANIFEST: ExtensionManifest = extensionManifestSchema.parse({
  schemaVersion: 1,
  type: 'alert',
  alias: ['提示', '警告条'],
  version: 'v0.12.0',
  category: 'custom',
  source: 'runtime-loader',
  sourceRel: EXTENSION_MANIFEST_LOADER_REL,
  defaultSchema: {
    type: 'alert',
    icon: 'alert',
    formItemFlag: false,
    options: {
      name: '',
      title: '提示',
      type: 'info',
      description: '',
      closable: true,
      closeText: '',
      center: true,
      showIcon: false,
      effect: 'light',
      hidden: false,
      onClose: '',
      customClass: '',
    },
  },
  allowedParents: ['root', 'tab-pane', 'grid-col', 'card'],
  allowedChildren: [],
  childSlots: [],
  writableOptions: [
    'name',
    'title',
    'type',
    'description',
    'closable',
    'closeText',
    'center',
    'showIcon',
    'effect',
    'hidden',
    'customClass',
  ],
  forbiddenOptions: ['onClose'],
  events: ['onClose'],
  preview: { acts: ['mount', 'observeText'], asserts: ['hidden', 'text', 'noError', 'noNetwork'] },
  risk: { network: false, requiresL2: false, allowsProductionWrite: false, allowsCredentials: false },
  permissions: ['structure.create', 'runtime.register:addCustomWidgetSchema'],
})

/** 已登记、可被 Agent 创建的扩展（须通过非法权限校验） */
export const EXTENSION_MANIFEST_REGISTRY: Readonly<Record<string, ExtensionManifest>> = {
  slot: SLOT_MANIFEST,
  card: CARD_MANIFEST,
  alert: ALERT_MANIFEST,
}

/** 静态 Catalog 内、经 manifest 开放 create 的 type */
export const STATIC_MANIFEST_CREATE_TYPES = ['slot'] as const

/** 仅 runtime loader、不在静态 Catalog 的 type */
export const RUNTIME_ONLY_MANIFEST_TYPES = ['card', 'alert'] as const

export type ExtensionCreateType =
  | (typeof STATIC_MANIFEST_CREATE_TYPES)[number]
  | (typeof RUNTIME_ONLY_MANIFEST_TYPES)[number]

export function listExtensionManifests(): ExtensionManifest[] {
  return Object.values(EXTENSION_MANIFEST_REGISTRY).map((m) => structuredClone(m))
}

export function getExtensionManifest(type: string): ExtensionManifest | undefined {
  const m = EXTENSION_MANIFEST_REGISTRY[type]
  return m ? structuredClone(m) : undefined
}

export function isRuntimeOnlyExtensionType(type: string): boolean {
  return (RUNTIME_ONLY_MANIFEST_TYPES as readonly string[]).includes(type)
}

export function isStaticManifestCreateType(type: string): boolean {
  return (STATIC_MANIFEST_CREATE_TYPES as readonly string[]).includes(type)
}

export function computeExtensionRegistryFingerprint(
  registry: Readonly<Record<string, ExtensionManifest>> = EXTENSION_MANIFEST_REGISTRY,
): string {
  const normalized = Object.keys(registry)
    .sort()
    .map((type) => {
      const m = registry[type]
      return {
        type: m.type,
        version: m.version,
        source: m.source,
        sourceRel: m.sourceRel,
        category: m.category,
        allowedParents: [...m.allowedParents].sort(),
        writableOptions: [...m.writableOptions].sort(),
        forbiddenOptions: [...m.forbiddenOptions].sort(),
        events: [...m.events].sort(),
        permissions: [...m.permissions].sort(),
        risk: m.risk,
        preview: m.preview,
        defaultOptionsKeys: Object.keys(m.defaultSchema.options || {}).sort(),
      }
    })
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

/** 锁定指纹：registry 变更时须显式更新（漂移检测） */
export const EXTENSION_REGISTRY_FINGERPRINT = computeExtensionRegistryFingerprint()

export type ExtensionCapabilityLevel =
  | 'Create-ready'
  | 'Structure-ready'
  | 'Runtime-ready'
  | 'Blocked'

export type ExtensionResolveResult =
  | {
      ok: true
      manifest: ExtensionManifest
      capability: ExtensionCapabilityLevel
      fingerprint: string
    }
  | {
      ok: false
      reason: 'missing-manifest' | 'version-drift' | 'illegal-permission' | 'unsafe-risk'
      message: string
      capability: 'Blocked'
    }

function findIllegalPermissions(manifest: ExtensionManifest): string[] {
  return manifest.permissions.filter((p) => ILLEGAL_EXTENSION_PERMISSIONS.has(p))
}

function findUnsafeRisk(manifest: ExtensionManifest): string | null {
  if (manifest.risk.allowsCredentials) return 'manifest.risk.allowsCredentials=true'
  if (manifest.risk.allowsProductionWrite) return 'manifest.risk.allowsProductionWrite=true'
  if (manifest.risk.network && !manifest.risk.requiresL2) {
    return 'manifest.risk.network without requiresL2'
  }
  return null
}

/**
 * 评估一份 manifest 是否可创建（含非法权限 / 风险 / 指纹漂移）。
 * 供注册表查询与负例构造共用。
 */
export function evaluateExtensionManifest(
  manifest: ExtensionManifest,
  opts?: { expectedFingerprint?: string; expectedVersion?: string },
): ExtensionResolveResult {
  const illegal = findIllegalPermissions(manifest)
  if (illegal.length) {
    return {
      ok: false,
      reason: 'illegal-permission',
      message: `扩展 "${manifest.type}" 含非法权限: ${illegal.join(', ')}`,
      capability: 'Blocked',
    }
  }

  const unsafe = findUnsafeRisk(manifest)
  if (unsafe) {
    return {
      ok: false,
      reason: 'unsafe-risk',
      message: `扩展 "${manifest.type}" 风险标志非法: ${unsafe}`,
      capability: 'Blocked',
    }
  }

  const fingerprint = computeExtensionRegistryFingerprint()
  if (opts?.expectedFingerprint && opts.expectedFingerprint !== fingerprint) {
    return {
      ok: false,
      reason: 'version-drift',
      message: `extension registry fingerprint 漂移（expected=${opts.expectedFingerprint.slice(0, 12)}… got=${fingerprint.slice(0, 12)}…）`,
      capability: 'Blocked',
    }
  }
  if (opts?.expectedVersion && opts.expectedVersion !== manifest.version) {
    return {
      ok: false,
      reason: 'version-drift',
      message: `扩展 "${manifest.type}" 版本漂移：expected=${opts.expectedVersion} got=${manifest.version}`,
      capability: 'Blocked',
    }
  }

  const capability: ExtensionCapabilityLevel =
    manifest.source === 'runtime-loader' ? 'Runtime-ready' : 'Create-ready'

  return {
    ok: true,
    manifest: structuredClone(manifest),
    capability,
    fingerprint,
  }
}

/**
 * 解析扩展是否可创建。
 * @param expectedFingerprint 调用方可传入已加载 registry 指纹；不匹配则 version-drift
 */
export function resolveExtensionForCreate(
  type: string,
  opts?: { expectedFingerprint?: string; expectedVersion?: string },
): ExtensionResolveResult {
  const manifest = EXTENSION_MANIFEST_REGISTRY[type]
  if (!manifest) {
    return {
      ok: false,
      reason: 'missing-manifest',
      message: `扩展 type="${type}" 无机器可读 manifest，拒绝猜测创建`,
      capability: 'Blocked',
    }
  }
  return evaluateExtensionManifest(manifest, opts)
}

export function isExtensionManifestCreatable(
  type: string,
  opts?: { expectedFingerprint?: string; expectedVersion?: string },
): boolean {
  return resolveExtensionForCreate(type, opts).ok
}

/** 按 manifest 构造节点（runtime-only 无 Catalog defaults） */
export function buildWidgetFromExtensionManifest(
  type: string,
  params: { id: string; name: string; label?: string; optionOverrides?: Record<string, unknown> },
): { ok: true; node: Record<string, unknown> } | { ok: false; message: string } {
  const resolved = resolveExtensionForCreate(type)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  const m = resolved.manifest
  const options: Record<string, unknown> = {
    ...structuredClone(m.defaultSchema.options),
    name: params.name,
    ...(params.label !== undefined
      ? m.writableOptions.includes('label')
        ? { label: params.label }
        : m.writableOptions.includes('title')
          ? { title: params.label }
          : {}
      : {}),
    ...(params.optionOverrides || {}),
  }
  // 剥离 forbidden / 事件键
  for (const key of m.forbiddenOptions) {
    if (key in options && key !== 'name') {
      if (m.events.includes(key)) options[key] = ''
      else delete options[key]
    }
  }
  const node: Record<string, unknown> = {
    type: m.defaultSchema.type,
    icon: m.defaultSchema.icon || m.type,
    formItemFlag: Boolean(m.defaultSchema.formItemFlag),
    options,
    id: params.id,
  }
  if (m.defaultSchema.category === 'container' || m.category === 'container') {
    node.category = 'container'
  }
  if (Array.isArray(m.defaultSchema.widgetList)) {
    node.widgetList = structuredClone(m.defaultSchema.widgetList)
  }
  return { ok: true, node }
}

/** 按 manifest 消毒 optionOverrides（runtime 扩展） */
export function sanitizeExtensionOptionOverrides(
  type: string,
  overrides: Record<string, unknown> | undefined,
): { ok: boolean; patch: Record<string, unknown>; errors: string[] } {
  const errors: string[] = []
  const resolved = resolveExtensionForCreate(type)
  if (!resolved.ok) return { ok: false, patch: {}, errors: [resolved.message] }
  const m = resolved.manifest
  const patch: Record<string, unknown> = {}
  if (!overrides) return { ok: true, patch, errors }
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'name') continue
    if (m.forbiddenOptions.includes(key) || m.events.includes(key)) {
      errors.push(`extension optionOverrides 禁写键: ${key}`)
      continue
    }
    if (!m.writableOptions.includes(key)) {
      errors.push(`extension optionOverrides 未知/不可写键: ${key}`)
      continue
    }
    patch[key] = value
  }
  return { ok: errors.length === 0, patch, errors }
}

export function getExtensionPreviewCapabilities(type: string) {
  const m = getExtensionManifest(type)
  return m?.preview || null
}

export function assertExtensionPreviewSafe(type: string): string[] {
  const issues: string[] = []
  const resolved = resolveExtensionForCreate(type)
  if (!resolved.ok) {
    issues.push(resolved.message)
    return issues
  }
  const { manifest } = resolved
  if (!manifest.preview.asserts.includes('noNetwork') && manifest.risk.network) {
    issues.push(`${type} network extension must assert noNetwork or isolate preview`)
  }
  if (manifest.risk.allowsProductionWrite || manifest.risk.allowsCredentials) {
    issues.push(`${type} unsafe risk flags block preview`)
  }
  return issues
}

/** custom/chart 发现面：可注册 API + 无 manifest 阻塞结论 */
export function discoverExtensionSurface() {
  const registered = listExtensionManifests().map((m) => ({
    type: m.type,
    version: m.version,
    category: m.category,
    source: m.source,
    capability: resolveExtensionForCreate(m.type).ok
      ? m.source === 'runtime-loader'
        ? ('Runtime-ready' as const)
        : ('Create-ready' as const)
      : ('Blocked' as const),
  }))
  return {
    fingerprint: EXTENSION_REGISTRY_FINGERPRINT,
    registerApis: [...EXTENSION_DISCOVERY_REGISTER_APIS],
    registered,
    blockedWithoutManifest: [
      { category: 'custom', note: 'addCustomWidgetSchema 注入类型须提供 manifest 后才可 create' },
      { category: 'chart-container', note: 'addChartContainerSchema 注入类型须提供 manifest' },
      { category: 'chart-widget', note: 'addChartSchema 注入类型须提供 manifest' },
    ],
  }
}

export function checkExtensionManifestParity(): string[] {
  const issues: string[] = []
  const fp = computeExtensionRegistryFingerprint()
  if (fp !== EXTENSION_REGISTRY_FINGERPRINT) {
    issues.push(
      `EXTENSION_REGISTRY_FINGERPRINT drift: locked=${EXTENSION_REGISTRY_FINGERPRINT.slice(0, 16)}… live=${fp.slice(0, 16)}…`,
    )
  }

  for (const type of [...STATIC_MANIFEST_CREATE_TYPES, ...RUNTIME_ONLY_MANIFEST_TYPES]) {
    const resolved = resolveExtensionForCreate(type)
    if (!resolved.ok) {
      issues.push(`registered extension "${type}" failed resolve: ${resolved.message}`)
      continue
    }
    if (resolved.manifest.type !== type) {
      issues.push(`manifest type key mismatch for ${type}`)
    }
  }

  for (const [type, m] of Object.entries(EXTENSION_MANIFEST_REGISTRY)) {
    if (m.type !== type) issues.push(`registry key/type mismatch ${type}`)
    const illegal = findIllegalPermissions(m)
    if (illegal.length) issues.push(`${type} illegal permissions: ${illegal.join(',')}`)
    const unsafe = findUnsafeRisk(m)
    if (unsafe) issues.push(`${type} unsafe risk: ${unsafe}`)
    if (m.source === 'runtime-loader' && m.sourceRel !== EXTENSION_MANIFEST_LOADER_REL) {
      issues.push(`${type} runtime sourceRel must be extension-loader`)
    }
    if (!(RUNTIME_ONLY_MANIFEST_TYPES as readonly string[]).includes(type) && m.source === 'runtime-loader') {
      // card/alert only
    }
    if ((RUNTIME_ONLY_MANIFEST_TYPES as readonly string[]).includes(type) && m.source !== 'runtime-loader') {
      issues.push(`${type} must be runtime-loader source`)
    }
  }

  // 发现面必须诚实声明 chart/custom 无 manifest 不可创建
  const surface = discoverExtensionSurface()
  if (!surface.blockedWithoutManifest.some((b) => b.category === 'custom')) {
    issues.push('discoverExtensionSurface must block custom without manifest')
  }
  if (!surface.blockedWithoutManifest.some((b) => b.category.startsWith('chart'))) {
    issues.push('discoverExtensionSurface must block chart without manifest')
  }

  return issues
}
