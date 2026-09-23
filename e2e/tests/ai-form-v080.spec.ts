import { expect, test, type Page, type TestInfo } from '@playwright/test'

process.env.EVIDENCE_VERSION = 'v0.8.0'

const eventPath = '/api/agent/v1/event'

function numberWidget(id: string, label: string) {
  return {
    type: 'number',
    icon: 'number-field',
    formItemFlag: true,
    id,
    options: {
      name: id,
      label,
      labelAlign: '',
      defaultValue: 0,
      placeholder: '',
      columnWidth: '200px',
      size: '',
      controls: true,
      labelWidth: null,
      labelHidden: false,
      disabled: false,
      hidden: false,
      required: false,
      validation: '',
      validationHint: '',
      customClass: '',
      min: -100000000000,
      max: 100000000000,
      precision: 0,
      step: 1,
      controlsPosition: 'right',
      onCreated: '',
      onMounted: '',
      onChange: '',
      onFocus: '',
      onBlur: '',
      onValidate: '',
    },
  }
}

const formFixture = {
  widgetList: [
    numberWidget('yw', '语文'),
    numberWidget('sx', '数学'),
    numberWidget('zf', '总分'),
    {
      type: 'button',
      icon: 'button',
      formItemFlag: false,
      id: 'btn1',
      options: {
        name: 'btn1',
        label: '打开',
        columnWidth: '200px',
        size: '',
        displayStyle: 'block',
        disabled: false,
        hidden: false,
        type: '',
        plain: false,
        round: false,
        circle: false,
        icon: null,
        customClass: '',
        onCreated: '',
        onMounted: '',
        onClick: '',
      },
    },
    {
      type: 'sub-form',
      category: 'container',
      icon: 'sub-form',
      commonFlag: true,
      id: 'sf1',
      options: {
        name: 'sf1',
        label: '明细',
        showBlankRow: true,
        showRowNumber: false,
        labelAlign: 'label-center-align',
        hidden: false,
        disabled: false,
        actionColumnPosition: 'left',
        customClass: '',
        onSubFormRowAdd: '',
        onSubFormRowInsert: '',
        onSubFormRowDelete: '',
        onSubFormRowChange: '',
      },
      widgetList: [
        {
          type: 'input',
          icon: 'text-field',
          formItemFlag: true,
          id: 'sfi1',
          options: {
            name: 'sfi1',
            label: '品名',
            labelAlign: '',
            type: 'text',
            defaultValue: '',
            placeholder: '',
            columnWidth: '200px',
            size: '',
            labelWidth: null,
            labelHidden: false,
            readonly: false,
            disabled: false,
            hidden: false,
            clearable: true,
            required: false,
            validation: '',
            validationHint: '',
            customClass: '',
            onCreated: '',
            onMounted: '',
            onInput: '',
            onChange: '',
            onFocus: '',
            onBlur: '',
            onValidate: '',
          },
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
    jsonVersion: 3,
  },
}

const LABEL_TO_NAME: Record<string, string> = { 语文: 'yw', 数学: 'sx', 总分: 'zf', 品名: 'sfi1' }

type Example = { given: Record<string, unknown>; expect: Record<string, unknown> }

async function seedDesigner(page: Page, formJson: typeof formFixture) {
  await page.goto('/index.html')
  await expect(page.locator('#formWidgetCanvas')).toBeVisible({ timeout: 30_000 })
  const loaded = await page.evaluate((fj) => {
    const designer = (document.querySelector('#app') as any)?.__vue_app__?._instance?.proxy?.$refs?.vfdRef
    if (!designer?.setFormJson) return false
    designer.setFormJson(fj)
    return true
  }, formJson)
  expect(loaded).toBeTruthy()
  await page.waitForTimeout(400)
}

async function postEvent(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post(`http://127.0.0.1:3140${eventPath}`, { data: body })
  return { status: res.status(), json: await res.json() }
}

async function attachEvidence(page: Page, testInfo: TestInfo, observed: string) {
  await testInfo.attach('observed', { body: Buffer.from(observed, 'utf8'), contentType: 'text/plain' })
  await testInfo.attach('deliveryguard-screenshot', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
}

/** 打开工具栏预览，把候选注入 preForm（真实 VFormRender，setFormJson 会触发 onFormMounted） */
async function openPreviewWithCandidate(page: Page, candidate: any) {
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
  await page.waitForTimeout(600)
  return page.locator('.vf-preview-dialog').first()
}

async function closePreview(page: Page) {
  await page.evaluate(() => {
    const toolbar = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef
    if (toolbar) toolbar.showPreviewDialogFlag = false
  })
  await page.waitForTimeout(200)
}

function fieldItem(dialog: ReturnType<Page['locator']>, label: string) {
  return dialog.locator('.el-form-item').filter({ hasText: label }).first()
}

/** 真实键盘输入；触发字段最后填写，保证其它 given 已就位 */
async function typeGiven(page: Page, dialog: ReturnType<Page['locator']>, given: Record<string, unknown>, trigger?: string) {
  const entries = Object.entries(given)
  const ordered = trigger
    ? [...entries.filter(([k]) => k !== trigger), ...entries.filter(([k]) => k === trigger)]
    : entries
  for (const [label, val] of ordered) {
    const input = fieldItem(dialog, label).locator('input').first()
    await input.fill('')
    await input.fill(String(val))
    await input.press('Tab')
    await page.waitForTimeout(300)
  }
}

/** 从 preForm 读取真实状态：字段值走 getFieldValue，X.hidden/X.disabled 走控件 options */
async function observe(page: Page, keys: string[]) {
  return page.evaluate(
    ({ keys, map }) => {
      const pre = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef.$refs
        .preForm
      const out: Record<string, unknown> = {}
      for (const k of keys) {
        const m = k.match(/^(.+)\.(hidden|disabled)$/)
        if (m) {
          const ref = pre.getWidgetRef(map[m[1]] || m[1])
          const v = ref?.field?.options?.[m[2]]
          if (typeof v === 'boolean') out[k] = v
        } else {
          const name = map[k] || k
          if (pre.getWidgetRef(name)) out[k] = pre.getFieldValue(name)
        }
      }
      return out
    },
    { keys, map: LABEL_TO_NAME },
  )
}

async function validatePreForm(page: Page) {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const pre = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef
          .$refs.preForm
        pre.validateForm((valid: boolean) => resolve(!!valid))
      }),
  )
}

async function setSilently(page: Page, values: Record<string, unknown>) {
  await page.evaluate(
    ({ values, map }) => {
      const pre = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef.$refs.toolbarRef.$refs
        .preForm
      for (const [k, v] of Object.entries(values)) pre.setFieldValue(map[k] || k, v, true)
    },
    { values, map: LABEL_TO_NAME },
  )
}

function looseEqual(actual: unknown, expected: unknown) {
  if (actual === undefined || actual === null) return actual === expected
  if (typeof expected === 'number') return actual !== '' && Number(actual) === expected
  return String(actual) === String(expected)
}

/** 报告由真实观测与 spec.examples 逐条比对得出，不手写 ok/pass */
function buildReport(examples: Example[], observations: Array<Record<string, unknown>>) {
  const results = examples.map((ex, i) => {
    const actual = observations[i] || {}
    const ok = Object.entries(ex.expect).every(([k, v]) => k in actual && looseEqual(actual[k], v))
    return { exampleIndex: i, ok, actual }
  })
  return { runner: 'playwright' as const, results, pass: results.every((r) => r.ok) }
}

async function clarifyAndGenerate(page: Page, instruction: string) {
  const clarify = await postEvent(page, { instruction, currentFormJson: formFixture, action: 'clarify' })
  expect(clarify.json.status).toBe('spec_ready')
  const gen = await postEvent(page, {
    instruction,
    currentFormJson: formFixture,
    action: 'generate',
    eventSpec: clarify.json.eventSpec,
  })
  expect(gen.json.status).toBe('code_preview')
  return { eventSpec: clarify.json.eventSpec, gen: gen.json }
}

async function applyWithReport(page: Page, instruction: string, eventSpec: any, patches: any, report: any) {
  return postEvent(page, {
    instruction,
    currentFormJson: formFixture,
    action: 'apply',
    eventSpec,
    patches,
    executionReport: report,
  })
}

test(
  'onChange 联动：真实输入触发求和 → 报告 → apply',
  { annotation: { type: 'case-id', description: 'event-compute-onchange-apply' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const instruction = '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":6}'
    const { eventSpec, gen } = await clarifyAndGenerate(page, instruction)
    expect(String(gen.code)).toContain('setFieldValue')

    const dialog = await openPreviewWithCandidate(page, gen.formJsonCandidate)
    await typeGiven(page, dialog, { 语文: 2, 数学: 4 }, '语文')
    const actual = await observe(page, ['总分'])
    expect(Number(actual['总分'])).toBe(6)
    await closePreview(page)

    const report = buildReport(eventSpec.examples, [actual])
    expect(report.pass).toBe(true)
    const apply = await applyWithReport(page, instruction, eventSpec, gen.patches, report)
    expect(apply.json.status).toBe('applied')
    await attachEvidence(page, testInfo, `typed 语文=2,数学=4 → observed=${JSON.stringify(actual)}; apply=${apply.json.status}`)
  },
)

test(
  '联动禁用：真实输入后控件变为 disabled → apply',
  { annotation: { type: 'case-id', description: 'event-linkage-set-enable-apply' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const instruction = '改语文时禁用总分 例如：语文=5 期望：{"总分.disabled":true}'
    const { eventSpec, gen } = await clarifyAndGenerate(page, instruction)
    expect(String(gen.code)).toMatch(/disableWidgets/)

    const dialog = await openPreviewWithCandidate(page, gen.formJsonCandidate)
    const before = await observe(page, ['总分.disabled'])
    expect(before['总分.disabled']).toBe(false)
    await typeGiven(page, dialog, { 语文: 5 }, '语文')
    const actual = await observe(page, ['总分.disabled'])
    expect(actual['总分.disabled']).toBe(true)
    await expect(fieldItem(dialog, '总分').locator('input').first()).toBeDisabled()
    await closePreview(page)

    const report = buildReport(eventSpec.examples, [actual])
    const apply = await applyWithReport(page, instruction, eventSpec, gen.patches, report)
    expect(apply.json.status).toBe('applied')
    await attachEvidence(page, testInfo, `before=${JSON.stringify(before)} after typing 语文=5 → ${JSON.stringify(actual)}; input disabled in DOM`)
  },
)

test(
  '联动隐藏：真实输入后控件隐藏 → apply',
  { annotation: { type: 'case-id', description: 'event-show-hide-condition-apply' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const instruction = '改语文时隐藏总分 例如：语文=5 期望：{"总分.hidden":true}'
    const { eventSpec, gen } = await clarifyAndGenerate(page, instruction)
    expect(String(gen.code)).toMatch(/hideWidgets/)

    const dialog = await openPreviewWithCandidate(page, gen.formJsonCandidate)
    await expect(fieldItem(dialog, '总分')).toBeVisible()
    await typeGiven(page, dialog, { 语文: 5 }, '语文')
    const actual = await observe(page, ['总分.hidden'])
    expect(actual['总分.hidden']).toBe(true)
    await expect(dialog.locator('.el-form-item').filter({ hasText: '总分' })).toHaveCount(0)
    await closePreview(page)

    const report = buildReport(eventSpec.examples, [actual])
    const apply = await applyWithReport(page, instruction, eventSpec, gen.patches, report)
    expect(apply.json.status).toBe('applied')
    await attachEvidence(page, testInfo, `after typing 语文=5 → ${JSON.stringify(actual)}; 总分 item removed from DOM`)
  },
)

test(
  '按钮 onClick：真实点击后写入总分 → apply',
  { annotation: { type: 'case-id', description: 'event-button-onclick-open-dialog' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const eventSpec = {
      trigger: { widgetRef: { id: 'btn1', name: 'btn1', label: '打开' }, eventKey: 'onClick' },
      sink: { kind: 'widget-event', eventKey: 'onClick' },
      overwritePolicy: 'reject-if-present',
      examples: [{ given: {}, expect: { 总分: 1 } }],
      notes: [],
    }
    const instruction = '点击打开按钮时把总分设为1 期望：{"总分":1}'
    const gen = await postEvent(page, { instruction, currentFormJson: formFixture, action: 'generate', eventSpec })
    expect(gen.json.status).toBe('code_preview')
    expect(String(gen.json.code)).toContain("setFieldValue('zf', 1)")

    const dialog = await openPreviewWithCandidate(page, gen.json.formJsonCandidate)
    const before = await observe(page, ['总分'])
    await dialog.getByRole('button', { name: '打开' }).click()
    await page.waitForTimeout(300)
    const actual = await observe(page, ['总分'])
    expect(Number(before['总分'])).not.toBe(1)
    expect(Number(actual['总分'])).toBe(1)
    await closePreview(page)

    const report = buildReport(eventSpec.examples as Example[], [actual])
    const apply = await applyWithReport(page, instruction, eventSpec, gen.json.patches, report)
    expect(apply.json.status).toBe('applied')
    await attachEvidence(page, testInfo, `before=${JSON.stringify(before)} click 打开 → ${JSON.stringify(actual)}`)
  },
)

test(
  '生命周期 onFormMounted：预览装载后读到初始值 → apply',
  { annotation: { type: 'case-id', description: 'event-created-mounted-apply' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const instruction = '打开表单时初始化 期望：{"总分":9}'
    const { eventSpec, gen } = await clarifyAndGenerate(page, instruction)
    expect(eventSpec.trigger.eventKey).toBe('onFormMounted')
    expect(String(gen.code)).toContain("setFieldValue('zf', 9)")

    await openPreviewWithCandidate(page, gen.formJsonCandidate)
    const actual = await observe(page, ['总分'])
    expect(Number(actual['总分'])).toBe(9)
    await closePreview(page)

    const report = buildReport(eventSpec.examples, [actual])
    const apply = await applyWithReport(page, instruction, eventSpec, gen.patches, report)
    expect(apply.json.status).toBe('applied')
    expect(String(apply.json.formJson.formConfig.onFormMounted || '')).toContain('setFieldValue')
    await attachEvidence(page, testInfo, `mounted → ${JSON.stringify(actual)}`)
  },
)

test(
  '子表增行 onSubFormRowAdd：真实点击增行后写入总分 → apply',
  { annotation: { type: 'case-id', description: 'event-subform-row-apply' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const instruction = '子表增行时把总分设为1 期望：{"总分":1}'
    const { eventSpec, gen } = await clarifyAndGenerate(page, instruction)
    expect(eventSpec.trigger.eventKey).toBe('onSubFormRowAdd')

    const dialog = await openPreviewWithCandidate(page, gen.formJsonCandidate)
    const rowsBefore = await dialog.locator('.sub-form-row').count()
    await dialog.locator('.sub-form-container .action-header-column .action-button').first().click()
    await page.waitForTimeout(300)
    const rowsAfter = await dialog.locator('.sub-form-row').count()
    const actual = await observe(page, ['总分'])
    expect(rowsAfter).toBe(rowsBefore + 1)
    expect(Number(actual['总分'])).toBe(1)
    await closePreview(page)

    const report = buildReport(eventSpec.examples, [actual])
    const apply = await applyWithReport(page, instruction, eventSpec, gen.patches, report)
    expect(apply.json.status).toBe('applied')
    await attachEvidence(page, testInfo, `rows ${rowsBefore}→${rowsAfter}; observed=${JSON.stringify(actual)}`)
  },
)

test(
  '表单校验 onFormValidate：真实 validateForm 拦截负数、放行正数 → apply',
  { annotation: { type: 'case-id', description: 'event-form-validate-submit-guard' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    const eventSpec = {
      trigger: { eventKey: 'onFormValidate' },
      sink: { kind: 'form-event', eventKey: 'onFormValidate' },
      overwritePolicy: 'reject-if-present',
      examples: [
        { given: { 总分: -1 }, expect: { valid: false } },
        { given: { 总分: 5 }, expect: { valid: true } },
      ],
      notes: [],
    }
    const instruction = '提交前校验总分不能小于0'
    const gen = await postEvent(page, { instruction, currentFormJson: formFixture, action: 'generate', eventSpec })
    expect(gen.json.status).toBe('code_preview')

    await openPreviewWithCandidate(page, gen.json.formJsonCandidate)
    const observations: Array<Record<string, unknown>> = []
    for (const ex of eventSpec.examples) {
      await setSilently(page, ex.given)
      observations.push({ valid: await validatePreForm(page) })
    }
    expect(observations).toEqual([{ valid: false }, { valid: true }])
    await closePreview(page)

    const report = buildReport(eventSpec.examples as Example[], observations)
    const apply = await applyWithReport(page, instruction, eventSpec, gen.json.patches, report)
    expect(apply.json.status).toBe('applied')
    await attachEvidence(page, testInfo, `总分=-1 → ${JSON.stringify(observations[0])}; 总分=5 → ${JSON.stringify(observations[1])}`)
  },
)

async function runAiChatEventFlow(page: Page, instruction: string) {
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  await expect(page.locator('.ai-agent-panel')).toBeVisible()
  await page.locator('.ai-agent-panel .mode-row').getByText('优化当前表', { exact: true }).click()
  await page.locator('.ai-agent-panel textarea').fill(instruction)
  await page.getByRole('button', { name: '优化当前表', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成交互代码' })).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /应用到设计器/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: '确认写入画布' })).toBeDisabled()
  await page.getByRole('button', { name: '生成交互代码' }).click()
  await expect(page.getByRole('button', { name: '在预览中验证' })).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '确认写入画布' })).toBeDisabled()
  await page.getByRole('button', { name: '在预览中验证' }).click()
  await expect(page.getByRole('button', { name: '在预览中验证' })).toBeEnabled({ timeout: 15_000 })
}

async function designerOnChange(page: Page, widgetId: string) {
  return page.evaluate((id) => {
    const designer = (document.querySelector('#app') as any).__vue_app__._instance.proxy.$refs.vfdRef
    const fj = designer.getFormJson()
    const w = fj.widgetList.find((x: any) => x.id === id)
    return String(w?.options?.onChange || '')
  }, widgetId)
}

test(
  'UI 全链路：澄清 → 生成 → 预览真实验证 → 确认写入画布',
  { annotation: { type: 'case-id', description: 'event-ui-apply-gate' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    await runAiChatEventFlow(page, '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":6}')
    const applyBtn = page.getByRole('button', { name: '确认写入画布' })
    await expect(applyBtn).toBeEnabled()
    await applyBtn.click()
    await expect.poll(() => designerOnChange(page, 'yw'), { timeout: 15_000 }).toContain('setFieldValue')
    const code = await designerOnChange(page, 'yw')
    await attachEvidence(page, testInfo, `designer yw.onChange after UI apply:\n${code}`)
  },
)

test(
  'UI 负例：期望与真实执行不符时预览验证失败，写入画布保持禁用',
  { annotation: { type: 'case-id', description: 'event-ui-verify-rejects-mismatch' } },
  async ({ page }, testInfo) => {
    await seedDesigner(page, formFixture)
    await runAiChatEventFlow(page, '改语文时把总分设为加权结果 例如：语文=2,数学=4 期望：{"总分":7}')
    await expect(page.getByText('预览验证未通过').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '确认写入画布' })).toBeDisabled()
    expect(await designerOnChange(page, 'yw')).toBe('')
    await attachEvidence(page, testInfo, 'expect 总分=7 vs real 6 → verify failed; apply stays disabled; designer yw.onChange empty')
  },
)
