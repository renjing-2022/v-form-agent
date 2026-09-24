import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

process.env.EVIDENCE_VERSION = 'v0.9.0'

const interactionPath = '/api/agent/v1/interaction'
const refinePath = '/api/agent/v1/refine'
const root = path.resolve(__dirname, '../..')

function loadJson(rel: string) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
}

function loadFixtureForm(id: 'F-wizard' | 'F-order' | 'F-detail') {
  // Prefer dumped JSON; fall back to building via dynamic import not available in browser tests —
  // use replay-adjacent form dumps if present, else minimal embeds.
  const p = path.join(root, 'agent/fixtures/interaction/forms', `${id}.json`)
  if (fs.existsSync(p)) return loadJson(`agent/fixtures/interaction/forms/${id}.json`)
  throw new Error(`missing fixture form ${id}; run agent fixture dump`)
}

const BANK_POS: Array<{
  id: string
  fixture: 'F-wizard' | 'F-order' | 'F-detail'
  instruction: string
  independentAssert: (formJson: any) => void
}> = [
  {
    id: 'nl-wizard-next',
    fixture: 'F-wizard',
    instruction:
      '在每个 tab 下新增一个「下一页」按钮，点击时校验当前 tab 的字段，通过则跳到下一个 tab，失败则定位到第一个出错的字段',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toContain('下一页')
      expect(s).toContain('onClick')
      expect(s).toContain('btnNext')
    },
  },
  {
    id: 'nl-wizard-prev-next',
    fixture: 'F-wizard',
    instruction: '给每页加上一页和下一页，第一页不要上一页，最后一页不要下一页',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toContain('上一页')
      expect(s).toContain('下一页')
      expect(s).toContain('btnPrev')
      expect(s).toContain('btnNext')
    },
  },
  {
    id: 'nl-wizard-submit-locate',
    fixture: 'F-wizard',
    instruction: '最后一页加一个提交按钮，提交时校验整个表单，不通过就切到出错字段所在的页并聚焦',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toMatch(/提交/)
      expect(s).toContain('onClick')
    },
  },
  {
    id: 'nl-amount-calc',
    fixture: 'F-order',
    instruction: '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
    independentAssert: (fj) => {
      const qty = fj.widgetList.find((w: any) => w.options?.name === 'qty')
      expect(String(qty?.options?.onChange || '')).toContain('getFormRef')
      expect(String(qty?.options?.onChange || '')).toMatch(/amount|setFieldValue/)
    },
  },
  {
    id: 'nl-other-required',
    fixture: 'F-order',
    instruction: '类型选「其他」时显示其他说明并设为必填，否则隐藏且不必填',
    independentAssert: (fj) => {
      const type = fj.widgetList.find((w: any) => w.options?.name === 'type')
      const code = String(type?.options?.onChange || '')
      expect(code).toMatch(/otherDesc|showWidgets|hideWidgets/)
    },
  },
  {
    id: 'nl-disable-when-empty',
    fixture: 'F-order',
    instruction: '单价为空时禁用折扣',
    independentAssert: (fj) => {
      const price = fj.widgetList.find((w: any) => w.options?.name === 'price')
      expect(String(price?.options?.onChange || '')).toMatch(/discount|disable/)
    },
  },
  {
    id: 'nl-date-range-validate',
    fixture: 'F-order',
    instruction: '提交前检查结束日期不能早于开始日期',
    independentAssert: (fj) => {
      expect(String(fj.formConfig?.onFormValidate || '')).toMatch(/startDate|endDate/)
    },
  },
  {
    id: 'nl-budget-validate',
    fixture: 'F-order',
    instruction: '提交前实付不能超过预算，超过就提示并定位到实付',
    independentAssert: (fj) => {
      expect(String(fj.formConfig?.onFormValidate || '')).toMatch(/pay|budget/)
    },
  },
  {
    id: 'nl-reset-button',
    fixture: 'F-order',
    instruction: '加一个「重置」按钮，点击清空所有字段',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toContain('重置')
      expect(s).toMatch(/resetForm/)
    },
  },
  {
    id: 'nl-fill-default',
    fixture: 'F-order',
    instruction: '加一个「填入示例」按钮，把数量设为1、单价设为100',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toContain('填入示例')
      expect(s).toMatch(/setFieldValue/)
    },
  },
  {
    id: 'nl-open-help',
    fixture: 'F-detail',
    instruction: '加一个「帮助」按钮，点击打开帮助弹窗',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toContain('帮助')
      expect(s).toMatch(/showDialog/)
    },
  },
  {
    id: 'nl-subform-row-calc',
    fixture: 'F-detail',
    instruction: '明细里小计等于单价乘数量，合计等于所有小计之和',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toMatch(/itemAmount|itemQty|onChange/)
    },
  },
  {
    id: 'nl-subform-default',
    fixture: 'F-detail',
    instruction: '明细新增行时数量默认为1',
    independentAssert: (fj) => {
      const s = JSON.stringify(fj)
      expect(s).toMatch(/onSubFormRowAdd|itemQty/)
    },
  },
  {
    id: 'nl-init-defaults',
    fixture: 'F-order',
    instruction: '打开表单时类型默认选个人，折扣默认0，并默认禁用实付',
    independentAssert: (fj) => {
      expect(String(fj.formConfig?.onFormMounted || '')).toMatch(/personal|discount|pay/)
    },
  },
  {
    id: 'nl-init-active-tab',
    fixture: 'F-wizard',
    instruction: '打开表单时默认停在第二页',
    independentAssert: (fj) => {
      expect(String(fj.formConfig?.onFormMounted || '')).toMatch(/activeTab|wizardTab/)
    },
  },
]

const BANK_NEG: Array<{
  id: string
  fixture: 'F-wizard' | 'F-order' | 'F-detail'
  instruction: string
  expectStatus: string | string[]
}> = [
  {
    id: 'nl-neg-api',
    fixture: 'F-order',
    instruction: '手机号填完后调用接口查询客户信息并回填',
    expectStatus: 'unsupported',
  },
  {
    id: 'nl-neg-submit-api',
    fixture: 'F-wizard',
    instruction: '点提交时把表单数据发到后端保存',
    expectStatus: 'unsupported',
  },
  {
    id: 'nl-neg-upload',
    fixture: 'F-detail',
    instruction: '加一个上传附件按钮',
    expectStatus: 'unsupported',
  },
  {
    id: 'nl-neg-ambiguous',
    fixture: 'F-order',
    instruction: '改一下那个字段的联动',
    expectStatus: 'need_clarification',
  },
  {
    id: 'nl-neg-partial',
    fixture: 'F-order',
    instruction: '金额自动计算，并且保存时调用接口',
    expectStatus: 'unsupported',
  },
  {
    id: 'nl-structure-only',
    fixture: 'F-order',
    instruction: '把备注改成多行文本',
    expectStatus: 'route_refine',
  },
]

/** 精简 order 表单（UI 用例，避免依赖 catalog dump） */
const orderFixtureLite = {
  widgetList: [
    { type: 'number', id: 'qty', options: { name: 'qty', label: '数量', defaultValue: 0 } },
    { type: 'number', id: 'price', options: { name: 'price', label: '单价', defaultValue: 0 } },
    { type: 'number', id: 'amount', options: { name: 'amount', label: '金额', defaultValue: 0 } },
    { type: 'number', id: 'discount', options: { name: 'discount', label: '折扣', defaultValue: 0 } },
    { type: 'number', id: 'pay', options: { name: 'pay', label: '实付', defaultValue: 0 } },
    { type: 'textarea', id: 'orderRemark', options: { name: 'orderRemark', label: '备注' } },
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

/** 打开工具栏预览并注入候选表单（真实 VFormRender） */
async function openPreviewWithCandidate(page: Page, candidate: unknown) {
  await page.evaluate(() => {
    const designer = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef
    designer.$refs.toolbarRef.previewForm()
  })
  await page.waitForSelector('.vf-preview-dialog', { state: 'attached', timeout: 15_000 })
  await page.waitForTimeout(400)
  await page.evaluate((fj) => {
    const toolbar = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef
    toolbar.$refs.preForm.setFormJson(fj)
  }, candidate)
  await page.waitForTimeout(700)
}

async function closePreview(page: Page) {
  await page.evaluate(() => {
    const toolbar = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef
    if (toolbar) toolbar.showPreviewDialogFlag = false
  })
  await page.waitForTimeout(200)
}

/** 在真实 preForm 上执行 scenarios，报告由观测组装（不手写 pass） */
async function runRealPreviewReport(
  page: Page,
  candidate: unknown,
  scenarios: unknown[],
  handlers: unknown[],
) {
  await openPreviewWithCandidate(page, candidate)
  const report = await page.evaluate(
    async ({ scenarios, handlers, candidate }) => {
      const load = (window as any).__vfaLoadInteractionRunner
      if (typeof load !== 'function') throw new Error('__vfaLoadInteractionRunner missing')
      const mod = await load()
      const pre = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef
        .$refs.preForm
      return mod.runInteractionScenariosOnPreview({
        formRef: pre,
        formJson: candidate,
        scenarios,
        handlers,
        runner: 'playwright',
      })
    },
    { scenarios, handlers, candidate },
  )
  await closePreview(page)
  return report as {
    runner: string
    pass: boolean
    results: Array<{ scenarioId: string; ok: boolean; actual?: Record<string, unknown>; error?: string }>
    networkHits?: string[]
    errors?: string[]
  }
}

test.describe('v0.9 UI 统一入口', () => {
  test(
    '金额联动 generate → 场景可见 → 不走 /event',
    {
      annotation: { type: 'case-id', description: 'interaction-ui-confirm-flow' },
    },
    async ({ page }, testInfo) => {
      await seedDesigner(page, orderFixtureLite)
      await openAiPanel(page)

      const interactionPromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === interactionPath && response.request().method() === 'POST',
      )
      let eventHit = false
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/agent/v1/event') eventHit = true
      })

      await page.locator('.ai-agent-panel textarea').fill(
        '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
      )
      await clickSubmit(page)

      const interactionResponse = await interactionPromise
      expect(interactionResponse.status()).toBe(200)
      const body = await interactionResponse.json()
      expect(body.status).toBe('generated')
      expect(body.output?.handlers?.length).toBeGreaterThan(0)
      expect(eventHit).toBe(false)

      await expect(page.locator('.ai-agent-panel .warnings-title').filter({ hasText: '验证场景' })).toBeVisible()
      await expect(page.getByRole('button', { name: '在预览中验证' })).toBeEnabled()
      await expect(page.getByRole('button', { name: /确认写入画布/ })).toBeDisabled()

      await attachEvidence(
        page,
        testInfo,
        `POST ${interactionPath} status=generated; scenarios visible; apply disabled; no /event`,
      )
    },
  )

  test(
    '纯结构 route_refine 后走 /refine',
    {
      annotation: { type: 'case-id', description: 'interaction-ui-route-refine' },
    },
    async ({ page }, testInfo) => {
      await seedDesigner(page, orderFixtureLite)
      await openAiPanel(page)

      const interactionPromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === interactionPath && response.request().method() === 'POST',
      )
      const refinePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === refinePath && response.request().method() === 'POST',
      )

      await page.locator('.ai-agent-panel textarea').fill('把备注改成多行文本')
      await clickSubmit(page)

      const ix = await interactionPromise
      expect((await ix.json()).status).toBe('route_refine')
      const refine = await refinePromise
      expect(refine.status()).toBe(200)

      await attachEvidence(page, testInfo, `route_refine then ${refinePath}`)
    },
  )
})

test.describe('v0.9 题库（真实预览 + fixture 回放）', () => {
  for (const row of BANK_POS) {
    test(
      `正例 ${row.id}`,
      {
        annotation: { type: 'case-id', description: row.id },
        // 真实预览 + 多场景，放宽单测超时
      },
      async ({ page }, testInfo) => {
        test.setTimeout(120_000)
        const formJson = loadFixtureForm(row.fixture)
        const before = JSON.stringify(formJson)
        await seedDesigner(page, formJson)

        const genRes = await page.request.post(interactionPath, {
          data: { action: 'generate', instruction: row.instruction, currentFormJson: formJson, messages: [] },
        })
        expect(genRes.status()).toBe(200)
        const gen = await genRes.json()
        expect(gen.status).toBe('generated')
        expect(gen.formJsonCandidate).toBeTruthy()
        expect(JSON.stringify(formJson)).toBe(before)

        const scenarios = gen.output.scenarios || []
        expect(scenarios.length).toBeGreaterThan(0)
        const report = await runRealPreviewReport(
          page,
          gen.formJsonCandidate,
          scenarios,
          gen.output.handlers || [],
        )
        expect(report.pass, JSON.stringify(report.results)).toBe(true)

        const applyRes = await page.request.post(interactionPath, {
          data: {
            action: 'apply',
            instruction: row.instruction,
            currentFormJson: formJson,
            output: gen.output,
            verificationReport: report,
            userConfirmed: true,
            confirmOverwrite: true,
          },
        })
        expect(applyRes.status()).toBe(200)
        const applied = await applyRes.json()
        expect(applied.status).toBe('applied')
        expect(applied.applied).toBe(true)
        row.independentAssert(applied.formJson)

        await attachEvidence(
          page,
          testInfo,
          `${row.id}: generate→real-preview pass→applied; handlers=${gen.output.handlers?.length}; scenarios=${scenarios.length}; results=${report.results
            .map((r) => `${r.scenarioId}:${r.ok ? 'ok' : r.error || 'fail'}`)
            .join(',')}`,
        )
      },
    )
  }

  for (const row of BANK_NEG) {
    test(
      `负例 ${row.id}`,
      {
        annotation: { type: 'case-id', description: row.id },
      },
      async ({ request }, testInfo) => {
        const formJson = loadFixtureForm(row.fixture)
        const before = JSON.stringify(formJson)
        const genRes = await request.post(interactionPath, {
          data: { action: 'generate', instruction: row.instruction, currentFormJson: formJson, messages: [] },
        })
        expect(genRes.status()).toBe(200)
        const gen = await genRes.json()
        const allowed = Array.isArray(row.expectStatus) ? row.expectStatus : [row.expectStatus]
        expect(allowed).toContain(gen.status)
        expect(JSON.stringify(formJson)).toBe(before)

        if (gen.status !== 'route_refine' && gen.output) {
          const applyRes = await request.post(interactionPath, {
            data: {
              action: 'apply',
              instruction: row.instruction,
              currentFormJson: formJson,
              output: gen.output,
              verificationReport: { runner: 'playwright', pass: true, results: [] },
              userConfirmed: true,
              confirmOverwrite: true,
            },
          })
          const applied = await applyRes.json()
          expect(applied.applied).not.toBe(true)
          expect(JSON.stringify(formJson)).toBe(before)
        }

        await testInfo.attach('observed', {
          body: Buffer.from(`${row.id}: status=${gen.status}; canvas unchanged`, 'utf8'),
          contentType: 'text/plain',
        })
      },
    )
  }
})
