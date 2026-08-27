import * as XLSX from 'xlsx'
import type { ExcelDigest } from '../schemas/fieldPlan.js'
import { excelDigestSchema } from '../schemas/fieldPlan.js'

function cellKey(r: number, c: number) {
  return `${r}:${c}`
}

export function parseAssessmentExcel(buffer: Buffer): ExcelDigest {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return excelDigestSchema.parse({ title: undefined, sections: [], notes: ['工作簿无工作表'] })
  }
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as string[][]

  const merges = sheet['!merges'] || []
  const mergeOwner = new Map<string, string>()
  for (const m of merges) {
    const owner =
      String(rows[m.s.r]?.[m.s.c] ?? '')
        .replace(/\r/g, '\n')
        .trim()
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue
        if (owner) mergeOwner.set(cellKey(r, c), owner)
      }
    }
  }

  const getCell = (r: number, c: number) => {
    const direct = String(rows[r]?.[c] ?? '')
      .replace(/\r/g, '\n')
      .trim()
    if (direct) return direct
    return mergeOwner.get(cellKey(r, c)) || ''
  }

  const notes: string[] = []
  let title: string | undefined
  const sections: ExcelDigest['sections'] = []
  let current: ExcelDigest['sections'][number] | null = null

  const isNoise = (text: string) => {
    if (!text) return true
    if (/中海康养|logo/i.test(text) && text.length < 20) return true
    if (text === '分值') return true
    return false
  }

  const isSection = (text: string) => {
    if (/小计|总分/.test(text)) return false
    return /评估|沟通|认知|感知|情绪|行为/.test(text) && !/^\d+\./.test(text)
  }

  const isQuestion = (text: string) => /^\d+[\.、]/.test(text) || /^\d+\s*[\.、]/.test(text)

  for (let r = 0; r < rows.length; r++) {
    const col0 = getCell(r, 0)
    const col1 = getCell(r, 1)
    const col2 = getCell(r, 2)
    const rowText = [col0, col1, col2].filter(Boolean).join(' | ')

    if (!title && r < 5 && rowText && /评估|表/.test(rowText) && rowText.length < 80) {
      title = rowText.split(' | ')[0]
    }

    if (isNoise(col0) && !col2) continue

    if (isSection(col0) || (isSection(rowText) && !isQuestion(col0))) {
      current = { name: col0 || rowText, items: [] }
      sections.push(current)
      continue
    }

    if (/小计|总分/.test(col0) || /小计|总分/.test(rowText)) {
      notes.push(`检测到汇总行：${col0 || rowText}（不做公式）`)
      if (!current) {
        current = { name: '汇总', items: [] }
        sections.push(current)
      }
      current.items.push({ label: col0 || rowText })
      continue
    }

    if (isQuestion(col0)) {
      if (!current) {
        current = { name: '未命名分区', items: [] }
        sections.push(current)
      }
      // 评分说明通常在右侧列；若同行为空则向下看若干行
      let optionText = col2 || col1
      if (!/\d+\s*分/.test(optionText)) {
        const parts: string[] = []
        for (let k = 0; k < 8 && r + k < rows.length; k++) {
          const t = getCell(r + k, 2) || getCell(r + k, 1)
          if (/\d+\s*分/.test(t)) parts.push(t)
          // 下一题开始则停止
          if (k > 0 && isQuestion(getCell(r + k, 0))) break
        }
        if (parts.length) optionText = parts.join('\n')
      }

      const sampleScore = /^\d+$/.test(col1) ? col1 : undefined
      current.items.push({
        label: col0.replace(/^\d+[\.、]\s*/, '').trim() || col0,
        optionText: optionText || undefined,
        sampleScore,
      })
    }
  }

  if (sections.length === 0) {
    notes.push('未识别到分区结构，请确认是否为评估量表版式 Excel')
  }

  return excelDigestSchema.parse({ title, sections, notes })
}
