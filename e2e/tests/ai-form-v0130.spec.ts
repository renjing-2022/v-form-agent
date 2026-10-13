import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

process.env.EVIDENCE_VERSION = 'v0.13.0'

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
  await page.waitForTimeout(500)
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

test.describe('v0.13 autonomy large-form E2E', () => {
  test(
    '大表(>120节点/深度>8)目标歧义 → need_clarification，画布不变',
    {
      annotation: { type: 'case-id', description: 'large-form-ambiguity-e2e' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      const large = loadForm('agent/fixtures/interaction/forms/F-large.json')
      expect(large.widgetList.length).toBeGreaterThan(100)
      await seedDesigner(page, large)
      const before = await canvasSnapshot(page)
      expect(before).toContain('deepLeaf')
      expect(before).toContain('remark_a')
      expect(before).toContain('remark_b')
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('把备注改成必填并联动')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      expect(genBody.status).toBe('need_clarification')
      expect(genBody.applied ?? false).toBe(false)
      const binds =
        genBody.clarification?.questions?.[0]?.binds?.slot ||
        genBody.clarification?.questions?.find((q: { binds?: { slot?: string } }) => q.binds?.slot)
          ?.binds?.slot
      expect(binds === 'target.widget' || JSON.stringify(genBody).includes('target.widget')).toBeTruthy()
      expect(await canvasSnapshot(page)).toBe(before)

      await attachEvidence(
        page,
        testInfo,
        `F-large seeded (widgetList=${large.widgetList.length}); status=need_clarification; canvas unchanged; target.widget bind present`,
      )
    },
  )
})
