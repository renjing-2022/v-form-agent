import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'

const generatePath = '/api/agent/v1/generate'
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

async function generateText(page: Page) {
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

async function applyGeneratedForm(page: Page) {
  await expect(page.locator('.ai-agent-panel .el-alert--success')).toBeVisible()
  await expect(page.locator('.ai-agent-panel .preview')).toContainText(/共 \d+ 个控件/)
  await page.getByRole('button', { name: '应用到设计器', exact: true }).click()
  await expect(page.getByText('已应用到设计器，可继续拖拽微调')).toBeVisible()
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
      description: 'ui-canvas-apply-e2e',
    },
  },
  async ({ page }, testInfo) => {
    await openAiPanel(page)
    await expect(page.locator('#formWidgetCanvas .transition-group-el')).toHaveCount(0)

    const response = await generateText(page)
    expect(response.status()).toBe(200)
    expect(new URL(response.url()).origin).toBe('http://127.0.0.1:3130')
    expect(new URL(response.url()).pathname).toBe(generatePath)

    await applyGeneratedForm(page)
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

    await applyGeneratedForm(page)
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
    await applyGeneratedForm(page)
    const widgets = page.locator('#formWidgetCanvas .transition-group-el')
    const baselineCount = await widgets.count()
    expect(baselineCount).toBeGreaterThan(0)

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
    await expect(
      page.getByRole('button', { name: '应用到设计器', exact: true }),
    ).toBeDisabled()

    await attachEvidence(
      page,
      testInfo,
      `Empty workbook returned 400 with a visible error; canvas retained ${baselineCount} top-level widgets and apply remained disabled`,
    )
  },
)
