import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

process.env.EVIDENCE_VERSION = 'v0.12.0'

const interactionPath = '/api/agent/v1/interaction'
const root = path.resolve(__dirname, '../..')

function loadForm(rel: string) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
}

async function seedDesigner(page: Page, formJson: { widgetList: unknown[]; formConfig: Record<string, unknown> }) {
  await page.goto('/')
  await expect(page.locator('#formWidgetCanvas')).toBeVisible()
  const loaded = await page.evaluate((fj) => {
    const appEl = document.querySelector('#app') as HTMLElement & {
      __vue_app__?: { _instance?: { proxy?: { $refs?: { vfdRef?: { setFormJson?: (j: unknown) => void } } } } }
    }
    const designer = appEl?.__vue_app__?._instance?.proxy?.$refs?.vfdRef
    if (!designer || typeof designer.setFormJson !== 'function') return false
    designer.setFormJson(fj)
    return true
  }, formJson)
  expect(loaded).toBeTruthy()
  await page.waitForTimeout(300)
}

async function openAiPanel(page: Page) {
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  await expect(page.locator('.ai-agent-panel')).toBeVisible()
}

async function clickSubmit(page: Page) {
  const panel = page.locator('.ai-agent-panel')
  const send = panel.getByRole('button', { name: '发送', exact: true })
  if (await send.isVisible().catch(() => false)) {
    await send.click()
    return
  }
  await panel.getByRole('button', { name: '优化当前表', exact: true }).click()
}

async function attachEvidence(page: Page, testInfo: TestInfo, observed: string) {
  await testInfo.attach('observed', {
    body: Buffer.from(observed, 'utf8'),
    contentType: 'text/plain',
  })
  await testInfo.attach('deliveryguard-screenshot', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
}

async function canvasSnapshot(page: Page) {
  return page.evaluate(() => {
    const designer = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef
    return JSON.stringify(designer.getFormJson())
  })
}

test.describe('v0.12 composite/upload/extension E2E', () => {
  test(
    'grid + number/input + 金额 handler 单事务 → applied',
    {
      annotation: { type: 'case-id', description: 'txn-composite-handler-e2e' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const order = loadForm('agent/fixtures/interaction/forms/F-order.json')
      await seedDesigner(page, order)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('加一个grid，第一列放number数量、第二列放input单价，金额=数量*单价')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      expect(genBody.status).toBe('generated')
      expect(genBody.formJsonCandidate).toBeTruthy()
      const cand = JSON.stringify(genBody.formJsonCandidate)
      expect(cand).toContain('calc_grid')
      expect(cand).toContain('"g_qty"')
      expect(cand).toContain('"g_price"')
      expect((genBody.output?.handlers || []).length).toBeGreaterThan(0)

      // 候选未写入画布
      expect(await canvasSnapshot(page)).toBe(before)

      await expect(page.getByRole('button', { name: '在预览中验证' })).toBeEnabled()
      await page.getByRole('button', { name: '在预览中验证' }).click()
      await expect
        .poll(async () => page.getByRole('button', { name: /确认写入画布/ }).isEnabled(), {
          timeout: 30_000,
        })
        .toBe(true)

      const applyPromise = page.waitForResponse((r) => {
        if (new URL(r.url()).pathname !== interactionPath || r.request().method() !== 'POST') return false
        try {
          return r.request().postDataJSON()?.action === 'apply'
        } catch {
          return false
        }
      })
      await page.getByRole('button', { name: /确认写入画布/ }).click()
      const applied = await (await applyPromise).json()
      expect(applied.status).toBe('applied')
      expect(applied.applied).toBe(true)

      const after = await canvasSnapshot(page)
      expect(after).not.toBe(before)
      expect(after).toContain('calc_grid')
      await attachEvidence(
        page,
        testInfo,
        `grid+number+input+金额 handler 单事务 generated→verify→applied; handlers=${genBody.output.handlers.length}`,
      )
    },
  )

  test(
    'card+alert+slot runtime extension 单事务 → applied',
    {
      annotation: { type: 'case-id', description: 'runtime-extension-e2e' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const detail = loadForm('agent/fixtures/interaction/forms/F-detail.json')
      await seedDesigner(page, detail)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('顶部加一个alert提示，中间加一个card卡片，底部加一个slot插槽')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      expect(genBody.status).toBe('generated')
      expect(genBody.formJsonCandidate).toBeTruthy()
      const cand = JSON.stringify(genBody.formJsonCandidate)
      expect(cand).toContain('"card"')
      expect(cand).toContain('"alert"')
      expect(cand).toContain('"slot"')

      // 候选未写入画布（Ask-before-act）
      expect(await canvasSnapshot(page)).toBe(before)

      await expect(page.getByRole('button', { name: '在预览中验证' })).toBeEnabled()
      await page.getByRole('button', { name: '在预览中验证' }).click()
      await expect
        .poll(async () => page.getByRole('button', { name: /确认写入画布/ }).isEnabled(), {
          timeout: 30_000,
        })
        .toBe(true)

      const applyPromise = page.waitForResponse((r) => {
        if (new URL(r.url()).pathname !== interactionPath || r.request().method() !== 'POST') return false
        try {
          return r.request().postDataJSON()?.action === 'apply'
        } catch {
          return false
        }
      })
      await page.getByRole('button', { name: /确认写入画布/ }).click()
      const applied = await (await applyPromise).json()
      expect(applied.status).toBe('applied')
      expect(applied.applied).toBe(true)

      const after = await canvasSnapshot(page)
      expect(after).not.toBe(before)
      expect(after).toContain('"card"')
      expect(after).toContain('"alert"')
      expect(after).toContain('"slot"')
      await attachEvidence(
        page,
        testInfo,
        'card+alert+slot manifest 扩展单事务 generated→verify→applied；canvas 写入前保持不变',
      )
    },
  )

  test(
    '无 manifest 的 runtime type 诚实拒绝，画布不变',
    {
      annotation: { type: 'case-id', description: 'ext-missing-manifest-e2e' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const detail = loadForm('agent/fixtures/interaction/forms/F-detail.json')
      await seedDesigner(page, detail)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('加一个chart-foo图表组件')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      // mock 管线无 fixture → error / need_clarification；绝不能 applied
      expect(['error', 'need_clarification', 'unsupported']).toContain(genBody.status)
      expect(genBody.applied ?? false).toBe(false)

      // 画布不变
      expect(await canvasSnapshot(page)).toBe(before)
      await attachEvidence(
        page,
        testInfo,
        `无 manifest runtime type 拒绝：status=${genBody.status}; canvas unchanged`,
      )
    },
  )
})
