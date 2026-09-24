/**
 * 用真实 Key 录制题库 interaction fixture（人工审阅后提交）。
 * 用法：DEEPSEEK_API_KEY=xxx npm run interaction:record
 * 证据不含 Key。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import { generateInteraction } from '../src/services/interactionGenerator.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(root, 'agent', 'fixtures', 'interaction', 'replay')

const BANK: Array<{
  scenarioId: string
  fixture: 'F-wizard' | 'F-order' | 'F-detail'
  instruction: string
  instructionIncludes: string[]
}> = [
  {
    scenarioId: 'nl-wizard-next',
    fixture: 'F-wizard',
    instruction: '在每个 tab 下新增一个「下一页」按钮，点击时校验当前 tab 的字段，通过则跳到下一个 tab，失败则定位到第一个出错的字段',
    instructionIncludes: ['每个 tab 下新增一个「下一页」按钮'],
  },
  {
    scenarioId: 'nl-amount-calc',
    fixture: 'F-order',
    instruction: '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
    instructionIncludes: ['金额等于数量乘以单价'],
  },
  {
    scenarioId: 'nl-other-required',
    fixture: 'F-order',
    instruction: '类型选「其他」时显示其他说明并设为必填，否则隐藏且不必填',
    instructionIncludes: ['选「其他」时显示其他说明'],
  },
  {
    scenarioId: 'nl-date-range-validate',
    fixture: 'F-order',
    instruction: '提交前检查结束日期不能早于开始日期',
    instructionIncludes: ['结束日期不能早于开始日期'],
  },
  {
    scenarioId: 'nl-subform-row-calc',
    fixture: 'F-detail',
    instruction: '明细里小计等于单价乘数量，合计等于所有小计之和',
    instructionIncludes: ['小计等于单价乘数量'],
  },
  {
    scenarioId: 'nl-neg-api',
    fixture: 'F-order',
    instruction: '手机号填完后调用接口查询客户信息并回填',
    instructionIncludes: ['调用接口查询客户信息'],
  },
]

async function main() {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    console.error('DEEPSEEK_API_KEY required (no mock for record)')
    process.exit(1)
  }
  delete process.env.AGENT_ALLOW_MOCK
  fs.mkdirSync(outDir, { recursive: true })

  const results: Array<{ id: string; status: string; ok: boolean }> = []
  for (const row of BANK) {
    const form = loadInteractionFixture(row.fixture)
    console.log(`[record] ${row.scenarioId}…`)
    try {
      const gen = await generateInteraction({
        instruction: row.instruction,
        currentFormJson: form,
      })
      const file = path.join(outDir, `${row.scenarioId}.json`)
      fs.writeFileSync(
        file,
        `${JSON.stringify(
          {
            match: {
              scenarioId: row.scenarioId,
              instructionIncludes: row.instructionIncludes,
            },
            output: gen.output,
            meta: {
              status: gen.status,
              rewriteCount: gen.rewriteCount,
              recordedAt: new Date().toISOString(),
              // no key / no raw headers
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      results.push({ id: row.scenarioId, status: gen.status, ok: gen.status !== 'error' })
      console.log(`  → ${gen.status} wrote ${path.relative(root, file)}`)
    } catch (err) {
      console.error(`  → FAIL`, err)
      results.push({ id: row.scenarioId, status: 'error', ok: false })
    }
  }

  console.log(JSON.stringify({ recorded: results }, null, 2))
  if (results.some((r) => !r.ok)) process.exit(1)
  console.log('INTERACTION_RECORD_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
