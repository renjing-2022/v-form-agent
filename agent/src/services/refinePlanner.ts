import { refinePlanSchema, type FormJson, type RefinePlan } from '../schemas/refinePlan.js'
import { chatCompletion, type ChatMessage } from './deepseek.js'
import { REFINE_CREATE_WHITELIST } from '../knowledge/widgetWhitelist.js'
import { buildCatalogSnippets } from '../knowledge/catalogContext.js'
import { buildFormSummary } from './formSummary.js'
import {
  buildOverlapPropertyPatch,
  instructionHasOverlapIntent,
  pickOverlapTargets,
} from './refineLayoutPolicy.js'
import { instructionHasAlignIntent } from './refineAlignPolicy.js'
import { normalizeTargetRef } from './parentScopeParser.js'

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('model output is not valid JSON')
  }
}

type WidgetNode = {
  type?: string
  id?: string
  options?: Record<string, unknown>
  widgetList?: WidgetNode[]
  tabs?: WidgetNode[]
  cols?: WidgetNode[]
}

const systemPrompt = `你是 v-form 表单优化规划器。根据用户指令与当前表单摘要，输出 RefinePlan JSON（不要 Markdown）。
只能输出 operations，禁止直接输出完整 formJson。
允许的 op：
- updateField: { op, target:{id?|name?|label?|containerType?}, patch:{...} }  字段与 tab-pane/grid-col/tab/grid/sub-form/vf-dialog 容器属性；容器 target 建议带 containerType
- updateFieldsInScope: { op, parent:{id?|name?|label?|parentScope?}, filterType?, patch:{...} }  批量更新 parent 容器下字段；parent 可用 parentScope 语法如 tab-pane/基本信息 或 path:widgetList[0].tabs[0]
- setFormula: { op, target, formula, formulaEnabled? }  （仅 number；formula 可用字段 name，如 score1+score2）
- addField: { op, field:{key,label,type,required?,options?,formula?}, parent? }  parent 可为 tab-pane / sub-form / vf-dialog
- wrapInTabs: { op, tabName?, panes:[{label, targets:[{id:"..."} 或 {name:"..."}]}] }
- patchFormConfig: { op, patch:{labelWidth?,labelPosition?,labelAlign?,size?,layoutType?,cssCode?,customClass?,...} }
- setCustomClass: { op, target, customClass }
- setCssCode: { op, css, mode?:append|replace, target?, customClass? }  css 应尽量绑定 target/customClass，避免全局选择器
- removeField: { op, target }  删除单个控件；删除 tab-pane 时其内部控件一并删除；可删除整块 sub-form
- removeFieldsInScope: { op, parent, filterType? }  批量删除 parent 容器下字段
- reorderField: { op, target, position:{kind:first|last|before|after,sibling?} }  仅同级排序，禁止跨 tab/grid 移动
- duplicateField: { op, target, position? }  复制控件（新 id/name），默认插入源后一位
- addTableColumn: { op, table, column:{prop,label,width?,show?,align?,fixed?,sortable?}, position? }  仅扁平列；禁止多级表头
- removeTableColumn: { op, table, column:{columnId?|prop?|label?} }
- reorderTableColumn: { op, table, column, position:{kind:first|last|before|after,sibling?} }
- updateTableColumn: { op, table, column, patch:{label?,prop?,width?,show?,align?,fixed?,sortable?} }
重要：target / targets 必须是对象，禁止写成字符串。正确示例 targets:[{"name":"input1"},{"id":"radio2"}]；错误示例 targets:["input1","radio2"]。
重要：不支持 moveField / reparent；跨容器移动须用户手动操作。
重要：禁止 NL 新建 data-table / sub-form / vf-dialog / grid-sub-form / vf-drawer；禁止 updateField 整段替换 tableColumns。
重要：含 children/headerFlag 的多级表头表禁止列手术。

布局重叠修复顺序（必须完整执行，禁止半套）：
1. 长题干与选项重叠：优先 updateField 设置 labelWrap=true、displayStyle=block、必要时 labelWidth 数字加宽
2. 属性仍不足时：setCustomClass + setCssCode 绑定 scoped class
3. 禁止改 label/optionItems 文案冒充修复

枚举字面量（必须遵守，禁止用自然语言简称；合入前会经 NL 归一层自动转换）：
- 字段/表单 labelAlign 只能是：""（字段级继承表单）、"label-left-align"、"label-center-align"、"label-right-align"
- 禁止写 "right" / "left" / "center" / "右对齐" 等到 labelAlign
- displayStyle 只能是 "inline" 或 "block"
- labelWidth 必须是数字（如 450），禁止 "450px"
- size 只能是 "" / "large" / "small"，禁止 "default"
- columnWidth 为 css 文本（如 "200px"），不是 labelWidth 数字
- 字段 customClass 为 string；formConfig.customClass 为 string 数组

属性与样式规则（必须遵守）：
- 能用组件属性表达的（placeholder、labelWidth、labelWrap、displayStyle、columnWidth、size、labelAlign 等）优先 updateField / patchFormConfig，不要先写 CSS。
- 仅当用户明确要改文字/标题/选项文案/描述时，才可修改 label、textContent 或 optionItems 的 label。
- 用户描述样式/布局/对齐/间距/重叠/颜色/字体等视觉问题时：禁止通过改字段或选项文案来「假装」修复；应改可写属性，或输出 setCssCode / setCustomClass。
- 禁止输出事件回调（onChange、onCreated 等）以及 functions/dataSources。

可新建 type 仅限：${REFINE_CREATE_WHITELIST.join(', ')}
输出字段：summary, warnings[], operations[]`

export async function planRefine(params: {
  instruction: string
  currentFormJson: FormJson
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<{ plan: RefinePlan; usedMock: boolean }> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    if (process.env.AGENT_ALLOW_MOCK === '1') {
      return { plan: mockRefinePlan(params.instruction, params.currentFormJson), usedMock: true }
    }
    throw new Error('DEEPSEEK_API_KEY is not configured')
  }

  const history = (params.messages || []).slice(-12).map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }))

  const formSummary = buildFormSummary(params.currentFormJson, params.instruction)
  const catalogSnippets = buildCatalogSnippets(formSummary, undefined, params.instruction)

  const content = await chatCompletion([
    { role: 'system', content: systemPrompt },
    ...history,
    {
      role: 'user',
      content: JSON.stringify({
        instruction: params.instruction,
        formSummary,
        catalogSnippets,
        note: '请基于 formSummary 的 id/name/path/parent 精确定位；parentScope 可用 tab-pane/标签名、tab-pane#name、path:widgetList[0].tabs[0]；属性写入必须属于 catalogSnippets.writableKeys；枚举值必须属于 catalogSnippets.constraints.*.enum；未提及控件保持不变。',
      }),
    },
  ])

  const raw = normalizeRefinePlanRaw(extractJsonObject(content))
  const parsed = refinePlanSchema.parse(raw)
  return { plan: parsed, usedMock: false }
}

/** 容忍模型把 targets/target 写成字符串等常见偏差 */
export function normalizeRefinePlanRaw(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  const plan = input as Record<string, unknown>
  const ops = plan.operations
  if (!Array.isArray(ops)) return plan

  const coerceTarget = (t: unknown) => normalizeTargetRef(t)

  plan.operations = ops.map((op) => {
    if (!op || typeof op !== 'object') return op
    const o = { ...(op as Record<string, unknown>) }
    if (o.target !== undefined) o.target = coerceTarget(o.target)
    if (o.parent !== undefined) o.parent = coerceTarget(o.parent)
    if (o.op === 'wrapInTabs' && Array.isArray(o.panes)) {
      o.panes = o.panes.map((pane) => {
        if (!pane || typeof pane !== 'object') return pane
        const p = { ...(pane as Record<string, unknown>) }
        if (Array.isArray(p.targets)) p.targets = p.targets.map(coerceTarget)
        return p
      })
    }
    return o
  })
  return plan
}

export function mockRefinePlan(instruction: string, current: FormJson): RefinePlan {
  const root = (current.widgetList || []) as WidgetNode[]
  const flat = buildFormSummary(current)
  const warnings: string[] = ['当前使用 mock refine 规划（未配置 DeepSeek Key）']
  const operations: RefinePlan['operations'] = []

  const styleIntent =
    /样式|布局|对齐|间距|重叠|遮挡|换行|溢出|颜色|字体|字号|美观|排版|错位|margin|padding|overlap|style|layout|align|css/i.test(
      instruction,
    )
  const explicitTextIntent =
    /文案|改(?:文字|标题|标签)|标题(?:改|换成)|标签名|改(?:成|为|叫)|替换|缩短|加长|rename|wording|内容|措辞|描述|说明文字|字段名|\blabel\b/i.test(
      instruction,
    )
  const wantPlaceholder = /placeholder|占位|提示文字/i.test(instruction)
  const wantPreciseRequired = /时间定向.*必填|必填.*时间定向/i.test(instruction)
  const wantCssApply =
    styleIntent && /cssCode|用CSS|受控样式|css修复/i.test(instruction)
  const wantDangerousCss = /E2E危险CSS/i.test(instruction)
  const wantExplicitRename =
    /改(?:成|为|叫)|标题改成|标签名/i.test(instruction) && !wantPlaceholder
  const wantTabs = /tab|页签|选项卡/i.test(instruction) || (/标签/i.test(instruction) && /tab|页签|选项卡/i.test(instruction))
  const wantOptions = /选项|option|分值|改(?:选项|分值)/i.test(instruction)
  const wantFormula = /公式|总分|合计|计算|求和/i.test(instruction)
  const wantRemove = /删除|删掉|去掉|移除/i.test(instruction)
  const wantDuplicate = /复制|拷贝|再来一份|duplicate/i.test(instruction)
  const wantReorder =
    /移到.*下面|排到.*下面|移到.*上面|排到.*上面|放到.*后面|放到.*前面|同级排序|reorder/i.test(instruction)
  const wantAddRemark = /新增.*备注|加一个备注|添加备注/i.test(instruction)
  const wantAddColumn = /加一列|新增.*列|添加.*列|增列|addTableColumn/i.test(instruction)
  const wantRemoveColumn = /删.*列|去掉.*列|移除.*列|removeTableColumn/i.test(instruction)
  const wantUpdateColumn = /列.*(标题|宽度|改)|改.*列|updateTableColumn/i.test(instruction)
  const wantReorderColumn = /列.*(移到|排序|重排)|reorderTableColumn/i.test(instruction)
  const wantDialogShell = /弹窗|对话框|dialog|vf-dialog/i.test(instruction) && /标题|宽度|title|width/i.test(instruction)
  const wantSubFormShell =
    /子表|sub-form|subform/i.test(instruction) && /行号|空白行|showRowNumber|showBlankRow|标签对齐/i.test(instruction)

  const dataTable = flat.find((f) => f.type === 'data-table')
  const subForm = flat.find((f) => f.type === 'sub-form')
  const dialog = flat.find((f) => f.type === 'vf-dialog')

  if (wantDialogShell && dialog) {
    const titleMatch = instruction.match(/标题(?:改|成|为|成)?[「"']?([^」"'\s]+)[」"']?/)
    const widthMatch = instruction.match(/宽度(?:改|成|为)?\s*(\d+%?|\d+px)/i)
    const patch: Record<string, unknown> = {}
    if (titleMatch) patch.title = titleMatch[1]
    else if (/标题/i.test(instruction)) patch.title = '新弹窗标题'
    if (widthMatch) patch.width = widthMatch[1].includes('%') || widthMatch[1].includes('px') ? widthMatch[1] : `${widthMatch[1]}%`
    else if (/宽度/i.test(instruction)) patch.width = '60%'
    if (Object.keys(patch).length > 0) {
      return refinePlanSchema.parse({
        summary: '更新 vf-dialog 壳层属性',
        warnings,
        operations: [
          {
            op: 'updateField',
            target: dialog.id
              ? { id: dialog.id, containerType: 'vf-dialog' }
              : { name: dialog.name!, containerType: 'vf-dialog' },
            patch,
          },
        ],
      })
    }
  }

  if (wantSubFormShell && subForm) {
    const patch: Record<string, unknown> = {}
    if (/显示行号|showRowNumber/i.test(instruction)) patch.showRowNumber = !/不显示行号|隐藏行号/i.test(instruction)
    if (/空白行|showBlankRow/i.test(instruction)) patch.showBlankRow = !/隐藏空白|不显示空白/i.test(instruction)
    if (/标签.*居中|labelAlign.*center/i.test(instruction)) patch.labelAlign = 'label-center-align'
    if (Object.keys(patch).length === 0) patch.showRowNumber = true
    return refinePlanSchema.parse({
      summary: '更新 sub-form 壳层属性',
      warnings,
      operations: [
        {
          op: 'updateField',
          target: subForm.id
            ? { id: subForm.id, containerType: 'sub-form' }
            : { name: subForm.name!, containerType: 'sub-form' },
          patch,
        },
      ],
    })
  }

  if ((wantAddColumn || wantRemoveColumn || wantUpdateColumn || wantReorderColumn) && dataTable) {
    const tableTarget = dataTable.id
      ? { id: dataTable.id, containerType: 'data-table' as const }
      : { name: dataTable.name!, containerType: 'data-table' as const }
    if (wantAddColumn) {
      const labelMatch = instruction.match(/加一列[「"']?([^」"'\s]+)[」"']?|列[「"']?([^」"'\s]+)[」"']?/)
      const label = labelMatch?.[1] || labelMatch?.[2] || '备注'
      return refinePlanSchema.parse({
        summary: `data-table 新增列 ${label}`,
        warnings,
        operations: [
          {
            op: 'addTableColumn',
            table: tableTarget,
            column: { prop: label === '备注' ? 'remark' : `col_${Date.now() % 10000}`, label, width: '120', show: true },
          },
        ],
      })
    }
    if (wantRemoveColumn) {
      const labelMatch = instruction.match(/删(?:掉|除)?[「"']?([^」"'\s]+)[」"']?列|列[「"']?([^」"'\s]+)[」"']?/)
      const label = labelMatch?.[1] || labelMatch?.[2] || '姓名'
      return refinePlanSchema.parse({
        summary: `data-table 删除列 ${label}`,
        warnings,
        operations: [{ op: 'removeTableColumn', table: tableTarget, column: { label } }],
      })
    }
    if (wantReorderColumn) {
      return refinePlanSchema.parse({
        summary: 'data-table 列重排',
        warnings,
        operations: [
          {
            op: 'reorderTableColumn',
            table: tableTarget,
            column: { prop: 'name' },
            position: { kind: 'last' },
          },
        ],
      })
    }
    if (wantUpdateColumn) {
      const widthMatch = instruction.match(/宽度(?:改|成|为)?\s*(\d+)/)
      const patch: { label?: string; width?: string } = {}
      if (/标题|改名/i.test(instruction)) patch.label = '姓名列'
      patch.width = widthMatch ? String(widthMatch[1]) : '140'
      return refinePlanSchema.parse({
        summary: 'data-table 更新列',
        warnings,
        operations: [
          {
            op: 'updateTableColumn',
            table: tableTarget,
            column: { prop: 'name' },
            patch,
          },
        ],
      })
    }
  }

  if (wantAddRemark && !wantRemove) {
    return refinePlanSchema.parse({
      summary: '新增备注输入框',
      warnings,
      operations: [
        {
          op: 'addField',
          field: { key: 'remark', label: '备注', type: 'input' },
        },
      ],
    })
  }

  if (wantRemove && /tab|页签|选项卡/i.test(instruction)) {
    const panes = flat.filter((f) => f.type === 'tab-pane')
    const pane =
      panes.find((p) => /第二|2|评估/i.test(p.label || '')) ||
      panes[1] ||
      panes[0]
    if (pane) {
      return refinePlanSchema.parse({
        summary: '删除 tab-pane 及其内部控件',
        warnings,
        operations: [
          {
            op: 'removeField',
            target: pane.id
              ? { id: pane.id, containerType: 'tab-pane' }
              : { label: pane.label!, containerType: 'tab-pane' },
          },
        ],
      })
    }
  }

  if (wantRemove) {
    const target =
      flat.find((f) => /备注|说明|删除/.test(f.label || '')) ||
      flat.find((f) => f.type === 'input' || f.type === 'textarea' || f.type === 'static-text') ||
      flat[0]
    if (target && target.type !== 'tab' && target.type !== 'grid') {
      return refinePlanSchema.parse({
        summary: `删除字段 ${target.label || target.name || target.id}`,
        warnings,
        operations: [
          {
            op: 'removeField',
            target: target.id ? { id: target.id } : target.name ? { name: target.name } : { label: target.label! },
          },
        ],
      })
    }
  }

  if (wantDuplicate) {
    const target =
      flat.find((f) => (f.label || '') && instruction.includes(f.label || '')) ||
      flat.find((f) => f.type === 'radio') ||
      flat.find((f) => f.type === 'input') ||
      flat[0]
    if (target) {
      return refinePlanSchema.parse({
        summary: `复制控件 ${target.label || target.name || target.id}`,
        warnings,
        operations: [
          {
            op: 'duplicateField',
            target: target.id ? { id: target.id } : target.name ? { name: target.name } : { label: target.label! },
          },
        ],
      })
    }
  }

  if (wantReorder && flat.length >= 2) {
    const moveMatch = instruction.match(/把(.+?)移到(.+?)(?:下面|后面|之后)/)
    const movingLabel = moveMatch?.[1]?.trim()
    const anchorLabel = moveMatch?.[2]?.trim()
    const moving =
      (movingLabel ? flat.find((f) => (f.label || '').includes(movingLabel)) : undefined) ||
      flat.find((f) => /性别|备注|评分/.test(f.label || '')) ||
      flat[1]
    const anchor =
      (anchorLabel ? flat.find((f) => f !== moving && (f.label || '').includes(anchorLabel)) : undefined) ||
      flat.find((f) => f !== moving && /姓名|时间定向|人物定向/.test(f.label || '')) ||
      flat[0]
    if (moving && anchor && (moving.id || moving.name) && (anchor.id || anchor.name)) {
      return refinePlanSchema.parse({
        summary: `同级排序：将 ${moving.label || moving.name} 移到 ${anchor.label || anchor.name} 之后`,
        warnings,
        operations: [
          {
            op: 'reorderField',
            target: moving.id ? { id: moving.id } : { name: moving.name! },
            position: {
              kind: 'after',
              sibling: anchor.id ? { id: anchor.id } : { name: anchor.name! },
            },
          },
        ],
      })
    }
  }

  if (wantDangerousCss) {
    return refinePlanSchema.parse({
      summary: 'E2E 危险 CSS 拦截验收',
      warnings,
      operations: [
        {
          op: 'setCssCode',
          css: '@import url(https://evil.example/x.css); body{color:red}',
          mode: 'append',
        },
      ],
    })
  }

  if (wantPlaceholder) {
    const input =
      flat.find((f) => f.type === 'input' && /姓名|name/i.test(f.label || f.name || '')) ||
      flat.find((f) => f.type === 'input')
    if (input) {
      return refinePlanSchema.parse({
        summary: '按 Catalog 修改 input placeholder',
        warnings,
        operations: [
          {
            op: 'updateField',
            target: input.id ? { id: input.id } : { name: input.name! },
            patch: { placeholder: '请输入姓名' },
          },
        ],
      })
    }
  }

  if (wantPreciseRequired) {
    const target = flat.find((f) => /时间定向/.test(f.label || ''))
    if (target) {
      return refinePlanSchema.parse({
        summary: '精准命中时间定向字段并设为必填',
        warnings,
        operations: [
          {
            op: 'updateField',
            target: target.id ? { id: target.id } : { name: target.name! },
            patch: { required: true },
          },
        ],
      })
    }
  }

  if (instructionHasAlignIntent(instruction)) {
    const radios = flat.filter((f) => f.type === 'radio')
    const labelAlign = /居中|center/i.test(instruction)
      ? 'label-center-align'
      : /左|left/i.test(instruction)
        ? 'label-left-align'
        : 'label-right-align'
    if (radios.length > 0) {
      return refinePlanSchema.parse({
        summary: `批量设置 radio labelAlign=${labelAlign}`,
        warnings,
        operations: radios.map((r) => ({
          op: 'updateField',
          target: r.id ? { id: r.id } : { name: r.name! },
          patch: { labelAlign },
        })),
      })
    }
  }

  if (wantCssApply) {
    const radio =
      flat.find((f) => f.type === 'radio' && /时间定向/.test(f.label || '')) ||
      flat.find((f) => f.type === 'radio')
    if (radio) {
      const cls = `field-${radio.name || radio.id || 'radio'}`
      return refinePlanSchema.parse({
        summary: '受控 cssCode 修复布局重叠',
        warnings,
        operations: [
          {
            op: 'setCssCode',
            css: `.${cls} { margin-top: 12px; display: block; }`,
            mode: 'append',
            target: radio.id ? { id: radio.id } : { name: radio.name! },
            customClass: cls,
          },
        ],
      })
    }
  }

  if (wantExplicitRename && flat[0]) {
    const target = flat[0]
    return refinePlanSchema.parse({
      summary: '按用户要求修改字段标题',
      warnings,
      operations: [
        {
          op: 'updateField',
          target: target.id ? { id: target.id } : { name: target.name! },
          patch: { label: '评估项A' },
        },
      ],
    })
  }

  if (
    styleIntent &&
    instructionHasOverlapIntent(instruction) &&
    !explicitTextIntent &&
    !wantOptions &&
    !wantFormula &&
    !wantTabs &&
    !wantCssApply
  ) {
    const targets = pickOverlapTargets(current, instruction)
    const patch = buildOverlapPropertyPatch(instruction)
    if (targets.length > 0 && Object.keys(patch).length > 0) {
      return refinePlanSchema.parse({
        summary: '属性修复标签与选项重叠（labelWrap + displayStyle:block + labelWidth）',
        warnings,
        operations: targets.map((t) => ({
          op: 'updateField',
          target: t.id ? { id: t.id } : { name: t.name! },
          patch,
        })),
      })
    }
  }

  // 模拟 LLM 用改 label 规避样式问题的错误规划（供 FR-6 / enforceRefineTextPolicy 验收）
  if (
    styleIntent &&
    !instructionHasOverlapIntent(instruction) &&
    !instructionHasAlignIntent(instruction) &&
    !explicitTextIntent &&
    !wantOptions &&
    !wantFormula &&
    !wantTabs &&
    !wantCssApply &&
    flat[0]
  ) {
    const target = flat[0]
    return refinePlanSchema.parse({
      summary: '通过缩短标题缓解重叠（模拟错误规划）',
      warnings,
      operations: [
        {
          op: 'updateField',
          target: target.id ? { id: target.id } : { name: target.name! },
          patch: { label: '短标题' },
        },
      ],
    })
  }

  if (wantTabs && !root.some((w) => w.type === 'tab')) {
    const mid = Math.max(1, Math.ceil(flat.length / 2))
    const left = flat.slice(0, mid).filter((f) => f.id || f.name)
    const right = flat.slice(mid).filter((f) => f.id || f.name)
    operations.push({
      op: 'wrapInTabs',
      tabName: 'main_tabs',
      panes: [
        {
          label: /基本|信息/.test(instruction) ? '基本信息' : '分组一',
          targets: left.map((f) => (f.id ? { id: f.id } : { name: f.name! })),
        },
        {
          label: /评估|题目/.test(instruction) ? '评估题目' : '分组二',
          targets: right.map((f) => (f.id ? { id: f.id } : { name: f.name! })),
        },
      ],
    })
  }

  if (wantOptions) {
    const choice = flat.find((f) => f.type === 'radio' || f.type === 'select')
    if (choice) {
      operations.push({
        op: 'updateField',
        target: choice.id ? { id: choice.id } : { name: choice.name! },
        patch: {
          optionItems: [
            { value: 4, label: '4分：很好' },
            { value: 2, label: '2分：一般' },
            { value: 0, label: '0分：较差' },
          ],
        },
      })
    } else {
      warnings.push('未找到 radio/select，跳过选项优化')
    }
  }

  if (wantFormula) {
    const numberField = flat.find((f) => f.type === 'number')
    const scoreFields = flat.filter((f) => f.type === 'radio' || f.type === 'number').slice(0, 3)
    if (numberField && scoreFields.length > 0) {
      const expr = scoreFields
        .map((f) => f.name || f.id)
        .filter(Boolean)
        .join('+')
      operations.push({
        op: 'setFormula',
        target: numberField.id ? { id: numberField.id } : { name: numberField.name! },
        formula: expr || '0',
        formulaEnabled: true,
      })
    } else {
      const names = scoreFields.map((f) => f.name).filter(Boolean) as string[]
      operations.push({
        op: 'addField',
        field: {
          key: 'total_score',
          label: '总分',
          type: 'number',
          required: false,
          formulaEnabled: true,
          formula: names.length >= 2 ? names.join('+') : names[0] || '0',
        },
      })
    }
  }

  if (operations.length === 0) {
    operations.push({
      op: 'addField',
      field: {
        key: 'ai_note',
        label: '优化备注',
        type: 'textarea',
        required: false,
      },
    })
    warnings.push('指令未匹配到 tab/选项/公式模式，已降级为追加备注字段')
  }

  return refinePlanSchema.parse({
    summary: `已根据指令规划 ${operations.length} 项变更`,
    warnings,
    operations,
  })
}
