import fs from 'node:fs'
import path from 'node:path'
import { CREATE_NON_GOAL, type CreateNonGoalReason } from './createWhitelistPolicy.js'
import { WIDGETS_CONFIG_REL } from './catalogPolicy.js'
import type { WidgetCatalog, WidgetCatalogEntry } from './widgetCatalog.js'

export const EXTENSION_LOADER_REL = 'v-form/src/extension/extension-loader.js'

export const RUNTIME_REGISTER_APIS = [
  'addContainerWidgetSchema',
  'addBasicFieldSchema',
  'addAdvancedFieldSchema',
  'addCustomWidgetSchema',
  'addChartContainerSchema',
  'addChartSchema',
  'loadExtension',
] as const

export type KnownRuntimeExtension = {
  type: string
  category: 'container' | 'custom'
  registerVia: 'addContainerWidgetSchema' | 'addCustomWidgetSchema'
  sourceRel: typeof EXTENSION_LOADER_REL
  note: string
}

/**
 * extension-loader 样本：运行时注册、不在 widgetsConfig 静态 export 内。
 * Catalog 静态编译 intentionally 不包含这些 type 的全量 DesignTruthGraph。
 */
export const KNOWN_RUNTIME_EXTENSIONS: readonly KnownRuntimeExtension[] = [
  {
    type: 'card',
    category: 'container',
    registerVia: 'addContainerWidgetSchema',
    sourceRel: EXTENSION_LOADER_REL,
    note: 'loadExtension 动态注入容器 schema + 设计/运行期组件 + property editor + SFC generator',
  },
  {
    type: 'alert',
    category: 'custom',
    registerVia: 'addCustomWidgetSchema',
    sourceRel: EXTENSION_LOADER_REL,
    note: 'loadExtension 动态注入 customFields + 组件 + property editor + SFC generator',
  },
] as const

/** widgetsConfig 静态存在、但 agent create 划为 extension-runtime NON_GOAL 的 type */
export const STATIC_EXTENSION_ADJACENT_TYPES = ['slot'] as const

export type ExtensionBoundaryWidgetNote = {
  kind: 'static-adjacent'
  createNonGoal: Extract<CreateNonGoalReason, 'extension-runtime'>
  note: string
}

export function extensionBoundaryWidgetNote(type: string): ExtensionBoundaryWidgetNote | undefined {
  if (!(STATIC_EXTENSION_ADJACENT_TYPES as readonly string[]).includes(type)) return undefined
  return {
    kind: 'static-adjacent',
    createNonGoal: 'extension-runtime',
    note: 'slot 在 widgetsConfig 静态 advancedFields 内登记形状；运行时插槽语义，agent 不得 NL 新建',
  }
}

export function applyExtensionBoundaryWidgetNotes(entry: WidgetCatalogEntry): WidgetCatalogEntry {
  const boundary = extensionBoundaryWidgetNote(entry.type)
  if (!boundary) return entry
  return {
    ...entry,
    notes: {
      ...entry.notes,
      extensionBoundary: boundary,
    },
  }
}

export function extensionBoundaryCatalogBlock() {
  return {
    staticScope: {
      sourceRel: WIDGETS_CONFIG_REL,
      compileFrom: [
        'containers',
        'basicFields',
        'advancedFields',
        'customFields',
        'chartContainers',
        'chartWidgets',
      ],
      note: 'DesignTruthGraph/Catalog 仅编译 widgetsConfig.js 静态 export；runtime push 不参与 fingerprint',
    },
    customFields: {
      staticExportEmpty: true as const,
      registerApi: 'addCustomWidgetSchema' as const,
      note: 'customFields 出厂 export 为空数组；运行时 addCustomWidgetSchema 注入的类型不在静态全覆盖范围',
    },
    runtimeRegister: {
      sourceRel: EXTENSION_LOADER_REL,
      loadEntry: 'loadExtension' as const,
      registerApis: [...RUNTIME_REGISTER_APIS],
      knownRuntimeTypes: KNOWN_RUNTIME_EXTENSIONS.map((ext) => ({
        type: ext.type,
        category: ext.category,
        registerVia: ext.registerVia,
        sourceRel: ext.sourceRel,
        note: ext.note,
      })),
      staticCoverage: 'NON_GOAL' as const,
      note: '运行时 loadExtension 注册的组件/editor/generator 不在 v0.4 静态 DesignTruthGraph 全覆盖（须有 policy 声明边界）',
    },
    createNonGoal: {
      reason: 'extension-runtime' as const,
      staticTypes: [...STATIC_EXTENSION_ADJACENT_TYPES],
      note: 'Catalog 静态 type 中 extension-adjacent 项与 CREATE_NON_GOAL.extension-runtime 对齐',
    },
  }
}

export function checkExtensionBoundaryParity(root: string, catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const policy = catalog.extensionPolicy

  if (!policy) {
    issues.push('catalog.extensionPolicy missing')
    return issues
  }

  if (policy.staticScope.sourceRel !== WIDGETS_CONFIG_REL) {
    issues.push('extensionPolicy.staticScope.sourceRel must point to widgetsConfig.js')
  }
  if (policy.customFields.staticExportEmpty !== true) {
    issues.push('extensionPolicy.customFields.staticExportEmpty must be true')
  }
  if (policy.customFields.registerApi !== 'addCustomWidgetSchema') {
    issues.push('extensionPolicy.customFields.registerApi must be addCustomWidgetSchema')
  }
  if (policy.runtimeRegister.loadEntry !== 'loadExtension') {
    issues.push('extensionPolicy.runtimeRegister.loadEntry must be loadExtension')
  }
  if (policy.runtimeRegister.staticCoverage !== 'NON_GOAL') {
    issues.push('extensionPolicy.runtimeRegister.staticCoverage must be NON_GOAL')
  }
  if (policy.createNonGoal.reason !== 'extension-runtime') {
    issues.push('extensionPolicy.createNonGoal.reason must be extension-runtime')
  }

  const catalogTypes = new Set(catalog.widgets.map((w) => w.type))
  for (const ext of KNOWN_RUNTIME_EXTENSIONS) {
    if (catalogTypes.has(ext.type)) {
      issues.push(`runtime-only type "${ext.type}" must not appear in static Catalog.widgets`)
    }
    const declared = policy.runtimeRegister.knownRuntimeTypes.find((k) => k.type === ext.type)
    if (!declared) {
      issues.push(`extensionPolicy missing knownRuntimeTypes entry: ${ext.type}`)
    } else if (declared.registerVia !== ext.registerVia) {
      issues.push(`knownRuntimeTypes.${ext.type} registerVia mismatch`)
    }
  }

  for (const type of STATIC_EXTENSION_ADJACENT_TYPES) {
    if (!catalogTypes.has(type)) {
      issues.push(`static extension-adjacent type "${type}" must remain in Catalog`)
    }
    if (CREATE_NON_GOAL[type] !== 'extension-runtime') {
      issues.push(`${type} must be CREATE_NON_GOAL extension-runtime`)
    }
    if (!policy.createNonGoal.staticTypes.includes(type)) {
      issues.push(`extensionPolicy.createNonGoal.staticTypes must include ${type}`)
    }
    const widget = catalog.widgets.find((w) => w.type === type)
    if (!widget?.notes?.extensionBoundary) {
      issues.push(`${type} missing notes.extensionBoundary`)
    } else if (widget.notes.extensionBoundary.createNonGoal !== 'extension-runtime') {
      issues.push(`${type} extensionBoundary.createNonGoal must be extension-runtime`)
    }
  }

  const widgetsPath = path.join(root, WIDGETS_CONFIG_REL)
  if (!fs.existsSync(widgetsPath)) {
    issues.push(`missing widgetsConfig source: ${WIDGETS_CONFIG_REL}`)
  } else {
    const src = fs.readFileSync(widgetsPath, 'utf8')
    if (!/export const customFields = \[\s*\]/.test(src.replace(/\r\n/g, '\n'))) {
      issues.push('widgetsConfig customFields static export must be empty array')
    }
    for (const api of ['addCustomWidgetSchema', 'addContainerWidgetSchema'] as const) {
      if (!src.includes(`export function ${api}`)) {
        issues.push(`widgetsConfig must export runtime register API ${api}`)
      }
    }
  }

  const loaderPath = path.join(root, EXTENSION_LOADER_REL)
  if (!fs.existsSync(loaderPath)) {
    issues.push(`missing extension loader: ${EXTENSION_LOADER_REL}`)
  } else {
    const src = fs.readFileSync(loaderPath, 'utf8')
    if (!src.includes('export const loadExtension')) {
      issues.push('extension-loader must export loadExtension')
    }
    if (!src.includes('addCustomWidgetSchema(alertSchema)')) {
      issues.push('extension-loader must register alert via addCustomWidgetSchema')
    }
    if (!src.includes('addContainerWidgetSchema(cardSchema)')) {
      issues.push('extension-loader must register card via addContainerWidgetSchema')
    }
  }

  if (policy.runtimeRegister.knownRuntimeTypes.length !== KNOWN_RUNTIME_EXTENSIONS.length) {
    issues.push(
      `knownRuntimeTypes count expected ${KNOWN_RUNTIME_EXTENSIONS.length} got ${policy.runtimeRegister.knownRuntimeTypes.length}`,
    )
  }

  return issues
}
