# 技术设计：v-form AI 多轮表单优化（v0.2.0 / P0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-multiturn-refine-design` |
| 类型 | technical-design |
| 目标版本 | `v0.2.0` |
| 关联 PRD | `docs/requirements/ai-form-multiturn-refine.md` |
| 关联 OpenSpec | `ai-form-multiturn-refine` |

## 1. 设计目标

在不破坏 v0.1.0 整表生成闭环的前提下，增加「基于当前画布 formJson 的多轮优化」能力，P0 覆盖结构、options 与公式；CSS / 自由事件 JS 留到后续阶段。

## 2. 总体架构

```text
[ AiChat 多轮 UI（前端内存 session） ]
   |  每轮：messages + getFormJson() + instruction
   v
[ agent  refine / generate ]
   1) 意图路由：generate（空表/整表）| refine（已有表）
   2) 规划：模型产出受限变更计划（非自由写画布）
   3) 合入：对 currentFormJson 应用变更（保留未改 id/name）
   4) 校验：结构 / 类型白名单 / name / 嵌套形状 / 公式字段
   v
[ { formJson, summary, warnings[] } ]
   v
[ 用户确认 ] -> designer.loadFormJson(formJson)  // 整表覆盖
```

### 关键原则

1. **每轮真相源是前端最新 `getFormJson()`**，不以服务端缓存表单为准。
2. **模型负责理解与规划，代码负责合入与校验**（延续 MVP）。
3. P0 **优先 formula**，不开放自由 `onChange` / `cssCode` 作为验收路径。
4. 生成入口保留：空画布或显式「重新生成」走既有 generate。

### 规划器文案策略（FR-6 技术落点）

| 用户意图 | 允许的操作 | 禁止 |
|---|---|---|
| 明确改文案/标题/选项文字 | `updateField.patch.label` / `textContent` / `optionItems` | — |
| 改选项分值/分制（业务配置） | `optionItems`（value + label 若用户要求） | 无明确 options 意图时改 label 冒充布局修复 |
| 样式/布局/重叠/间距/颜色/字体 | `warnings` 说明 P0 无 CSS；结构/tab/公式若相关 | **仅**改 label/textContent/option label 使视觉「变好」 |
| 结构/tab/公式 | `wrapInTabs` / `addField` / `setFormula` | 顺带改未提及字段文案 |

实现：

1. **Planner system prompt**（`refinePlanner.ts`）写入上述规则；
2. **代码兜底** `enforceRefineTextPolicy(instruction, plan)`：样式意图且无明确改文案/选项意图时，剔除 copy 类 `updateField.patch`；若剔除后无可应用 op → **422** + warnings；
3. Issue / Repair：见 `docs/issues/refine-no-text-for-style.md`、`.deliveryguard/repairs/refine-text-style-workaround.json`。

## 3. API 契约（P0）

### 方案（二选一，实现时定一）

**推荐**：新增 `POST /api/agent/v1/refine`

```json
{
  "instruction": "给表单加两个 tab：基本信息 / 评估题目",
  "currentFormJson": { "widgetList": [], "formConfig": {} },
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

成功响应与 generate 对齐：

```json
{
  "summary": "已将题目归入「评估」tab，并新增总分公式字段",
  "warnings": [],
  "formJson": { "widgetList": [], "formConfig": {} }
}
```

`POST /api/agent/v1/generate` 保持兼容，供空画布整表生成 / Excel。

## 4. 组件知识与白名单

- 从 `widgetsConfig.js` 抽取/维护扩展白名单与默认模板（P0 至少覆盖：现有字段类型 + `tab` / `tab-pane` + 必要的 `grid` / `grid-col`）。
- 容器嵌套按模板形状组装（例如 `tab.tabs[]` 内为 `tab-pane`）。
- 未纳入 P0 白名单的重型容器（如复杂 `data-table`）遇到需求时：`warnings` 说明未支持，不得返回半合法树。

## 5. 合入与保留策略

1. 以 `currentFormJson` 深拷贝为基底。
2. 按变更计划定位节点（优先 `id`，其次 `options.name`）。
3. 未提及的节点原样保留（含用户手改 options）。
4. 结构变更（包裹 tab、移动字段）做显式树手术，禁止全量 FieldPlan 有损重生成作为唯一路径。
5. 公式：对目标字段设置 `formulaEnabled` / `formula`，表达式需通过基础校验（引用 name 存在等，能做多少做多少；不确定则 warning）。

## 6. 前端改造点

| 位置 | 改动 |
|---|---|
| `AiChat` | 多轮消息列表；前端内存 session；区分生成 / 优化提交 |
| 设置面板桥接 | 每轮取 `designer` 最新 JSON（`getFormJson` 或等价）传入 Agent |
| 应用 | 仍需确认；文案标明将整表覆盖 |
| API 模块 | 新增 `refineFormByAgent`；保留 `generateFormByAgent` |

会话：刷新即清空即可；不写 localStorage（P0）。

## 7. 明确不做（P0 实现边界）

- 自动生成 `formConfig.cssCode` 与通用事件脚本；
- Agent 侧 session 持久化；
- 用未校验的模型完整 formJson 直接替换合入结果；
- 一次承诺全量 widgetsConfig 中每一个冷门组件（按白名单渐进）。

## 8. 测试与验收设计

1. **生成回归**：空画布文本生成仍可用。
2. **多轮 refine**：已有表上两轮指令，第二轮基于更新后的画布 JSON。
3. **结构**：至少一次 tab（或等价容器）变更可应用。
4. **options + formula**：选项变更与公式字段可应用或可解释降级。
5. **负例**：非法结果 / 校验失败不覆盖画布。

浏览器验收延续 `e2e/` Playwright + `case-id` → `docs/evidence/v0.2.0/`；propose 时在 `tasks.md` 写入 Acceptance candidates。

## 9. 后续阶段预告（非本版验收）

- **P1**：受控 CSS / 事件脚本（语法检查 + 签名约束 + 风险提示）。
- **P2**：更重型容器与服务端会话等。
