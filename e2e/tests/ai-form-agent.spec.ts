import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'

const generatePath = '/api/agent/v1/generate'
const refinePath = '/api/agent/v1/refine'
const requireFromAgent = createRequire(
  path.resolve(__dirname, '../../agent/package.json'),
)
const XLSX = requireFromAgent('xlsx')

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

function assessmentWorkbook() {
  const rows = [
    ['老年人认知能力专项评估 (1-5级)', '', ''],
    ['认知评估: 16分', '', ''],
    [
      '1. 时间定向',
      '2',
      '4分：无时间观念\n3分：时间观念很差\n2分：时间观念较差\n1分：时间观念稍差\n0分：时间观念清楚',
    ],
    ['2. 人物定向', '1', '4分：不认识亲人\n0分：认识周围所有人'],
    ['小计', '', ''],
    ['感知觉与沟通: 16分', '', ''],
    ['1. 视力', '0', '2分：完全失明\n0分：视力正常'],
  ]
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
  XLSX.utils.book_append_sheet(workbook, worksheet, '评估')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test(
  '自然语言生成通过本地代理并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'text-generate-apply',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    await expect(page.locator('#formWidgetCanvas .transition-group-el')).toHaveCount(0)

    const response = await generateText(page)
    expect(response.status()).toBe(200)
    expect(new URL(response.url()).origin).toBe('http://127.0.0.1:3130')
    expect(new URL(response.url()).pathname).toBe(generatePath)

    await applyToDesigner(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    await expect(widgets).not.toHaveCount(0)
    await expect(page.locator('#formWidgetCanvas .el-radio')).not.toHaveCount(0)

    await attachEvidence(
      page,
      testInfo,
      `POST ${generatePath} returned 200 through the Vite proxy; ${await widgets.count()} top-level widgets were visible after explicit apply`,
    )
  },
)

test(
  'Excel 评估量表生成分区和评分单选题并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'ui-excel-canvas-apply-e2e',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    await selectGenerateMode(page)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'assessment-sample.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: assessmentWorkbook(),
    })

    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === generatePath &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '生成表单', exact: true }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)

    await applyToDesigner(page)
    const radioOptions = page.locator('#formWidgetCanvas .el-radio')
    await expect(radioOptions).not.toHaveCount(0)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')
    await expect(page.locator('#formWidgetCanvas')).toContainText('4分：无时间观念')

    await attachEvidence(
      page,
      testInfo,
      `Synthetic assessment workbook returned 200; ${await radioOptions.count()} scoring radio options and the expected assessment labels were visible after apply`,
    )
  },
)

test(
  '空 Excel 显示错误且不破坏已存在画布',
  {
    annotation: {
      type: 'case-id',
      description: 'ui-invalid-upload-preserves-canvas',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    const baselineCount = await widgets.count()
    expect(baselineCount).toBeGreaterThan(0)

    await selectGenerateMode(page)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'empty.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.alloc(0),
    })
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === generatePath &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '生成表单', exact: true }).click()
    const response = await responsePromise

    expect(response.status()).toBe(400)
    await expect(page.locator('.ai-agent-panel .el-alert--error')).toContainText(
      '上传文件为空',
    )
    await expect(widgets).toHaveCount(baselineCount)

    await attachEvidence(
      page,
      testInfo,
      `Empty workbook returned 400 with a visible error; canvas retained ${baselineCount} top-level widgets`,
    )
  },
)

test(
  '已有表结构优化：增加 tab 并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-structure-tab',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(
      page,
      '给表单增加两个 tab：基本信息 / 评估题目',
    )
    expect(refineResponse.status()).toBe(200)
    expect(new URL(refineResponse.url()).pathname).toBe(refinePath)

    await applyToDesigner(page)
    await expect(page.locator('#formWidgetCanvas .tab-container')).toHaveCount(1)
    await expect(page.locator('#formWidgetCanvas')).toContainText(/基本信息|分组一/)
    await expect(page.locator('#formWidgetCanvas')).toContainText(/评估题目|分组二/)

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} returned 200; canvas shows one tab-container after explicit apply`,
    )
  },
)

test(
  '已有表多轮优化：tab 后再改选项与公式',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-multiturn-apply',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    expect(
      (
        await refineCurrent(page, '给表单增加两个 tab：基本信息 / 评估题目')
      ).status(),
    ).toBe(200)
    await applyToDesigner(page)
    await expect(page.locator('#formWidgetCanvas .tab-container')).toHaveCount(1)

    const round2 = await refineCurrent(page, '优化选项分值，并增加总分公式')
    expect(round2.status()).toBe(200)
    await applyToDesigner(page)

    await expect(page.locator('#formWidgetCanvas .tab-container')).toHaveCount(1)
    await expect(page.locator('.ai-agent-panel .messages .msg')).not.toHaveCount(0)

    await attachEvidence(
      page,
      testInfo,
      `Two refine rounds via ${refinePath} both returned 200 and were explicitly applied; session messages remained visible`,
    )
  },
)

test(
  '已有表优化选项与公式并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-options-formula',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(
      page,
      '优化选项分值，并增加总分公式',
    )
    expect(refineResponse.status()).toBe(200)
    await expect(page.locator('.ai-agent-panel .el-alert--success')).toBeVisible()
    await applyToDesigner(page)

    const canvas = page.locator('#formWidgetCanvas')
    await expect(canvas.locator('.el-radio')).not.toHaveCount(0)
    // mock may rewrite option labels and/or add 总分 number field
    const hasNewOptionCopy = await canvas.getByText('4分：很好').count()
    const hasTotal = await canvas.getByText('总分').count()
    expect(hasNewOptionCopy + hasTotal).toBeGreaterThan(0)

    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} returned 200; after apply, option rewrite and/or total formula field visible (optionHits=${hasNewOptionCopy}, totalHits=${hasTotal})`,
    )
  },
)

test(
  'refine 失败时显示错误且不改写已有画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-reject-keeps-canvas',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    const baselineCount = await widgets.count()
    expect(baselineCount).toBeGreaterThan(0)

    await page.route(`**${refinePath}`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '优化结果未通过校验',
          issues: [{ path: 'widgetList', message: 'forced e2e reject' }],
        }),
      })
    })

    await selectRefineMode(page)
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === refinePath &&
        response.request().method() === 'POST',
    )
    await page.locator('.ai-agent-panel textarea').fill('任意优化指令触发失败')
    await page.getByRole('button', { name: '优化当前表', exact: true }).click()
    const response = await responsePromise
    expect(response.status()).toBe(422)

    await expect(page.locator('.ai-agent-panel .el-alert--error')).toContainText(
      /优化结果未通过校验|forced e2e reject|优化失败/,
    )
    await expect(widgets).toHaveCount(baselineCount)

    await attachEvidence(
      page,
      testInfo,
      `Forced refine 422 kept canvas at ${baselineCount} top-level widgets with a visible error; no silent overwrite`,
    )
  },
)

test(
  '样式诉求拒绝改字冒充修复：422 且画布不变',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-text-style-policy',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    const baselineCount = await widgets.count()
    expect(baselineCount).toBeGreaterThan(0)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')

    const refineResponse = await refineCurrent(
      page,
      '单选控件和左侧字段重叠了，优化布局样式',
    )
    expect(refineResponse.status()).toBe(422)
    const body = await refineResponse.json()
    expect(body.message).toMatch(/样式|CSS|文案/)

    await expect(page.locator('.ai-agent-panel .el-alert--error')).toContainText(
      /样式|CSS|文案/,
    )
    await expect(widgets).toHaveCount(baselineCount)
    await expect(page.locator('#formWidgetCanvas')).toContainText('时间定向')
    await expect(page.locator('#formWidgetCanvas')).not.toContainText('短标题')

    await attachEvidence(
      page,
      testInfo,
      `Style-only refine returned 422 (${body.message}); canvas kept ${baselineCount} widgets and unchanged copy`,
    )
  },
)

test(
  '明确改标题时允许 refine 并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-explicit-text-apply',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    expect((await generateText(page)).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(
      page,
      '把第一个字段的标题改成评估项A',
    )
    expect(refineResponse.status()).toBe(200)
    await applyToDesigner(page)
    await expect(page.locator('#formWidgetCanvas')).toContainText('评估项A')

    await attachEvidence(
      page,
      testInfo,
      `Explicit rename refine returned 200; canvas shows 评估项A after apply`,
    )
  },
)
