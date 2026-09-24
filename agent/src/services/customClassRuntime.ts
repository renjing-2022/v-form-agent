/**
 * v-form 设计器/渲染对 widget.options.customClass 按 string[] 使用
 *（customClass-editor 为 el-select multiple；wrapper 里 .join(' ')）。
 * Agent 计划层仍用 string（catalog / setCustomClass schema），写出 formJson 时必须收敛为数组，
 * 否则宿主集成的未改版 v-form 会白屏：customClass.join is not a function。
 */

export function toVFormWidgetCustomClass(value: unknown): unknown {
  if (value == null) return value
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    return trimmed.split(/\s+/).filter(Boolean)
  }
  return value
}

type WalkNode = {
  options?: Record<string, unknown>
  widgetList?: WalkNode[]
  tabs?: WalkNode[]
  cols?: WalkNode[]
  rows?: Array<{ cols?: WalkNode[]; widgetList?: WalkNode[] }>
}

function walkWidgets(nodes: WalkNode[] | undefined, visit: (n: WalkNode) => void) {
  if (!Array.isArray(nodes)) return
  for (const n of nodes) {
    visit(n)
    walkWidgets(n.widgetList, visit)
    walkWidgets(n.tabs, visit)
    walkWidgets(n.cols, visit)
    if (Array.isArray(n.rows)) {
      for (const row of n.rows) {
        walkWidgets(row.cols, visit)
        walkWidgets(row.widgetList, visit)
      }
    }
  }
}

/** 就地修正 formJson 内所有控件的 customClass，返回修正次数 */
export function normalizeFormJsonWidgetCustomClasses(formJson: {
  widgetList?: unknown[]
}): number {
  let fixed = 0
  walkWidgets(formJson.widgetList as WalkNode[] | undefined, (n) => {
    const options = n.options
    if (!options || !('customClass' in options)) return
    const before = options.customClass
    if (typeof before !== 'string') return
    if (!before.trim()) return
    options.customClass = toVFormWidgetCustomClass(before)
    fixed += 1
  })
  return fixed
}
