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

type Widget = {
  type?: string
  id?: string
  options?: { label?: string; name?: string }
  tabs?: Widget[]
  widgetList?: Widget[]
}

test(
  '按 label 删除字段并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-remove-field-by-label',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(page, '删掉备注字段')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const list = body.formJson.widgetList as Widget[]
    expect(list.some((w) => w.options?.label === '备注')).toBeFalsy()

    await applyToDesigner(page)
    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} removeField: 备注 absent from formJson; applied to canvas`,
    )
  },
)

test(
  '删除 tab-pane 时子控件一并删除',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-remove-tabpane-cascade',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const tabRes = await refineCurrent(page, '用 tab 分成基本信息和评估题目')
    expect(tabRes.status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(page, '删除第二个 tab 页签')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const tab = (body.formJson.widgetList as Widget[]).find((w) => w.type === 'tab')
    expect(tab?.tabs?.length).toBe(1)

    await applyToDesigner(page)
    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} tab-pane cascade: remaining panes=${tab?.tabs?.length}; applied`,
    )
  },
)

test(
  '同级 reorder 调整字段顺序',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-reorder-sibling',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const beforeRes = await refineCurrent(page, '把姓名移到年龄下面')
    expect(beforeRes.status()).toBe(200)
    const body = await beforeRes.json()
    const labels = (body.formJson.widgetList as Widget[])
      .map((w) => w.options?.label || '')
      .filter(Boolean)
    const nameIdx = labels.findIndex((l) => l === '姓名')
    const ageIdx = labels.findIndex((l) => l === '年龄')
    expect(ageIdx).toBeGreaterThanOrEqual(0)
    expect(nameIdx).toBeGreaterThan(ageIdx)

    await applyToDesigner(page)
    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} reorderField applied; summary=${body.summary}`,
    )
  },
)

test(
  'duplicateField 复制控件生成新 id',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-duplicate-field',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const beforeCount = await page.locator('#formWidgetCanvas .field-wrapper, #formWidgetCanvas .form-widget-list > *').count().catch(() => 0)

    const refineResponse = await refineCurrent(page, '复制一份时间定向')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const list = body.formJson.widgetList as Widget[]
    const ids = list.map((w) => w.id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    expect(list.length).toBeGreaterThan(0)

    await applyToDesigner(page)
    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} duplicateField: widgets=${list.length}; uniqueIds=${ids.length}; canvasBeforeHint=${beforeCount}`,
    )
  },
)

test(
  'v0.4 labelAlign 回归仍可用',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-v04-regression',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(page, '把所有评分单选字段的标签右对齐')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const radios = (body.formJson.widgetList as Array<{ type?: string; options?: { labelAlign?: string } }>).filter(
      (w) => w.type === 'radio',
    )
    expect(radios.length).toBeGreaterThan(0)
    for (const radio of radios) {
      expect(radio.options?.labelAlign).toBe('label-right-align')
    }

    await applyToDesigner(page)
    await attachEvidence(
      page,
      testInfo,
      `v0.4 regression: ${radios.length} radio(s) labelAlign=label-right-align`,
    )
  },
)
