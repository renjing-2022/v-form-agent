import { expect, test, type Page, type TestInfo } from '@playwright/test'

const eventPath = '/api/agent/v1/event'
const refinePath = '/api/agent/v1/refine'

const formFixture = {
  widgetList: [
    {
      type: 'number',
      id: 'yw',
      options: { name: 'yw', label: '语文', required: false, defaultValue: 0 },
    },
    {
      type: 'number',
      id: 'zf',
      options: { name: 'zf', label: '总分', required: false, defaultValue: 0 },
    },
    {
      type: 'sub-form',
      id: 'sf1',
      options: {
        name: 'sf1',
        label: '明细',
        showBlankRow: true,
        showRowNumber: false,
        customClass: '',
      },
      widgetList: [
        {
          type: 'input',
          id: 'sfi1',
          options: { name: 'sfi1', label: '品名', required: false },
        },
      ],
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

async function selectRefineMode(page: Page) {
  await page.locator('.ai-agent-panel .mode-row').getByText('优化当前表', { exact: true }).click()
}

async function submitOptimize(page: Page, instruction: string) {
  await selectRefineMode(page)
  await page.locator('.ai-agent-panel textarea').fill(instruction)
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

test.skip(
  '交互意图不完备时走 /event 并展示澄清问题',
  {
    annotation: [
      { type: 'case-id', description: 'event-clarify-ui' },
      {
        type: 'skip-reason',
        description: 'v0.9 Breaking：AiChat 统一 /interaction，不再关键词分流到 /event；澄清由 interaction need_clarification 承接',
      },
    ],
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    await openAiPanel(page)

    const eventPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === eventPath && response.request().method() === 'POST',
    )
    await submitOptimize(page, '加点交互')
    const eventResponse = await eventPromise
    expect(eventResponse.status()).toBe(200)
    const body = await eventResponse.json()
    expect(body.status).toBe('need_clarification')
    expect(Array.isArray(body.questions) && body.questions.length > 0).toBeTruthy()
    expect(body.applied).toBe(false)

    await expect(page.locator('.ai-agent-panel .warnings-title')).toContainText('澄清问题')
    await expect(page.locator('.ai-agent-panel .warnings li').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /应用到设计器/ })).toBeDisabled()

    await attachEvidence(
      page,
      testInfo,
      `POST ${eventPath} need_clarification; questions visible; apply disabled; no event write`,
    )
  },
)

test.skip(
  '完备联动意图 → spec_ready 摘要可见且不启用写入',
  {
    annotation: [
      { type: 'case-id', description: 'event-clarify-complete-ui' },
      {
        type: 'skip-reason',
        description: 'v0.9 Breaking：旧 /event spec_ready UI 已移除；API event-clarify-* 仍由 acceptance:cases 覆盖',
      },
    ],
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    await openAiPanel(page)

    const eventPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === eventPath && response.request().method() === 'POST',
    )
    await submitOptimize(
      page,
      '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":6}',
    )
    const eventResponse = await eventPromise
    expect(eventResponse.status()).toBe(200)
    const body = await eventResponse.json()
    expect(body.status).toBe('spec_ready')
    expect(body.eventSpec?.trigger?.eventKey).toBe('onChange')
    expect(body.applied).toBe(false)
    expect(String(body.summary || '')).toMatch(/不写入事件/)

    await expect(page.locator('.ai-agent-panel .el-alert--info, .ai-agent-panel .el-alert--warning').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /应用到设计器/ })).toBeDisabled()

    await attachEvidence(
      page,
      testInfo,
      `POST ${eventPath} spec_ready onChange; apply disabled; summary denies event write`,
    )
  },
)

test(
  '结构优化仍走 /refine（分流不回归）',
  {
    annotation: {
      type: 'case-id',
      description: 'event-refine-route-still-works',
    },
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    await openAiPanel(page)

    const refinePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === refinePath && response.request().method() === 'POST',
    )
    await submitOptimize(page, '把标签宽度改成120')
    const refineResponse = await refinePromise
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    expect(body.formJson).toBeTruthy()

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} for property instruction via interaction route_refine; event path not required`,
    )
  },
)
