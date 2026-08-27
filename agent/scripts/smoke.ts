import * as XLSX from 'xlsx'
import { assembleFormJson } from '../src/services/assembler.js'
import { parseAssessmentExcel } from '../src/services/excelParser.js'
import { heuristicPlanFromExcel, mockPlanFromText, parseScoreOptions } from '../src/services/planner.js'
import { validateFormJson } from '../src/services/validator.js'
import { planFromText } from '../src/services/planner.js'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'

  // 1) text mock plan -> assemble -> validate
  const textPlan = await planFromText('生成老年人认知评估表，含时间定向')
  const textJson = assembleFormJson(textPlan)
  const textIssues = validateFormJson(textJson)
  assert(textIssues.length === 0, `text validate failed: ${JSON.stringify(textIssues)}`)
  assert(textJson.widgetList.length > 0, 'text widgetList empty')
  console.log('[ok] text generate pipeline')

  // 2) score option parse
  const opts = parseScoreOptions('4分：无时间观念\n0分：时间观念清楚')
  assert(opts.length === 2, 'score options parse failed')
  console.log('[ok] score option parse')

  // 3) synthetic assessment excel
  const aoa = [
    ['老年人认知能力专项评估 (1-5级)', '', ''],
    ['认知评估: 16分', '', ''],
    ['1. 时间定向', '2', '4分：无时间观念\n3分：时间观念很差\n2分：时间观念较差\n1分：时间观念稍差\n0分：时间观念清楚'],
    ['2. 人物定向', '1', '4分：不认识亲人\n0分：认识周围所有人'],
    ['小计', '', ''],
    ['感知觉与沟通: 16分', '', ''],
    ['1. 视力', '0', '2分：完全失明\n0分：视力正常'],
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
  XLSX.utils.book_append_sheet(wb, ws, '评估')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const digest = parseAssessmentExcel(buf)
  assert(digest.sections.length >= 1, 'excel sections missing')
  const { plan, warnings } = heuristicPlanFromExcel(digest)
  const radio = plan.sections.flatMap((s) => s.fields).find((f) => f.type === 'radio')
  assert(radio && (radio.options?.length || 0) >= 2, 'excel radio options missing')
  const excelJson = assembleFormJson(plan)
  const excelIssues = validateFormJson(excelJson)
  assert(excelIssues.length === 0, `excel validate failed: ${JSON.stringify(excelIssues)}`)
  console.log('[ok] excel heuristic pipeline', { sections: digest.sections.length, warnings })

  // 4) negative empty buffer handling via parser notes
  const emptyWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(emptyWb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
  const emptyBuf = XLSX.write(emptyWb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const emptyDigest = parseAssessmentExcel(emptyBuf)
  assert(Array.isArray(emptyDigest.notes), 'empty digest notes missing')
  console.log('[ok] empty excel negative path')

  // ensure mockPlan still valid
  const mock = mockPlanFromText('x')
  assert(mock.sections.length > 0, 'mock plan empty')

  console.log('SMOKE_PASSED')
}

main().catch((err) => {
  console.error('SMOKE_FAILED', err)
  process.exit(1)
})
