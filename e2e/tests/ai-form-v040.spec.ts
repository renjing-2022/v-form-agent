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

test(
  'NL 右对齐写入 label-right-align 并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-labelalign-nl-parity',
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
    await expect(page.locator('#formWidgetCanvas .label-right-align').first()).toBeVisible()

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} returned 200; ${radios.length} radio(s) labelAlign=label-right-align; canvas shows label-right-align`,
    )
  },
)

test(
  '重叠诉求写入 labelWrap 与 displayStyle:block',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-layout-overlap-properties',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(
      page,
      '单选字段标签和选项重叠了，优化排版，不要改题目文字',
    )
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    expect(body.applied).toBeTruthy()

    const radios = (body.formJson.widgetList as Array<{
      type?: string
      options?: {
        labelWrap?: boolean
        displayStyle?: string
        label?: string
      }
    }>).filter((w) => w.type === 'radio')

    expect(radios.length).toBeGreaterThan(0)
    const fixed = radios.filter(
      (r) => r.options?.labelWrap === true && r.options?.displayStyle === 'block',
    )
    expect(fixed.length).toBeGreaterThan(0)

    await applyToDesigner(page)
    await expect(page.locator('#formWidgetCanvas .label-wrap').first()).toBeVisible()

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} overlap fix: ${fixed.length}/${radios.length} radios labelWrap+block; canvas shows label-wrap`,
    )
  },
)
