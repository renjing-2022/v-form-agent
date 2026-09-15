# Issue：refine Catalog 用出厂默认类型误伤合法 defaultValue

| 项 | 内容 |
|---|---|
| 文档 ID | `refine-catalog-defaultvalue-false-positive` |
| 类型 | issue-report |
| 关联版本 | `v0.3.0`（Catalog 整表校验） |
| Repair Case | `.deliveryguard/repairs/refine-catalog-defaultvalue-false-positive.json` |
| 分类 | code |

## 现象

用户仅请求布局/对齐（例如「字段对齐居中」）时，若画布上已有 radio/select 等控件带合法 `defaultValue`（如选中分值 `1`），refine 合入后整表 Catalog 校验失败，返回类似：

`option "defaultValue" value does not match catalog constraint`

体感上像「必须先清空默认选项才能改对齐」，业务上二者无关。

## 期望

1. 仅改 `formConfig.labelAlign` / 字段 `labelAlign` / 受控 CSS 时，未触及的合法 `defaultValue` 不得阻断。
2. Catalog 对出厂为 `null`/`undefined` 的键，应允许运行时常见标量值（string/number/boolean），不得把「出厂空值」当成「永远只能为空」。
3. 禁写事件、危险 CSS、未知键等真实护栏保持有效。

## 根因

1. Catalog 从 `widgetsConfig` 默认 options 推断 `radio.defaultValue` 为 `valueType: "undefined"`。
2. `validateFormJson(mode: 'refine')` 对整棵控件树做类型对齐，含本轮未改字段。
3. `catalogValidator` 要求运行时类型与出厂类型完全一致；而 `refinePropertyPolicy` 对 `null`/`undefined` 出厂类型已放宽标量——两处不一致。

## 实现落点

| 层 | 位置 |
|---|---|
| 共享约束匹配 | `agent/src/knowledge/widgetCatalog.ts`（`valueMatchesConstraint`） |
| 整表校验 | `agent/src/services/catalogValidator.ts` |
| patch 消毒 | `agent/src/services/refinePropertyPolicy.ts` |
| 复现 / 验收 | `agent/scripts/repair-catalog-defaultvalue.ts`、`agent/scripts/acceptance-cases.ts` |
