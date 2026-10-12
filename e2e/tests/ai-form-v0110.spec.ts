import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

process.env.EVIDENCE_VERSION = 'v0.11.0'

const interactionPath = '/api/agent/v1/interaction'
const root = path.resolve(__dirname, '../..')

function loadWizard() {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'agent/fixtures/interaction/forms/F-wizard.json'), 'utf8'),
  )
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

test.describe('v0.11 Catalog createWidget E2E', () => {
  test(
    '文本框别名歧义 → 选 input → generated candidate（画布未写）',
    {
      annotation: { type: 'case-id', description: 'cat-alias-ambiguous-clarify-e2e' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      await seedDesigner(page, {
        widgetList: [
          {
            type: 'input',
            id: 'remark_seed',
            options: { name: 'remark_seed', label: '备注种子' },
          },
        ],
        formConfig: {
          modelName: 'formData',
          refName: 'vForm',
          rulesName: 'rules',
          labelWidth: 80,
          labelPosition: 'left',
          size: '',
          labelAlign: 'label-left-align',
          cssCode: '',
          customClass: [],
          functions: '',
          layoutType: 'PC',
          onFormCreated: '',
          onFormMounted: '',
          onFormDataChange: '',
          onFormValidate: '',
        },
      })
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      // 带联动意图，确保走 interaction 管线；「文本框」触发 create.type 歧义门禁
      await page.locator('.ai-agent-panel textarea').fill('表单末尾加一个文本框，变化时本地校验')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      expect(genBody.status).toBe('need_clarification')
      expect(genBody.clarification?.protocol).toBe('structured-clarify-v1')
      expect(genBody.pendingPlan?.id).toBeTruthy()

      await expect(page.locator('.clarify-panel')).toBeVisible()
      const inputOpt = page.locator('.clarify-q').first().locator('.el-radio').filter({ hasText: /input|单行/ })
      await expect(inputOpt.first()).toBeVisible()
      await inputOpt.first().click()

      const clarifyPromise = page.waitForResponse((r) => {
        if (new URL(r.url()).pathname !== interactionPath || r.request().method() !== 'POST') return false
        try {
          return r.request().postDataJSON()?.action === 'clarify'
        } catch {
          return false
        }
      })
      await page.getByRole('button', { name: '继续生成' }).click()
      const clarified = await (await clarifyPromise).json()
      expect(clarified.status).toBe('generated')
      expect(clarified.formJsonCandidate).toBeTruthy()
      expect(JSON.stringify(clarified.output?.structure || [])).toContain('"type":"input"')
      expect(JSON.stringify(clarified.formJsonCandidate)).toContain('"type":"input"')

      // 澄清后画布仍未写入（Ask-before-act）；原子写入由 tab-sum / agent 用例覆盖
      const after = await canvasSnapshot(page)
      expect(after).toBe(before)

      await attachEvidence(
        page,
        testInfo,
        `文本框歧义→create.type input→generated candidate; canvas unchanged until apply; plan=${genBody.pendingPlan.id}`,
      )
    },
  )

  test(
    '每个 tab 末尾加 number + radio 并实时汇总 → applied',
    {
      annotation: { type: 'case-id', description: 'cat-tab-number-sum-e2e' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const wizard = loadWizard()
      await seedDesigner(page, wizard)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page
        .locator('.ai-agent-panel textarea')
        .fill('每个tab末尾加number并实时汇总，再加一个radio选汇总方式')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      expect(genBody.status).toBe('generated')
      expect(genBody.formJsonCandidate).toBeTruthy()
      expect(genBody.output?.handlers?.length).toBeGreaterThan(0)
      const cand = JSON.stringify(genBody.formJsonCandidate)
      expect(cand).toContain('tab_score_1')
      expect(cand).toContain('tab_score_total')
      expect(cand).toContain('sum_mode')

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
      expect(after).toContain('tab_score_total')
      expect(after).toContain('sum_mode')

      await attachEvidence(
        page,
        testInfo,
        `tab number+radio+sum handlers generated→verify→applied; handlers=${genBody.output.handlers.length}`,
      )
    },
  )
})
