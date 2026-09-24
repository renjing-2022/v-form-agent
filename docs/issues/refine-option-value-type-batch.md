# Issue：refine 无法批量将选项值类型设为 Number

| 项 | 内容 |
|---|---|
| 文档 ID | `refine-option-value-type-batch` |
| 类型 | issue-report |
| 关联版本 | `v0.9.x` refine |
| Repair Case | `.deliveryguard/repairs/refine-option-value-type-batch.json` |
| 分类 | code |

## 现象

用户对含多个 radio/select 的表单说「所有选项的选项值类型定义为 number / 数字类型」时，Agent 判定走 `/refine`，但返回：

`pathPrefix "widgetList" 命中多个节点`

选项值类型未写入，设计器侧仍为空或字符串。

## 期望

1. 整表（或带 `filterType`）批量更新 `optionValueType` 时，`parent.pathPrefix: "widgetList"` 视为根 scope，不得因多节点命中而 422。
2. NL/模型口语值 `number` / `string` / `数字` 归一为设计器合法字面量 `Number` / `String`。
3. 写入 `optionValueType` 时联动转换 `optionItems[].value`（并清空不兼容默认值），行为对齐设计器 `handelValueTypeChange`。

## 根因

1. `validatePlanTargets` 对 `updateFieldsInScope.parent` 使用 `resolveTarget`，`pathPrefix: "widgetList"` 命中全部根路径节点 → ambiguous。
2. `resolveScopeFields` 仅用 `prefix.` 续接，对根 `widgetList` 无法选出 `widgetList[i]` 下字段。
3. 规划提示与同义词层未覆盖 `optionValueType`；合入层未联动转换选项值。

## 实现落点

| 层 | 位置 |
|---|---|
| 目标 / scope | `agent/src/services/targetResolver.ts` |
| NL 归一 | `agent/src/services/nlSynonymNormalize.ts` |
| 合入联动 | `agent/src/services/refineMerger.ts` |
| 规划提示 / 启发式 | `agent/src/services/refinePlanner.ts`、`catalogContext.ts` |
| 复现 / 验收 | `agent/scripts/repair-option-value-type.ts`、`acceptance-cases.ts` |
