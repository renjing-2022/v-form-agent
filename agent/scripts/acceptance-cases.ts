/**
 * 非 Playwright Acceptance candidates 取证脚本（api / smoke / static）
 * 输出：docs/evidence/v0.2.0/<case-id>.txt
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleFormJson } from '../src/services/assembler.js'
import { mockPlanFromText } from '../src/services/planner.js'
import { mockRefinePlan, normalizeRefinePlanRaw } from '../src/services/refinePlanner.js'
import { applyRefinePlan } from '../src/services/refineMerger.js'
import { collectWidgetIds, validateFormJson } from '../src/services/validator.js'
import { refinePlanSchema } from '../src/schemas/refinePlan.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, 'docs/evidence/v0.2.0')

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function writeCase(caseId: string, observed: string, extra: Record<string, string> = {}) {
  const lines = [
    `case: ${caseId}`,
    `status: pass`,
    `observed: ${observed}`,
    `environment: local-windows; agent acceptance-cases script; AGENT_ALLOW_MOCK=1`,
    `sourceRevision: working-tree-uncommitted`,
    `capturedAt: ${new Date().toISOString()}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
  ]
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${caseId}.txt`), `${lines.join('\n')}\n`, 'utf8')
  console.log(`[ok] wrote ${caseId}.txt`)
}

function readRepoFile(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

async function main() {
  process.env.AGENT_ALLOW_MOCK = '1'

  // agent-health: module/boot contract via smoke imports + health route source
  const serverSrc = readRepoFile('agent/src/server.ts')
  assert(serverSrc.includes("app.get('/health'"), 'health route missing')
  assert(serverSrc.includes('registerRefineRoutes'), 'refine routes not registered')
  writeCase('agent-health', 'health route and refine registration present in agent/src/server.ts')

  // text-generate-apply: API generate path + frontend confirm wiring (static, no E2E)
  const base = assembleFormJson(mockPlanFromText('生成含评估题的表单'))
  const genIssues = validateFormJson(base)
  assert(genIssues.length === 0, `generate validate failed: ${JSON.stringify(genIssues)}`)
  const aiChat = readRepoFile('v-form/src/components/AiChat/index.vue')
  const setting = readRepoFile('v-form/src/components/form-designer/setting-panel/index.vue')
  assert(aiChat.includes('应用到设计器'), 'apply button missing')
  assert(aiChat.includes("emit('apply'"), 'apply emit missing')
  assert(!/onMounted\(\)\s*\{[\s\S]*emit\('apply'/.test(aiChat), 'must not auto-apply on mount')
  assert(setting.includes('applyAiFormJson'), 'applyAiFormJson missing')
  assert(setting.includes('loadFormJson'), 'loadFormJson wiring missing')
  writeCase(
    'text-generate-apply',
    `mock generate widgetCount=${base.widgetList.length}; AiChat requires explicit apply emit; setting-panel applyAiFormJson -> loadFormJson`,
    { type: 'api+static', note: 'Playwright deferred by request; confirmed via generate pipeline + source wiring' },
  )

  // coerce string targets (manual bug fix regression)
  const coerced = refinePlanSchema.parse(
    normalizeRefinePlanRaw({
      summary: 'string targets coerce',
      warnings: [],
      operations: [
        {
          op: 'wrapInTabs',
          panes: [
            { label: '基本信息', targets: ['name', base.widgetList[0]?.id || 'input1'] },
            { label: '评估题目', targets: [] },
          ],
        },
      ],
    }),
  )
  assert(typeof (coerced.operations[0] as any).panes[0].targets[0] === 'object', 'coerce failed')

  // refine-structure-tab
  const ids0 = collectWidgetIds(base)
  const planTab = mockRefinePlan('给表单增加两个 tab：基本信息 / 评估题目', base)
  const mergedTab = applyRefinePlan(base, planTab)
  const tabIssues = validateFormJson(mergedTab.formJson, { mode: 'refine', existingIds: ids0 })
  assert(tabIssues.length === 0, `tab refine issues: ${JSON.stringify(tabIssues)}`)
  assert(mergedTab.formJson.widgetList.some((w: any) => w.type === 'tab'), 'tab missing')
  // also apply coerced string-target plan onto a fresh copy
  const mergedCoerced = applyRefinePlan(base, coerced)
  assert(mergedCoerced.formJson.widgetList.some((w: any) => w.type === 'tab'), 'coerced wrapInTabs failed')
  writeCase(
    'refine-structure-tab',
    `wrapInTabs produced tab; string-target coerce path also produced tab; validate issues=0`,
    { type: 'api+smoke' },
  )

  // refine-options-formula + multiturn
  const ids1 = collectWidgetIds(mergedTab.formJson)
  const plan2 = mockRefinePlan('优化选项分值，并增加总分公式', mergedTab.formJson)
  const merged2 = applyRefinePlan(mergedTab.formJson, plan2)
  const issues2 = validateFormJson(merged2.formJson, { mode: 'refine', existingIds: ids1 })
  assert(issues2.length === 0, `round2 issues: ${JSON.stringify(issues2)}`)
  const hasFormula = JSON.stringify(merged2.formJson).includes('formulaEnabled')
  assert(hasFormula, 'formula not present after round2')
  writeCase(
    'refine-options-formula',
    `second-round refine applied options/formula; formulaEnabled present=${hasFormula}; validate issues=0`,
    { type: 'api+smoke' },
  )
  writeCase(
    'refine-multiturn-apply',
    `two sequential refine merges on evolving formJson succeeded (tab then options/formula); apply still requires UI confirm (static)`,
    { type: 'api+static', note: 'Playwright deferred; multiturn proven at agent merge layer' },
  )

  // refine-reject-keeps-canvas: illegal new type rejected; UI does not auto-apply
  const bad = structuredClone(base) as any
  bad.widgetList.push({
    type: 'data-table',
    id: 'new_illegal_1',
    options: { name: 'bad_table' },
    widgetList: [],
  })
  const badIssues = validateFormJson(bad, { mode: 'refine', existingIds: ids0 })
  assert(badIssues.some((i) => i.message.includes('refine create whitelist')), 'expected reject')
  assert(aiChat.includes('error.value'), 'error state present')
  assert(aiChat.includes(':disabled="!lastResult'), 'apply disabled without result')
  writeCase(
    'refine-reject-keeps-canvas',
    `illegal new type rejected by refine validator; AiChat apply disabled without lastResult and only emits apply on explicit click`,
    { type: 'api+static', note: 'Playwright deferred; canvas preservation inferred from no auto-apply + 422/validate fail path' },
  )

  console.log('ACCEPTANCE_CASES_PASSED')
}

main().catch((err) => {
  console.error('ACCEPTANCE_CASES_FAILED', err)
  process.exit(1)
})
