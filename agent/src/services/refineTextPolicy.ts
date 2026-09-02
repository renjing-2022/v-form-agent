import type { RefinePlan, RefineOperation } from '../schemas/refinePlan.js'

const STYLE_INTENT =
  /样式|布局|对齐|间距|重叠|遮挡|挤在一起|换行|溢出|颜色|字体|字号|大小|宽度|高度|边距|margin|padding|overlap|style|layout|align|css|美观|显示问题|排版|错位|重叠/i

/** 用户明确要改文案/标题（允许 label / textContent） */
const EXPLICIT_TEXT_INTENT =
  /文案|改(?:文字|标题|标签)|标题(?:改|换成)|标签名|改(?:成|为|叫)|替换|缩短|加长|rename|wording|内容|措辞|描述|说明文字|字段名|\blabel\b/i

/** 用户明确要改选项/分值等业务配置（允许 optionItems；不含仅描述「选项重叠」等布局话术） */
const EXPLICIT_OPTIONS_CHANGE_INTENT =
  /改(?:选项|option)|选项(?:改|调整|优化|文案)|分值|分制|optionItems|下拉选项|单选选项|多选选项/i

function filterOperation(
  op: RefineOperation,
  allowTextPatch: boolean,
  allowOptionItems: boolean,
): { op: RefineOperation | null; stripped: boolean } {
  if (op.op !== 'updateField') return { op, stripped: false }
  const patch = op.patch as Record<string, unknown>
  const touchesText = patch.label !== undefined || patch.textContent !== undefined
  const touchesOptions = patch.optionItems !== undefined
  if (
    (touchesText && !allowTextPatch) ||
    (touchesOptions && !allowOptionItems)
  ) {
    const nextPatch = { ...patch }
    if (!allowTextPatch) {
      delete nextPatch.label
      delete nextPatch.textContent
    }
    if (!allowOptionItems) delete nextPatch.optionItems
    if (Object.keys(nextPatch).length === 0) return { op: null, stripped: true }
    return { op: { ...op, patch: nextPatch as typeof op.patch }, stripped: true }
  }
  return { op, stripped: false }
}

/**
 * 样式/布局类诉求不得通过改字段文案、静态 text 或选项 label 来「假装」解决。
 * 仅当用户话术明确表达改文案/改选项时才允许相应 patch。
 */
export function enforceRefineTextPolicy(
  instruction: string,
  plan: RefinePlan,
): {
  plan: RefinePlan
  warnings: string[]
  reject?: boolean
  rejectMessage?: string
} {
  const styleIntent = STYLE_INTENT.test(instruction)
  const allowTextPatch = EXPLICIT_TEXT_INTENT.test(instruction)
  const allowOptionItems = EXPLICIT_OPTIONS_CHANGE_INTENT.test(instruction)

  if (!styleIntent) {
    return { plan, warnings: [] }
  }

  const warnings: string[] = []
  const operations: RefineOperation[] = []
  let strippedAny = false

  for (const op of plan.operations) {
    const { op: next, stripped } = filterOperation(op, allowTextPatch, allowOptionItems)
    if (stripped) strippedAny = true
    if (next) operations.push(next)
  }

  if (strippedAny) {
    warnings.push(
      '检测到样式/布局类诉求：已拒绝通过修改字段 label、textContent 或选项文案来规避样式问题。P0 不支持自定义 CSS；请明确说明要改文案/选项，或等待后续版本的受控样式能力。',
    )
  }

  if (operations.length === 0) {
    warnings.push('当前指令属于样式/布局优化，P0 仅支持结构、options 配置与公式；未产生可应用的变更。')
    return {
      plan,
      warnings,
      reject: true,
      rejectMessage:
        '样式/布局类诉求在 P0 不支持自动 CSS，且未允许通过修改表单文案规避。请手动调整样式，或改用明确的文案/结构/选项/公式指令。',
    }
  }

  return {
    plan: { ...plan, operations, warnings: [...plan.warnings, ...warnings] },
    warnings,
  }
}
