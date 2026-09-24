/**
 * 真实 Key 冒烟：跑题库子集，写出通过率证据（不含 Key）。
 * 无 Key 时诚实失败退出码 2（不假装通过）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import { generateInteraction } from '../src/services/interactionGenerator.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(root, 'docs', 'evidence', 'v0.9.0')

const SMOKE = [
  {
    id: 'nl-wizard-next',
    fixture: 'F-wizard' as const,
    instruction:
      '在每个 tab 下新增一个「下一页」按钮，点击时校验当前 tab 的字段，通过则跳到下一个 tab，失败则定位到第一个出错的字段',
  },
  {
    id: 'nl-amount-calc',
    fixture: 'F-order' as const,
    instruction: '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
  },
  {
    id: 'nl-other-required',
    fixture: 'F-order' as const,
    instruction: '类型选「其他」时显示其他说明并设为必填，否则隐藏且不必填',
  },
  {
    id: 'nl-date-range-validate',
    fixture: 'F-order' as const,
    instruction: '提交前检查结束日期不能早于开始日期',
  },
  {
    id: 'nl-subform-row-calc',
    fixture: 'F-detail' as const,
    instruction: '明细里小计等于单价乘数量，合计等于所有小计之和',
  },
  {
    id: 'nl-neg-api',
    fixture: 'F-order' as const,
    instruction: '手机号填完后调用接口查询客户信息并回填',
  },
]

async function main() {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) {
    console.error('DEEPSEEK_API_KEY missing — smoke requires real model (no mock)')
    process.exit(2)
  }
  delete process.env.AGENT_ALLOW_MOCK
  fs.mkdirSync(outDir, { recursive: true })

  const branch = (() => {
    try {
      return execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  })()
  const revision = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  })()

  const rows: Array<{ id: string; status: string; ok: boolean }> = []
  for (const row of SMOKE) {
    const form = loadInteractionFixture(row.fixture)
    try {
      const gen = await generateInteraction({
        instruction: row.instruction,
        currentFormJson: form,
      })
      const expectOk = row.id.startsWith('nl-neg')
        ? gen.status === 'unsupported' || gen.output.intent === 'unsupported'
        : gen.status === 'generated'
      const ok = expectOk && gen.status !== 'error'
      rows.push({ id: row.id, status: gen.status, ok })
      console.log(`[smoke] ${row.id} → ${gen.status} ok=${ok}`)
    } catch (err) {
      rows.push({ id: row.id, status: 'error', ok: false })
      console.error(`[smoke] ${row.id} FAIL`, err instanceof Error ? err.message : err)
    }
  }

  const passed = rows.filter((r) => r.ok).length
  const rate = `${passed}/${rows.length}`
  const body = [
    'case: interaction-llm-smoke',
    `status: ${passed >= Math.ceil(rows.length * 0.5) ? 'pass' : 'fail'}`,
    `observed: smoke_pass_rate=${rate}`,
    `details: ${rows.map((r) => `${r.id}:${r.status}:${r.ok ? 'pass' : 'fail'}`).join('; ')}`,
    'environment: local Node; real DeepSeek; AGENT_ALLOW_MOCK unset; evidence contains no API key',
    `sourceRevision: ${branch}@${revision}`,
    `capturedAt: ${new Date().toISOString()}`,
    'note: evidence contains no API key or request headers',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(outDir, 'interaction-llm-smoke.txt'), body, 'utf8')
  console.log(`SMOKE_RATE ${rate}`)
  if (passed < Math.ceil(rows.length * 0.5)) process.exit(1)
  console.log('INTERACTION_SMOKE_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
