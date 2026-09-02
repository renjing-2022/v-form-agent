import { expect, test, type Page, type TestInfo } from '@playwright/test'

const generatePath = '/api/agent/v1/generate'
const refinePath = '/api/agent/v1/refine'

async function openAiPanel(page: Page) {
  await page.goto('/')
  await expect(page.locator('#formWidgetCanvas')).toBeVisible()
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  await expect(page.locator('.ai-agent-panel')).toBeVisible()
}

async function selectGenerateMode(page: Page) {
  await page.locator('.ai-agent-panel .mode-row').getByText('整表生成', { exact: true }).click()
}

async function selectRefineMode(page: Page) {
  await page.locator('.ai-agent-panel .mode-row').getByText('优化当前表', { exact: true }).click()
}

async function generateText(page: Page) {
  await selectGenerateMode(page)
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === generatePath &&
      response.request().method() === 'POST',
  )
  await page
    .getByPlaceholder(/生成老年人认知评估表/)
    .fill('生成老年人认知评估表，包含时间定向和人物定向')
  await page.getByRole('button', { name: '生成表单', exact: true }).click()
  return responsePromise
}

async function applyToDesigner(page: Page) {
  await expect(page.locator('.ai-agent-panel .el-alert--success')).toBeVisible()
  await expect(page.locator('.ai-agent-panel .preview')).toContainText(/共 \d+ 个控件/)
  await page.getByRole('button', { name: /应用到设计器/ }).click()
  await expect(
    page
      .locator('.el-message__content')
      .filter({ hasText: '已整表覆盖应用到设计器' })
      .last(),
  ).toBeVisible()
}

async function refineCurrent(page: Page, instruction: string) {
  await selectRefineMode(page)
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === refinePath &&
      response.request().method() === 'POST',
  )
  await page.locator('.ai-agent-panel textarea').fill(instruction)
  await page.getByRole('button', { name: '优化当前表', exact: true }).click()
  return responsePromise
}

async function attachEvidence(
  page: Page,
  testInfo: TestInfo,
  observed: string,
) {
  await testInfo.attach('observed', {
    body: Buffer.from(observed, 'utf8'),
    contentType: 'text/plain',
  })
  await testInfo.attach('deliveryguard-screenshot', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
}

test(
  'Catalog 驱动常见属性：placeholder 写回并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-common-properties',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(
      page,
      '把姓名字段的 placeholder 改成请输入姓名',
    )
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const nameField = (body.formJson.widgetList as Array<{ options?: { label?: string; placeholder?: string } }>).find(
      (w) => w.options?.label === '姓名',
    )
    expect(nameField?.options?.placeholder).toBe('请输入姓名')

    await applyToDesigner(page)
    await expect(page.getByRole('textbox', { name: '* 姓名' })).toHaveAttribute(
      'placeholder',
      '请输入姓名',
    )

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} returned 200; placeholder 请输入姓名 visible on canvas after apply`,
    )
  },
)

test(
  '精准定位：按标签命中时间定向并设为必填',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-precise-targeting',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(page, '把时间定向字段设为必填')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const widgets = body.formJson.widgetList as Array<{
      options?: { label?: string; required?: boolean }
    }>
    const timeField = widgets.find((w) => w.options?.label === '时间定向')
    expect(timeField?.options?.required).toBe(true)

    await applyToDesigner(page)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')
    await expect(page.locator('#formWidgetCanvas .is-required')).not.toHaveCount(0)

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} returned 200; 时间定向 required=true in response and required marker visible after apply`,
    )
  },
)

test(
  '受控 cssCode：布局样式修复且文案不变',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-csscode-apply',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(
      page,
      '用 cssCode 修复单选与左侧字段重叠，增加间距',
    )
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    expect(String(body.formJson.formConfig?.cssCode || '')).toMatch(/margin-top|display/)
    expect(JSON.stringify(body.formJson)).toContain('时间定向')

    await applyToDesigner(page)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')
    await expect(page.locator('#formWidgetCanvas')).not.toContainText('短标题')

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} returned 200; cssCode appended; 时间定向 copy unchanged after apply`,
    )
  },
)

test(
  '危险 CSS 被护栏拦截且画布保持不变',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-csscode-reject',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    const baselineCount = await widgets.count()
    expect(baselineCount).toBeGreaterThan(0)

    const refineResponse = await refineCurrent(page, 'E2E危险CSS测试')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    expect(String(body.formJson.formConfig?.cssCode || '')).not.toContain('@import')
    expect(
      (body.warnings || []).some((w: string) => /护栏|危险|css/i.test(w)),
    ).toBe(true)

    await applyToDesigner(page)
    await expect(widgets).toHaveCount(baselineCount)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')

    await attachEvidence(
      page,
      testInfo,
      `Dangerous css refine returned 200 with guard warnings; @import absent; canvas kept ${baselineCount} widgets`,
    )
  },
)

test(
  'v0.2 主路径回归：生成并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-p1-regression',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    const response = await generateText(page)
    expect(response.status()).toBe(200)
    await applyToDesigner(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    await expect(widgets).not.toHaveCount(0)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')

    await attachEvidence(
      page,
      testInfo,
      `v0.3.0 regression: generate 200 and ${await widgets.count()} widgets with 时间定向 after apply`,
    )
  },
)
