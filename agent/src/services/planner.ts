import { fieldPlanSchema, type ExcelDigest, type FieldPlan } from '../schemas/fieldPlan.js'
import { FIELD_WHITELIST } from '../knowledge/widgetWhitelist.js'
import { chatCompletion } from './deepseek.js'

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

const systemPrompt = `你是 v-form 低代码表单规划器。根据用户需求输出 FieldPlan JSON（不要 Markdown）。
规则：
1. 只允许 type: ${FIELD_WHITELIST.join(', ')}
2. 评估/量表题目优先用 radio，options 的 value 用分值，label 用评分说明
3. 不要输出事件回调代码
4. layout 用 sectioned 或 single-column
5. 每个 field 必须有唯一 key（英文或拼音）和中文 label
6. 输出严格 JSON，字段：formTitle, layout, sections[{title, fields[{key,label,type,required?,options?}]}]`

export async function planFromText(prompt: string): Promise<FieldPlan> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    if (process.env.AGENT_ALLOW_MOCK === '1') {
      return mockPlanFromText(prompt)
    }
    throw new Error('DEEPSEEK_API_KEY is not configured')
  }

  const content = await chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ])
  const parsed = extractJsonObject(content)
  return fieldPlanSchema.parse(parsed)
}

export async function planFromExcelDigest(
  digest: ExcelDigest,
  extraPrompt?: string,
): Promise<{ plan: FieldPlan; warnings: string[]; usedMock: boolean }> {
  const heuristic = heuristicPlanFromExcel(digest)
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()

  // Excel 启发式已足够时优先使用，避免无必要模型调用；有 Key 时可用模型润色标题
  if (!apiKey) {
    if (heuristic.plan.sections.some((s) => s.fields.length > 0)) {
      return {
        plan: heuristic.plan,
        warnings: [
          ...digest.notes,
          ...heuristic.warnings,
          '未配置 DEEPSEEK_API_KEY，已使用 Excel 启发式规划',
        ],
        usedMock: true,
      }
    }
    if (process.env.AGENT_ALLOW_MOCK === '1') {
      return {
        plan: mockPlanFromText(extraPrompt || digest.title || '评估表'),
        warnings: [...digest.notes, 'Excel 解析字段不足，已回退 mock 文本规划'],
        usedMock: true,
      }
    }
    throw new Error('DEEPSEEK_API_KEY is not configured and excel heuristic produced empty plan')
  }

  try {
    const content = await chatCompletion([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          instruction:
            '将下列 ExcelDigest 转为 FieldPlan。评估题用 radio；分区标题保留；忽略已填分数；小计/总分不要做公式。',
          extraPrompt: extraPrompt || '',
          digest,
        }),
      },
    ])
    const parsed = fieldPlanSchema.parse(extractJsonObject(content))
    return { plan: parsed, warnings: digest.notes, usedMock: false }
  } catch (err) {
    return {
      plan: heuristic.plan,
      warnings: [
        ...digest.notes,
        ...heuristic.warnings,
        `模型规划失败，已回退启发式：${err instanceof Error ? err.message : String(err)}`,
      ],
      usedMock: false,
    }
  }
}

export function parseScoreOptions(optionText?: string) {
  if (!optionText) return []
  const text = optionText.replace(/\r/g, '\n')
  const matches = [...text.matchAll(/(\d+)\s*分\s*[:：]\s*([^\n]+)/g)]
  if (matches.length === 0) return []
  return matches.map((m) => ({
    value: Number(m[1]),
    label: `${m[1]}分：${m[2].trim()}`,
  }))
}

export function heuristicPlanFromExcel(digest: ExcelDigest): {
  plan: FieldPlan
  warnings: string[]
} {
  const warnings: string[] = []
  const sections = digest.sections
    .map((section) => {
      const fields = section.items
        .map((item, idx) => {
          const options = parseScoreOptions(item.optionText)
          if (options.length > 0) {
            return {
              key: `q_${slug(section.name)}_${idx + 1}`,
              label: item.label,
              type: 'radio' as const,
              required: true,
              options,
            }
          }
          if (/小计|总分/.test(item.label)) {
            return {
              key: `note_${slug(item.label)}_${idx + 1}`,
              label: item.label,
              type: 'static-text' as const,
              textContent: item.label,
            }
          }
          warnings.push(`题目「${item.label}」未识别评分选项，降级为 input`)
          return {
            key: `f_${slug(item.label)}_${idx + 1}`,
            label: item.label,
            type: 'input' as const,
            required: false,
          }
        })
        .filter(Boolean)

      return {
        title: section.name,
        fields,
      }
    })
    .filter((s) => s.fields.length > 0)

  if (sections.length === 0) {
    warnings.push('未能从 Excel 识别有效分区/题目')
  }

  return {
    plan: fieldPlanSchema.parse({
      formTitle: digest.title || '评估表单',
      layout: 'sectioned',
      sections:
        sections.length > 0
          ? sections
          : [
              {
                title: '默认',
                fields: [{ key: 'placeholder', label: '请补充字段', type: 'input' }],
              },
            ],
    }),
    warnings,
  }
}

export function mockPlanFromText(prompt: string): FieldPlan {
  const title = prompt.slice(0, 40) || 'AI 生成表单'
  return fieldPlanSchema.parse({
    formTitle: title,
    layout: 'sectioned',
    sections: [
      {
        title: '基本信息',
        fields: [
          { key: 'name', label: '姓名', type: 'input', required: true },
          { key: 'age', label: '年龄', type: 'number', required: false },
          { key: 'assess_date', label: '评估日期', type: 'date', required: false },
        ],
      },
      {
        title: '评估项',
        fields: [
          {
            key: 'time_orient',
            label: '时间定向',
            type: 'radio',
            required: true,
            options: [
              { value: 4, label: '4分：无时间观念' },
              { value: 3, label: '3分：时间观念很差' },
              { value: 2, label: '2分：时间观念较差' },
              { value: 1, label: '1分：时间观念稍差' },
              { value: 0, label: '0分：时间观念清楚' },
            ],
          },
          { key: 'remark', label: '备注', type: 'textarea', required: false },
        ],
      },
    ],
  })
}

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'x'
}
