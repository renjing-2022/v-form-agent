# Issue：交互预览对 static-text「小计」断言永久失败，修正轮空转

| 项 | 内容 |
|---|---|
| 文档 ID | `interaction-static-text-observe` |
| 类型 | issue-report |
| 关联版本 | `v0.9.x` NL interaction |
| Repair Case | `.deliveryguard/repairs/interaction-static-text-observe.json` |
| 分类 | code |

## 现象

用户要求各 tab「小计」= 该 tab 内选项分值之和。Excel 生成的小计多为 `static-text`。交互管线生成 `onFormDataChange` 代码并用 `getWidgetRef(...).setValue('小计: N')`，预览四场景全部「断言失败」，自动修正 2/2 仍不过，无法确认写入。

## 期望

1. 预览断言能观测 `static-text` 展示内容（`textContent`），不得只读 `getFieldValue`。
2. API 手册/生成/修正提示明确：`static-text`/`html-text` 的 `formItemFlag=false`，`setValue` 为空操作，应 `setWidgetOption('textContent', ...)`。
3. 修正轮最多 2 次是产品上限；根因未消之前不得假装「已兼容 setValue」。

## 根因

1. **机制：** generate → 合入候选 formJson → 隐藏 VFormRender 预览跑 scenarios → 失败则 repair（最多 2 轮，scenarios 指纹锁定）→ 仍失败则卡住。
2. **首失败边界：** `interactionRunner.readActual` 对 `{field,value}` 只调用 `getFieldValue` → `getValue()` → `fieldModel`。
3. **`static-text`：** `formItemFlag: false`，`setValue` 在 `fieldMixin` 内直接跳过，展示走 `options.textContent`。断言永远读不到期望字符串。
4. **修正空转：** repair 只改 handlers、禁止改 scenarios；模型在错误 API（setValue）上反复改写，轮次用尽。

## 实现落点

| 层 | 位置 |
|---|---|
| 观测 | `v-form/src/utils/interactionObserve.ts`、`interactionRunner.ts` |
| 手册 | `agent/src/knowledge/interactionApiReference.ts` |
| 生成/修正提示 | `interactionGenerator.ts`、`interactionRepair.ts` |
| 复现 | `agent/scripts/repair-static-text-observe.ts` |
