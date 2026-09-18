import * as XLSX from 'xlsx'
import { assembleFormJson } from '../src/services/assembler.js'
import { parseAssessmentExcel } from '../src/services/excelParser.js'
import { heuristicPlanFromExcel, mockPlanFromText, parseScoreOptions } from '../src/services/planner.js'
import { collectWidgetIds, validateFormJson } from '../src/services/validator.js'
import { planFromText } from '../src/services/planner.js'
import { mockRefinePlan } from '../src/services/refinePlanner.js'
import { applyRefinePlan } from '../src/services/refineMerger.js'

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

  // 5) refine: tab wrap + options + formula (two-round)
  const existingIds = collectWidgetIds(textJson)
  const plan1 = mockRefinePlan('给表单增加两个 tab：基本信息 / 评估题目', textJson)
  const merge1 = applyRefinePlan(textJson, plan1)
  const issues1 = validateFormJson(merge1.formJson, { mode: 'refine', existingIds })
  assert(issues1.length === 0, `refine round1 validate failed: ${JSON.stringify(issues1)}`)
  assert(
    merge1.formJson.widgetList.some((w: any) => w.type === 'tab'),
    'refine round1 missing tab',
  )
  console.log('[ok] refine round1 wrapInTabs')

  // 5b) model often returns string targets — coerce must succeed
  const { normalizeRefinePlanRaw } = await import('../src/services/refinePlanner.js')
  const { refinePlanSchema } = await import('../src/schemas/refinePlan.js')
  const coercedPlan = refinePlanSchema.parse(
    normalizeRefinePlanRaw({
      summary: 'coerce string targets',
      warnings: [],
      operations: [
        {
          op: 'wrapInTabs',
          panes: [
            { label: 'A', targets: [String((textJson.widgetList[0] as any)?.options?.name || 'name')] },
            { label: 'B', targets: [] },
          ],
        },
      ],
    }),
  )
  const coercedMerge = applyRefinePlan(textJson, coercedPlan)
  assert(
    coercedMerge.formJson.widgetList.some((w: any) => w.type === 'tab'),
    'string-target coerce wrapInTabs failed',
  )
  console.log('[ok] refine string-target coerce')

  const existingIds2 = collectWidgetIds(merge1.formJson)
  const plan2 = mockRefinePlan('优化选项分值，并增加总分公式', merge1.formJson)
  const merge2 = applyRefinePlan(merge1.formJson, plan2)
  const issues2 = validateFormJson(merge2.formJson, { mode: 'refine', existingIds: existingIds2 })
  assert(issues2.length === 0, `refine round2 validate failed: ${JSON.stringify(issues2)}`)
  console.log('[ok] refine round2 options/formula')

  // 6) refine validation failure path: invent illegal new type
  const badJson = structuredClone(textJson) as any
  badJson.widgetList.push({
    type: 'data-table',
    id: 'new_illegal_1',
    options: { name: 'bad_table' },
    widgetList: [],
  })
  const badIssues = validateFormJson(badJson, { mode: 'refine', existingIds })
  assert(
    badIssues.some((i) => i.message.includes('新建白名单') || i.message.includes('refine create whitelist')),
    'expected refine create whitelist failure',
  )
  console.log('[ok] refine reject illegal new type')

  console.log('SMOKE_PASSED')
}

main().catch((err) => {
  console.error('SMOKE_FAILED', err)
  process.exit(1)
})
