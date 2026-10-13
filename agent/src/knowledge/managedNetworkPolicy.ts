/**
 * v0.12 受管上传 / 声明式远程数据源引用。
 * - Agent 只写 managed*Ref，不得直写凭据或生产 endpoint
 * - dsEnabled/dsName 等仍属 Catalog policy-forbidden；仅受管编译特权路径可写入
 * - 预览仅 mock/test，禁止 production
 */
import { z } from 'zod'

export type ManagedEnvironment = 'mock' | 'test'

export const MANAGED_PREVIEW_MODE = 'mock-only' as const

/** 密钥/凭据相关键或值模式（写入 formJson / overrides 一律拒绝） */
export const SECRET_KEY_PATTERN =
  /^(authorization|proxyauthorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|credential|private[_-]?key|token)$/i

export const SECRET_VALUE_PATTERN =
  /(api[_-]?key|access[_-]?token|bearer\s+[a-z0-9\-\._~+/]+=*|sk-[a-z0-9]{16,}|password\s*[:=])/i

const managedEnvSchema = z.enum(['mock', 'test'])

export const managedUploadRefSchema = z.object({
  kind: z.literal('managed-upload'),
  connectorId: z.string().min(1).max(64),
  environment: managedEnvSchema.optional(),
})
export type ManagedUploadRef = z.infer<typeof managedUploadRefSchema>

export const managedFieldMappingSchema = z
  .object({
    label: z.string().min(1).max(64).optional(),
    value: z.string().min(1).max(64).optional(),
    children: z.string().min(1).max(64).optional(),
  })
  .refine((m) => Boolean(m.label || m.value || m.children), {
    message: 'fieldMapping requires at least one of label/value/children',
  })
export type ManagedFieldMapping = z.infer<typeof managedFieldMappingSchema>

export const managedDataSourceRefSchema = z.object({
  kind: z.literal('managed-datasource'),
  connectorId: z.string().min(1).max(64),
  dataSetName: z.string().min(1).max(64).optional(),
  fieldMapping: managedFieldMappingSchema.optional(),
  environment: managedEnvSchema.optional(),
})
export type ManagedDataSourceRef = z.infer<typeof managedDataSourceRefSchema>

export type ManagedUploadConnector = {
  id: string
  environment: ManagedEnvironment
  uploadURL: string
  note: string
}

export type ManagedDataSourceConnector = {
  id: string
  environment: ManagedEnvironment
  dsName: string
  dataSetName: string
  method: 'GET'
  /** fixture URL；预览不得换成生产 */
  requestURL: string
  note: string
  /** 静态 fixture 行，供 mock 预览/映射演示 */
  fixtureRows?: Array<Record<string, unknown>>
}

/** 已登记受管上传 connector（仅 mock/test） */
export const MANAGED_UPLOAD_CONNECTORS: Readonly<Record<string, ManagedUploadConnector>> = {
  'mock-upload': {
    id: 'mock-upload',
    environment: 'mock',
    uploadURL: '/__mock__/upload',
    note: 'fixture-only upload endpoint; never production',
  },
  'test-upload': {
    id: 'test-upload',
    environment: 'test',
    uploadURL: '/__test__/upload',
    note: 'non-production test upload endpoint',
  },
}

/** 已登记受管数据源 connector（仅 mock/test） */
export const MANAGED_DATASOURCE_CONNECTORS: Readonly<Record<string, ManagedDataSourceConnector>> = {
  'mock-options': {
    id: 'mock-options',
    environment: 'mock',
    dsName: 'mockOptionsDS',
    dataSetName: 'default',
    method: 'GET',
    requestURL: '/__mock__/datasource/options',
    note: 'fixture-only options datasource',
    fixtureRows: [
      { id: 'a', name: '选项A' },
      { id: 'b', name: '选项B' },
    ],
  },
  'mock-tree': {
    id: 'mock-tree',
    environment: 'mock',
    dsName: 'mockTreeDS',
    dataSetName: 'nodes',
    method: 'GET',
    requestURL: '/__mock__/datasource/tree',
    note: 'fixture-only tree datasource',
    fixtureRows: [{ id: '1', name: '根节点', children: [{ id: '1-1', name: '子节点' }] }],
  },
  'mock-table': {
    id: 'mock-table',
    environment: 'mock',
    dsName: 'mockTableDS',
    dataSetName: 'rows',
    method: 'GET',
    requestURL: '/__mock__/datasource/table',
    note: 'fixture-only table datasource',
    fixtureRows: [
      { id: 1, name: '行1' },
      { id: 2, name: '行2' },
    ],
  },
}

/** Agent 侧受管引用键（非 Catalog writable；编译前剥离） */
export const MANAGED_REF_OPTION_KEYS = ['managedUploadRef', 'managedDataSourceRef'] as const

/** 仅受管编译可写入的 Catalog policy-forbidden 键 */
export const MANAGED_PRIVILEGED_OPTION_KEYS = new Set([
  'dsEnabled',
  'dsName',
  'dataSetName',
  'remote',
])

const PRODUCTION_URL_PATTERN =
  /production|prod\.|prd\.|:\/\/prod|api\.prod|https?:\/\/(?!localhost|127\.0\.0\.1|__mock__|__test__)/i

export type ManagedCompileIssue = { path: string; message: string; riskCode?: string }

export type ManagedCompileResult = {
  ok: boolean
  /** 可走普通 sanitize 的 overrides（已去掉 managed*Ref） */
  publicOverrides: Record<string, unknown>
  /** 写入 policy-forbidden 键的特权补丁 */
  privilegedPatch: Record<string, unknown>
  /** 需注入 formConfig.dataSources 的 mock 条目 */
  formDataSources: Array<Record<string, unknown>>
  /** 字段映射摘要（不入凭据通道；用于证据/警告） */
  fieldMappingNotes: string[]
  /** L2 风险提示码 */
  riskHints: Array<'upload_config' | 'remote_datasource'>
  errors: ManagedCompileIssue[]
  warnings: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function looksLikeSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(String(key || '').trim())
}

export function looksLikeSecretValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return SECRET_VALUE_PATTERN.test(value)
}

export function isForbiddenProductionUrl(url: string): boolean {
  const s = String(url || '').trim()
  if (!s) return false
  if (s.startsWith('/__mock__/') || s.startsWith('/__test__/')) return false
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return false
  return PRODUCTION_URL_PATTERN.test(s) || /^(https?:)?\/\//i.test(s)
}

/** 递归扫描 overrides 中的凭据键/值 */
export function findSecretLeaks(
  input: unknown,
  path = 'optionOverrides',
): ManagedCompileIssue[] {
  const issues: ManagedCompileIssue[] = []
  if (Array.isArray(input)) {
    input.forEach((item, i) => issues.push(...findSecretLeaks(item, `${path}[${i}]`)))
    return issues
  }
  if (!isPlainObject(input)) {
    if (looksLikeSecretValue(input)) {
      issues.push({
        path,
        message: '禁止写入疑似凭据/密钥值',
        riskCode: 'credential_write',
      })
    }
    return issues
  }
  for (const [key, value] of Object.entries(input)) {
    const child = `${path}.${key}`
    if (looksLikeSecretKey(key)) {
      issues.push({
        path: child,
        message: `禁止写入凭据键: ${key}`,
        riskCode: 'credential_write',
      })
      continue
    }
    issues.push(...findSecretLeaks(value, child))
  }
  return issues
}

export function resolveManagedUploadConnector(
  ref: ManagedUploadRef,
): { ok: true; connector: ManagedUploadConnector } | { ok: false; message: string; riskCode?: string } {
  const connector = MANAGED_UPLOAD_CONNECTORS[ref.connectorId]
  if (!connector) {
    return {
      ok: false,
      message: `未知 upload connector "${ref.connectorId}"（仅允许已登记 mock/test）`,
      riskCode: 'production_external_write',
    }
  }
  const env = ref.environment || connector.environment
  if (env === 'production' as string) {
    return { ok: false, message: '禁止 production upload connector', riskCode: 'production_external_write' }
  }
  if (env !== connector.environment) {
    return {
      ok: false,
      message: `upload connector "${ref.connectorId}" environment 须为 ${connector.environment}`,
    }
  }
  return { ok: true, connector }
}

export function resolveManagedDataSourceConnector(
  ref: ManagedDataSourceRef,
): { ok: true; connector: ManagedDataSourceConnector } | { ok: false; message: string; riskCode?: string } {
  const connector = MANAGED_DATASOURCE_CONNECTORS[ref.connectorId]
  if (!connector) {
    return {
      ok: false,
      message: `未知 datasource connector "${ref.connectorId}"（仅允许已登记 mock/test）`,
      riskCode: 'production_external_write',
    }
  }
  const env = ref.environment || connector.environment
  if (env === 'production' as string) {
    return {
      ok: false,
      message: '禁止 production datasource connector',
      riskCode: 'production_external_write',
    }
  }
  if (env !== connector.environment) {
    return {
      ok: false,
      message: `datasource connector "${ref.connectorId}" environment 须为 ${connector.environment}`,
    }
  }
  return { ok: true, connector }
}

function buildMockDataSourceEntry(connector: ManagedDataSourceConnector): Record<string, unknown> {
  return {
    uniqueName: connector.dsName,
    requestURL: connector.requestURL,
    requestURLType: 'String',
    description: connector.note,
    headers: [],
    params: [],
    data: [],
    /** 预览隔离标记；运行时不得替换为生产 */
    __managedEnvironment: connector.environment,
    __managedPreviewMode: MANAGED_PREVIEW_MODE,
  }
}

/**
 * 从 optionOverrides 提取并编译受管引用。
 * 原始 managed*Ref 不会进入 formJson。
 */
export function compileManagedNetworkOverrides(
  type: string,
  optionOverrides: Record<string, unknown> | undefined,
): ManagedCompileResult {
  const errors: ManagedCompileIssue[] = []
  const warnings: string[] = []
  const riskHints: Array<'upload_config' | 'remote_datasource'> = []
  const fieldMappingNotes: string[] = []
  const formDataSources: Array<Record<string, unknown>> = []
  const privilegedPatch: Record<string, unknown> = {}
  const publicOverrides: Record<string, unknown> = { ...(optionOverrides || {}) }

  // 凭据扫描（含 managed ref 内）
  errors.push(...findSecretLeaks(publicOverrides))

  const uploadRaw = publicOverrides.managedUploadRef
  const dsRaw = publicOverrides.managedDataSourceRef
  delete publicOverrides.managedUploadRef
  delete publicOverrides.managedDataSourceRef

  if (uploadRaw !== undefined) {
    if (!(type === 'file-upload' || type === 'picture-upload')) {
      errors.push({
        path: 'optionOverrides.managedUploadRef',
        message: `managedUploadRef 仅适用于 file-upload/picture-upload，当前 type=${type}`,
      })
    } else {
      const parsed = managedUploadRefSchema.safeParse(uploadRaw)
      if (!parsed.success) {
        errors.push({
          path: 'optionOverrides.managedUploadRef',
          message: parsed.error.issues.map((i) => i.message).join('; ') || 'managedUploadRef 无效',
        })
      } else {
        const resolved = resolveManagedUploadConnector(parsed.data)
        if (!resolved.ok) {
          errors.push({
            path: 'optionOverrides.managedUploadRef',
            message: resolved.message,
            riskCode: resolved.riskCode,
          })
        } else {
          publicOverrides.uploadURL = resolved.connector.uploadURL
          publicOverrides.withCredentials = false
          riskHints.push('upload_config')
          warnings.push(`managed-upload:${resolved.connector.id}@${resolved.connector.environment}`)
        }
      }
    }
  }

  if (dsRaw !== undefined) {
    const allowedDsTypes = new Set(['select', 'cascader', 'tree', 'data-table'])
    if (!allowedDsTypes.has(type)) {
      errors.push({
        path: 'optionOverrides.managedDataSourceRef',
        message: `managedDataSourceRef 仅适用于 select/cascader/tree/data-table，当前 type=${type}`,
      })
    } else {
      const parsed = managedDataSourceRefSchema.safeParse(dsRaw)
      if (!parsed.success) {
        errors.push({
          path: 'optionOverrides.managedDataSourceRef',
          message: parsed.error.issues.map((i) => i.message).join('; ') || 'managedDataSourceRef 无效',
        })
      } else {
        const resolved = resolveManagedDataSourceConnector(parsed.data)
        if (!resolved.ok) {
          errors.push({
            path: 'optionOverrides.managedDataSourceRef',
            message: resolved.message,
            riskCode: resolved.riskCode,
          })
        } else {
          const dataSetName = parsed.data.dataSetName || resolved.connector.dataSetName
          privilegedPatch.dsEnabled = true
          privilegedPatch.dsName = resolved.connector.dsName
          privilegedPatch.dataSetName = dataSetName
          if (type === 'select') privilegedPatch.remote = true
          formDataSources.push(buildMockDataSourceEntry(resolved.connector))
          riskHints.push('remote_datasource')
          warnings.push(
            `managed-datasource:${resolved.connector.id}@${resolved.connector.environment};ds=${resolved.connector.dsName}/${dataSetName}`,
          )
          if (parsed.data.fieldMapping) {
            const fm = parsed.data.fieldMapping
            const parts = [
              fm.label ? `label=${fm.label}` : '',
              fm.value ? `value=${fm.value}` : '',
              fm.children ? `children=${fm.children}` : '',
            ].filter(Boolean)
            fieldMappingNotes.push(`fieldMapping:${parts.join(',')}`)
            warnings.push(`managed-fieldMapping:${parts.join(',')}`)
          }
        }
      }
    }
  }

  // 直写 uploadURL：仅允许空或已登记 mock/test URL
  if (typeof publicOverrides.uploadURL === 'string' && publicOverrides.uploadURL.trim()) {
    const url = publicOverrides.uploadURL.trim()
    const known = Object.values(MANAGED_UPLOAD_CONNECTORS).some((c) => c.uploadURL === url)
    if (!known || isForbiddenProductionUrl(url)) {
      errors.push({
        path: 'optionOverrides.uploadURL',
        message: 'uploadURL 必须为空或引用已登记 mock/test connector（禁止生产/任意外网）',
        riskCode: 'production_external_write',
      })
    } else {
      riskHints.push('upload_config')
    }
  }

  // 禁止 withCredentials / 直写 ds*
  if (publicOverrides.withCredentials === true) {
    errors.push({
      path: 'optionOverrides.withCredentials',
      message: '禁止 withCredentials=true（凭据通道）',
      riskCode: 'credential_write',
    })
  }
  for (const key of MANAGED_PRIVILEGED_OPTION_KEYS) {
    if (key in publicOverrides) {
      errors.push({
        path: `optionOverrides.${key}`,
        message: `${key} 禁止直写；请使用 managedDataSourceRef`,
        riskCode: 'remote_datasource',
      })
      delete publicOverrides[key]
    }
  }

  return {
    ok: errors.length === 0,
    publicOverrides,
    privilegedPatch,
    formDataSources,
    fieldMappingNotes,
    riskHints: [...new Set(riskHints)],
    errors,
    warnings,
  }
}

/** 预览隔离：formConfig.dataSources 不得含生产环境或凭据 header */
export function assertManagedPreviewIsolation(formConfig: Record<string, unknown> | undefined): string[] {
  const issues: string[] = []
  if (!formConfig) return issues
  const sources = formConfig.dataSources
  if (!Array.isArray(sources)) return issues
  for (const [i, raw] of sources.entries()) {
    if (!isPlainObject(raw)) continue
    const env = String(raw.__managedEnvironment || '')
    if (env === 'production') {
      issues.push(`dataSources[${i}] production environment forbidden in preview`)
    }
    if (raw.__managedPreviewMode && raw.__managedPreviewMode !== MANAGED_PREVIEW_MODE) {
      issues.push(`dataSources[${i}] preview mode must be ${MANAGED_PREVIEW_MODE}`)
    }
    const url = String(raw.requestURL || '')
    if (url && isForbiddenProductionUrl(url)) {
      issues.push(`dataSources[${i}].requestURL not allowed in mock preview`)
    }
    const headers = raw.headers
    if (Array.isArray(headers)) {
      for (const h of headers) {
        if (!isPlainObject(h)) continue
        const name = String(h.name || h.key || '')
        const value = h.value
        if (looksLikeSecretKey(name) || looksLikeSecretValue(value)) {
          issues.push(`dataSources[${i}] header leaks credentials`)
        }
      }
    }
  }
  return issues
}

export function checkManagedNetworkPolicyParity(): string[] {
  const issues: string[] = []
  for (const [id, c] of Object.entries(MANAGED_UPLOAD_CONNECTORS)) {
    if (c.id !== id) issues.push(`upload connector key/id mismatch ${id}`)
    if (c.environment !== 'mock' && c.environment !== 'test') {
      issues.push(`upload connector ${id} must be mock|test`)
    }
    if (isForbiddenProductionUrl(c.uploadURL)) {
      issues.push(`upload connector ${id} uploadURL looks production`)
    }
  }
  for (const [id, c] of Object.entries(MANAGED_DATASOURCE_CONNECTORS)) {
    if (c.id !== id) issues.push(`datasource connector key/id mismatch ${id}`)
    if (c.environment !== 'mock' && c.environment !== 'test') {
      issues.push(`datasource connector ${id} must be mock|test`)
    }
    if (isForbiddenProductionUrl(c.requestURL)) {
      issues.push(`datasource connector ${id} requestURL looks production`)
    }
    if (c.method !== 'GET') issues.push(`datasource connector ${id} must be GET (read-only)`)
  }
  if (MANAGED_PREVIEW_MODE !== 'mock-only') {
    issues.push('MANAGED_PREVIEW_MODE must be mock-only')
  }
  return issues
}
