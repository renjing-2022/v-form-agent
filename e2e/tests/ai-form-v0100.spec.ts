import { expect, test, type Page, type TestInfo } from '@playwright/test'

process.env.EVIDENCE_VERSION = 'v0.10.0'

const interactionPath = '/api/agent/v1/interaction'

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

async function canvasSnapshot(page: Page) {
  return page.evaluate(() => {
    const designer = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef
    return JSON.stringify(designer.getFormJson())
  })
}

test.describe('v0.10 Ask-before-act E2E', () => {
  test(
    '含糊指令 → 澄清回答 → generated → 预览 → applied',
    {
      annotation: { type: 'case-id', description: 'ask-clarify-loop-apply' },
    },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      await seedDesigner(page, orderFixtureLite)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('给那个字段加点交互')
      await clickSubmit(page)
      const genRes = await genPromise
      expect(genRes.status()).toBe(200)
      const genBody = await genRes.json()
      expect(genBody.status).toBe('need_clarification')
      expect(genBody.clarification?.protocol).toBe('structured-clarify-v1')
      expect(genBody.pendingPlan?.id).toBeTruthy()

      await expect(page.locator('.clarify-panel')).toBeVisible()
      await expect(page.getByText('需要确认后再继续')).toBeVisible()

      // 控件单选：选数量
      const widgetRadio = page.locator('.clarify-q').first().locator('.el-radio').filter({ hasText: '数量' })
      await expect(widgetRadio).toBeVisible()
      await widgetRadio.click()

      // 文本题填答
      const textAreas = page.locator('.clarify-panel textarea')
      const n = await textAreas.count()
      for (let i = 0; i < n; i++) {
        await textAreas.nth(i).fill('赋值并本地校验')
      }

      const clarifyPromise = page.waitForResponse((r) => {
        if (new URL(r.url()).pathname !== interactionPath || r.request().method() !== 'POST') return false
        try {
          const body = r.request().postDataJSON()
          return body?.action === 'clarify'
        } catch {
          return false
        }
      })
      await page.getByRole('button', { name: '继续生成' }).click()
      const clarifyRes = await clarifyPromise
      expect(clarifyRes.status()).toBe(200)
      const clarified = await clarifyRes.json()
      expect(clarified.status).toBe('generated')
      expect(clarified.formJsonCandidate).toBeTruthy()
      expect(clarified.output?.handlers?.length).toBeGreaterThan(0)

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
      const applyRes = await applyPromise
      expect(applyRes.status()).toBe(200)
      const applied = await applyRes.json()
      expect(applied.status).toBe('applied')
      expect(applied.applied).toBe(true)

      const after = await canvasSnapshot(page)
      expect(after).not.toBe(before)

      await attachEvidence(
        page,
        testInfo,
        `need_clarification→clarify→generated→verify→applied; plan=${genBody.pendingPlan.id}; handlers=${clarified.output.handlers.length}`,
      )
    },
  )

  test(
    '画布漂移后 plan_expired，画布不变',
    {
      annotation: { type: 'case-id', description: 'ask-plan-expired-drift' },
    },
    async ({ page }, testInfo) => {
      await seedDesigner(page, orderFixtureLite)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)

      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('给那个字段加点交互')
      await clickSubmit(page)
      const genBody = await (await genPromise).json()
      expect(genBody.status).toBe('need_clarification')
      await expect(page.locator('.clarify-panel')).toBeVisible()

      // 漂移：改画布
      await page.evaluate(() => {
        const designer = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef
        const fj = designer.getFormJson()
        fj.widgetList = fj.widgetList.map((w: any) =>
          w.options?.name === 'qty' ? { ...w, options: { ...w.options, label: '数量(已改)' } } : w,
        )
        designer.setFormJson(fj)
      })
      await page.waitForTimeout(200)
      const mid = await canvasSnapshot(page)
      expect(mid).not.toBe(before)

      const widgetRadio = page.locator('.clarify-q').first().locator('.el-radio').filter({ hasText: '数量' })
      if (await widgetRadio.isVisible().catch(() => false)) await widgetRadio.click()
      const textAreas = page.locator('.clarify-panel textarea')
      for (let i = 0; i < (await textAreas.count()); i++) {
        await textAreas.nth(i).fill('任意')
      }

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
      expect(clarified.status).toBe('plan_expired')
      expect(clarified.applied).toBeFalsy()

      const after = await canvasSnapshot(page)
      expect(after).toBe(mid)

      await attachEvidence(
        page,
        testInfo,
        `plan_expired after canvas drift; canvas unchanged vs mid; plan=${genBody.pendingPlan?.id}`,
      )
    },
  )

  test(
    '事件冲突全部 cancel 后画布不变',
    {
      annotation: { type: 'case-id', description: 'ask-conflict-cancel-unchanged' },
    },
    async ({ page }, testInfo) => {
      const formWithExisting = JSON.parse(JSON.stringify(orderFixtureLite))
      formWithExisting.widgetList[0].options.onChange = 'console.log("handwritten")'
      await seedDesigner(page, formWithExisting)
      const before = await canvasSnapshot(page)

      const output = {
        intent: 'interaction',
        summary: 'overwrite qty onChange',
        structure: [],
        handlers: [
          {
            id: 'h1',
            target: 'qty',
            eventKey: 'onChange',
            code: 'this.setValue(9)',
            explain: 'mock',
          },
        ],
        scenarios: [
          {
            id: 's1',
            handlerRefs: ['h1'],
            title: 't',
            arrange: {},
            act: [],
            assert: [{ noError: true }],
          },
        ],
        unsupported: [],
      }

      const previewForce = await page.request.post(interactionPath, {
        data: {
          action: 'preview',
          currentFormJson: formWithExisting,
          output,
        },
      })
      expect(previewForce.status()).toBe(200)
      const forced = await previewForce.json()
      expect((forced.eventConflicts || []).length).toBe(1)

      const resolutions = [
        { target: 'qty', eventKey: 'onChange', mode: 'cancel' as const },
      ]

      const previewCancel = await page.request.post(interactionPath, {
        data: {
          action: 'preview',
          currentFormJson: formWithExisting,
          output,
          eventResolutions: resolutions,
        },
      })
      expect(previewCancel.status()).toBe(422)

      const applyRes = await page.request.post(interactionPath, {
        data: {
          action: 'apply',
          instruction: 'cancel-only',
          currentFormJson: formWithExisting,
          output,
          verificationReport: {
            runner: 'playwright',
            pass: true,
            results: [{ scenarioId: 's1', ok: true, actual: { noError: true, noNetwork: true } }],
          },
          userConfirmed: true,
          eventResolutions: resolutions,
        },
      })
      const applied = await applyRes.json()
      expect(applied.applied).toBeFalsy()
      expect(applied.status).not.toBe('applied')

      const after = await canvasSnapshot(page)
      expect(after).toBe(before)
      expect(String(formWithExisting.widgetList[0].options.onChange)).toContain('handwritten')

      await openAiPanel(page)
      await attachEvidence(
        page,
        testInfo,
        `single conflict cancel → preview 422 + apply not applied; canvas unchanged; onChange handwritten`,
      )
    },
  )

  test(
    '明确 L1 金额联动不强制澄清',
    {
      annotation: { type: 'case-id', description: 'ask-l1-no-clarify-ui' },
    },
    async ({ page }, testInfo) => {
      await seedDesigner(page, orderFixtureLite)
      await openAiPanel(page)
      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill(
        '数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣',
      )
      await clickSubmit(page)
      const body = await (await genPromise).json()
      expect(body.status).toBe('generated')
      expect(body.clarification).toBeFalsy()
      await expect(page.locator('.clarify-panel')).toHaveCount(0)
      await attachEvidence(page, testInfo, 'L1 generated without clarify-panel')
    },
  )

  test(
    '上传类 L2 进入澄清且不写入',
    {
      annotation: { type: 'case-id', description: 'ask-l2-upload-clarify' },
    },
    async ({ page }, testInfo) => {
      await seedDesigner(page, orderFixtureLite)
      const before = await canvasSnapshot(page)
      await openAiPanel(page)
      const genPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === interactionPath && r.request().method() === 'POST',
      )
      await page.locator('.ai-agent-panel textarea').fill('给表单加一个上传头像')
      await clickSubmit(page)
      const body = await (await genPromise).json()
      expect(body.status).toBe('need_clarification')
      expect(body.riskLevel).toBe('L2')
      await expect(page.locator('.clarify-panel')).toBeVisible()
      expect(await canvasSnapshot(page)).toBe(before)
      await attachEvidence(page, testInfo, `L2 upload → need_clarification; canvas unchanged`)
    },
  )
})
