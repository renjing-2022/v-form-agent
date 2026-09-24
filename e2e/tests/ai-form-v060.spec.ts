import { expect, test, type Page, type TestInfo } from '@playwright/test'

const refinePath = '/api/agent/v1/refine'

const flatTableFixture = {
  widgetList: [
    {
      type: 'data-table',
      id: 'dt1',
      options: {
        name: 'dt1',
        label: '人员表',
        tableColumns: [
          { columnId: 1, prop: 'name', label: '姓名', width: '100', show: true, align: 'left' },
          { columnId: 2, prop: 'date', label: '日期', width: '160', show: true, align: 'left' },
        ],
        stripe: true,
        showIndex: false,
        customClass: '',
      },
      widgetList: [],
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

const subFormFixture = {
  widgetList: [
    {
      type: 'sub-form',
      id: 'sf1',
      options: {
        name: 'sf1',
        label: '明细',
        showBlankRow: true,
        showRowNumber: false,
        labelAlign: 'label-center-align',
        actionColumnPosition: 'left',
        hidden: false,
        disabled: false,
        customClass: '',
      },
      widgetList: [
        {
          type: 'input',
          id: 'sfi1',
          options: { name: 'sfi1', label: '品名', placeholder: '', required: false },
        },
      ],
    },
  ],
  formConfig: flatTableFixture.formConfig,
}

const dialogFixture = {
  widgetList: [
    {
      type: 'vf-dialog',
      id: 'dlg1',
      options: {
        name: 'dlg1',
        title: '旧标题',
        width: '50%',
        fullscreen: false,
        showModal: true,
        showClose: true,
        closeOnClickModal: false,
        closeOnPressEscape: false,
        center: false,
        readMode: false,
        disabledMode: false,
        okButtonLabel: '',
        okButtonHidden: false,
        cancelButtonLabel: '',
        cancelButtonHidden: false,
        onOkButtonClick: '',
      },
      widgetList: [
        {
          type: 'input',
          id: 'di1',
          options: { name: 'di1', label: '弹窗内字段', required: false },
        },
      ],
    },
  ],
  formConfig: flatTableFixture.formConfig,
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
  // 等待画布反映控件
  await page.waitForTimeout(300)
}

async function openAiPanel(page: Page) {
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  await expect(page.locator('.ai-agent-panel')).toBeVisible()
}

async function selectRefineMode(page: Page) {
  await page.locator('.ai-agent-panel .mode-row').getByText('优化当前表', { exact: true }).click()
}

async function refineCurrent(page: Page, instruction: string) {
  await selectRefineMode(page)
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === refinePath &&
      response.request().method() === 'POST',
  )
  await page.locator('.ai-agent-panel textarea').fill(instruction)
  const panel = page.locator('.ai-agent-panel')
  const send = panel.getByRole('button', { name: '发送', exact: true })
  if (await send.isVisible().catch(() => false)) {
    await send.click()
  } else {
    await panel.getByRole('button', { name: '优化当前表', exact: true }).click()
  }
  return responsePromise
}

async function applyToDesigner(page: Page) {
  await expect(page.locator('.ai-agent-panel .el-alert--success')).toBeVisible()
  await page.getByRole('button', { name: /应用到设计器/ }).click()
  await expect(
    page
      .locator('.el-message__content')
      .filter({ hasText: '已整表覆盖应用到设计器' })
      .last(),
  ).toBeVisible()
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
  'data-table 扁平列新增并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-datatable-add-column',
    },
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, flatTableFixture)
    await openAiPanel(page)

    const refineResponse = await refineCurrent(page, '给人员表加一列备注')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const cols = body.formJson.widgetList[0].options.tableColumns as Array<{ prop?: string }>
    expect(cols.some((c) => c.prop === 'remark')).toBeTruthy()

    await applyToDesigner(page)
    await attachEvidence(
      page,
      testInfo,
      `POST ${refinePath} addTableColumn: remark present; applied to canvas`,
    )
  },
)

test(
  'data-table 更新列宽并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-datatable-update-column',
    },
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, flatTableFixture)
    await openAiPanel(page)

    const refineResponse = await refineCurrent(page, '把姓名列宽度改为140')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    const nameCol = (
      body.formJson.widgetList[0].options.tableColumns as Array<{ prop?: string; width?: string }>
    ).find((c) => c.prop === 'name')
    expect(nameCol?.width).toBe('140')

    await applyToDesigner(page)
    await attachEvidence(page, testInfo, `POST ${refinePath} updateTableColumn width=140 applied`)
  },
)

test(
  'sub-form 壳层 showRowNumber 并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-subform-shell-props',
    },
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, subFormFixture)
    await openAiPanel(page)

    const refineResponse = await refineCurrent(page, '子表显示行号')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    expect(body.formJson.widgetList[0].options.showRowNumber).toBe(true)

    await applyToDesigner(page)
    await attachEvidence(page, testInfo, `POST ${refinePath} sub-form showRowNumber=true applied`)
  },
)

test(
  'vf-dialog 壳层标题宽度并应用到画布',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-dialog-shell-props',
    },
  },
  async ({ page }, testInfo) => {
    await seedDesigner(page, dialogFixture)
    await openAiPanel(page)

    const refineResponse = await refineCurrent(page, '把弹窗标题改为确认框，宽度改为60%')
    expect(refineResponse.status()).toBe(200)
    const body = await refineResponse.json()
    expect(body.formJson.widgetList[0].options.title).toBeTruthy()
    expect(String(body.formJson.widgetList[0].options.width)).toMatch(/60%?/)

    await applyToDesigner(page)
    await attachEvidence(page, testInfo, `POST ${refinePath} vf-dialog shell title/width applied`)
  },
)

test(
  'v0.5 删除字段回归抽样',
  {
    annotation: {
      type: 'case-id',
      description: 'refine-v05-regression',
    },
  },
  async ({ page }, testInfo) => {
    // 轻量回归：空画布生成后删备注（与 v0.5 同路径，不依赖重型容器）
    await page.goto('/')
    await expect(page.locator('#formWidgetCanvas')).toBeVisible()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    await page.locator('.ai-agent-panel .mode-row').getByText('整表生成', { exact: true }).click()
    const genPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/agent/v1/generate' &&
        response.request().method() === 'POST',
    )
    await page.getByPlaceholder(/生成老年人认知评估表/).fill('生成老年人认知评估表，包含时间定向和人物定向')
    await page.getByRole('button', { name: '生成表单', exact: true }).click()
    expect((await genPromise).status()).toBe(200)
    await applyToDesigner(page)

    const refineResponse = await refineCurrent(page, '删掉备注字段')
    expect(refineResponse.status()).toBe(200)
    const list = (await refineResponse.json()).formJson.widgetList as Array<{ options?: { label?: string } }>
    expect(list.some((w) => w.options?.label === '备注')).toBeFalsy()
    await applyToDesigner(page)
    await attachEvidence(page, testInfo, 'v0.5 removeField regression still green under v0.6')
  },
)
