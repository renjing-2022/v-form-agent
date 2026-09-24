/**
 * v0.9 验收题库用固定表单 fixture（完整 widget 配置）。
 * 字段 name 与 scenarios.md 描述对齐，供生成 / e2e / 冒烟复用。
 */
import { getDefaultFormConfig } from '../../src/knowledge/widgetWhitelist.js'
import { buildWidgetFromCatalogDefaults } from '../../src/knowledge/widgetDefaults.js'

export type FixtureFormJson = {
  widgetList: Record<string, unknown>[]
  formConfig: Record<string, unknown>
}

function field(
  type: string,
  id: string,
  name: string,
  label: string,
  optionOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return buildWidgetFromCatalogDefaults(type, {
    id,
    name,
    label,
    optionOverrides,
  })
}

function tabPane(
  id: string,
  name: string,
  label: string,
  widgetList: Record<string, unknown>[],
  active = false,
): Record<string, unknown> {
  return buildWidgetFromCatalogDefaults('tab-pane', {
    id,
    name,
    label,
    optionOverrides: { active },
    widgetList,
  })
}

/** F-wizard：三页向导 */
export function buildFWizard(): FixtureFormJson {
  const tab = buildWidgetFromCatalogDefaults('tab', {
    id: 'wizardTab',
    name: 'wizardTab',
    label: '向导',
    tabs: [
      tabPane(
        'tab1',
        'tab1',
        '基本信息',
        [
          field('input', 'name', 'name', '姓名', { required: true }),
          field('input', 'mobile', 'mobile', '手机号', { required: true }),
        ],
        true,
      ),
      tabPane('tab2', 'tab2', '工作信息', [
        field('input', 'company', 'company', '公司'),
        field('input', 'title', 'title', '职位', { required: true }),
      ]),
      tabPane('tab3', 'tab3', '确认', [field('textarea', 'remark', 'remark', '备注')]),
    ],
  })
  return { widgetList: [tab], formConfig: getDefaultFormConfig() }
}

/** F-order：订单联动 / 校验 */
export function buildFOrder(): FixtureFormJson {
  return {
    widgetList: [
      field('number', 'qty', 'qty', '数量', { defaultValue: null }),
      field('number', 'price', 'price', '单价', { defaultValue: null }),
      field('number', 'amount', 'amount', '金额', { defaultValue: null }),
      field('number', 'discount', 'discount', '折扣', { defaultValue: null }),
      field('number', 'pay', 'pay', '实付', { defaultValue: null }),
      field('radio', 'type', 'type', '类型', {
        optionItems: [
          { label: '个人', value: 'personal' },
          { label: '企业', value: 'company' },
          { label: '其他', value: 'other' },
        ],
        defaultValue: null,
      }),
      field('textarea', 'otherDesc', 'otherDesc', '其他说明', { hidden: true, required: false }),
      field('date', 'startDate', 'startDate', '开始日期'),
      field('date', 'endDate', 'endDate', '结束日期'),
      field('number', 'budget', 'budget', '预算', { defaultValue: null }),
      field('textarea', 'orderRemark', 'orderRemark', '备注'),
    ],
    formConfig: getDefaultFormConfig(),
  }
}

/** F-detail：子表 + 帮助弹窗 */
export function buildFDetail(): FixtureFormJson {
  const subForm = buildWidgetFromCatalogDefaults('sub-form', {
    id: 'detail',
    name: 'detail',
    label: '明细',
    optionOverrides: {
      showBlankRow: true,
      showRowNumber: true,
    },
    widgetList: [
      field('input', 'itemName', 'itemName', '品名'),
      field('number', 'itemPrice', 'itemPrice', '单价', { defaultValue: null }),
      field('number', 'itemQty', 'itemQty', '数量', { defaultValue: null }),
      field('number', 'itemSubtotal', 'itemSubtotal', '小计', { defaultValue: null }),
    ],
  })
  const helpDialog = buildWidgetFromCatalogDefaults('vf-dialog', {
    id: 'helpDialog',
    name: 'helpDialog',
    label: '帮助',
    optionOverrides: {
      title: '帮助',
      width: '40%',
    },
    widgetList: [field('static-text', 'helpText', 'helpText', '帮助说明', { textContent: '这是帮助内容' })],
  })
  return {
    widgetList: [
      subForm,
      field('number', 'total', 'total', '合计', { defaultValue: null }),
      field('textarea', 'detailRemark', 'detailRemark', '备注'),
      helpDialog,
    ],
    formConfig: getDefaultFormConfig(),
  }
}

export const FIXTURE_BUILDERS: Record<'F-wizard' | 'F-order' | 'F-detail', () => FixtureFormJson> = {
  'F-wizard': buildFWizard,
  'F-order': buildFOrder,
  'F-detail': buildFDetail,
}

export function loadInteractionFixture(id: 'F-wizard' | 'F-order' | 'F-detail'): FixtureFormJson {
  return FIXTURE_BUILDERS[id]()
}
