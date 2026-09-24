# 技术设计：交互执行面第一刀 — 事件 shape 登记 + 澄清闭环（v0.7.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-event-interaction-js-design` |
| 类型 | technical-design |
| 目标版本 | `v0.7.0` |
| 修订 | 4（2026-09-24：后续版 `v0.8.0` 已 released，不再写 proposed） |
| 关联 PRD | `docs/requirements/ai-form-event-interaction-js.md` |
| 关联 OpenSpec | `ai-form-event-interaction-js` |

## 1. 设计目标

在 v0.6 基线上增加**平行于 refine 的事件意图管线（仅澄清 + 知识）**：

1. 从 v-form 运行时真源登记事件 shape；
2. 新端口产出完备 EventSpec 或定向追问；
3. **不**生成 JS、**不**合入事件键、**不**跑执行 harness。

后续版 `v0.8.0`（`ai-form-event-js-execution`，已 released）再接：EventSpec → 受约束生成 → AST 护栏 → 设计器真实预览执行 + Playwright 验收 → 合入 / applied。

## 2. 拍板锁定（原开放问题）

| # | 决策 | 本版含义 |
|---|---|---|
| 1 | 新端点 `POST /api/agent/v1/event` | 不扩 `refine.ts` 的 op 表；refine 仍禁止事件 |
| 2 | 纯前端事件（含 `onCreated`/`onMounted`/`onSubFormRow*`）预留 v0.8 可写；接口类 never | shape 全量登记；本版仍不合入 |
| 3 | 执行验收用 Playwright 真实渲染 | **本版不实现 harness**；后续版不得改用 Node mock-this 冒充验收 |
| 4 | 拆版 | 本变更只含知识 + 澄清；生成/护栏/合入/执行 = 下一 OpenSpec / 下一版本 |

## 3. 本版流水线

```text
NL + currentFormJson + messages
 → POST /api/agent/v1/event
 → 意图分类（交互 vs 应走 /refine；危险/网络 vs 可澄清）
 → 缺口检测（触发 / 事件键 / 目标字段 / 落点 / 覆盖意向 / 可判定示例）
 → 不完备 → 200/422 策略见下：status=need_clarification + questions[]
 → 完备 → status=spec_ready + EventSpec（含 examples[]）
 → formJson 原样返回或省略；事件键不得被填写
```

`/refine` 保持现有「结构化 op → merger → IntentGate」。事件 JS 对 refine 仍是不透明且禁止的 blob。

## 4. 事件 shape 登记

### 4.1 真源

运行时事件体来自 `new Function(paramNames..., code).call(this)`，例如：

- `fieldMixin.js`：`onChange(value, oldValue)`；`onClick()`；
- dialog / drawer：`onOkButtonClick` / `onCancelButtonClick`（无参或固定参，以源码为准）；
- `sub-form-item.vue`：`onSubFormRow*`（本版登记，`writableIn=v0.8`）；
- 生命周期：`onCreated` / `onMounted` / `onFormCreated` / `onFormMounted`（同样预留 v0.8）。

提取脚本应对每个 `(type, eventKey)` 记录 `params[]`，禁止只按 key 名猜测（同一 key 在不同 type 上可能不同）。

### 4.2 建议结构（实现以 schema 为准）

```text
EventShape {
  owner: { kind: 'widget' | 'form', type?: string }
  key: string                  // onChange / onFormValidate / ...
  params: string[]
  thisApiAllowlist: string[]   // getFormRef, setFieldValue, ...
  intentTags: string[]
  writableIn: 'never' | 'v0.8+'  // v0.7 不得出现 'v0.7'
}
```

`thisApiAllowlist` 本版只登记、不执行。后续版 AST 护栏直接消费该表。

### 4.3 Catalog 策略（本版不开放写）

- `isEventKey` 仍参与 `isForbiddenWidgetKey` / `isForbiddenFormKey`；
- `catalogValidator` **继续**拒绝非空事件字符串与非空 `functions`；
- `generateWidgetCatalog` 的「defaults 含 on* 则 forbiddenKeys 必须暴露」**保持**；
- 新增独立 shape 表（生成物或 `event-shape.json`），`catalog:check` 增加 parity，而不是把事件挪进 `writableKeys`；
- `writableIn`：纯前端 = `v0.8+`；`onRemoteQuery` 与上传族 = `never`。

## 5. EventSpec 契约（本版产物）

```text
EventSpec {
  trigger: { widgetRef, eventKey }     // 必须能在当前 formJson 唯一解析
  sink: { kind: 'widget-event' | 'form-event' | 'functions', ... }
  overwritePolicy: 'reject-if-present' | 'overwrite-if-confirmed'  // 预留给后续合入
  examples: [{ given: {...}, expect: {...} }]   // ≥1；本版不执行
  notes?: string[]
}
```

定位规则对齐 refine：`id` > `name` > `label`，歧义则继续澄清而非猜。

`sink.kind = functions` 允许在 Spec 里声明「后续应抽到全局函数」；本版仍不写 `formConfig.functions`。

## 6. 路由与前端

| 契约 | 路径 | 本版变更 |
|---|---|---|
| 新路由 | `agent/src/routes/event.ts` | `POST /api/agent/v1/event` |
| EventSpec schema | `agent/src/schemas/eventSpec.ts` | `need_clarification` / `spec_ready` |
| 澄清规划 | `agent/src/services/eventPlanner.ts` | 意图分类 + 缺口 + 问题；**不输出 JS** |
| shape 知识 | `agent/src/knowledge/` 新模块 + 生成物 | 从运行时提取；catalog:check |
| refine | `agent/src/routes/refine.ts` 等 | **不改事件禁写语义** |
| 前端客户端 | `v-form/src/api/chat/index.ts` | 新增 `eventFormByAgent`（名以实现为准） |
| 前端 UI | `v-form/src/components/AiChat/index.vue` | 展示 questions；续传 messages；spec_ready 只展示摘要 |

路由注册须挂到现有 Fastify app（与 generate/refine 并列）。

澄清与 refine 的分流：指令明显是结构/属性/formula → 前端仍调 `/refine`；明显是联动/事件/规则交互 → `/event`。边界模糊时：**宁可澄清「这是改属性还是写交互」**，不要在 `/event` 里偷偷做 refine op。

HTTP：不完备澄清用 **200 + `status: need_clarification`**（会话继续），避免前端把追问当成失败；危险能力 / 歧义无法唯一 target 可用 422。实现时在 tasks 里固定，acceptance 按此断言。

## 7. 明确不在本变更实现

以下文件/能力写入后续 OpenSpec，本版 tasks **不得**勾选为完成：

- `eventJsGuard.ts`（AST 白名单合入闸）
- `eventExecutionHarness.ts` / `e2e/tests/ai-form-v070.spec.ts` 的**执行触发断言**
- `refineMerger` 写 `on*` / `functions`
- `catalogValidator` 反转「事件必须为空」
- 真实 LLM 生成 JS

后续版硬约束（本设计预先锁定，避免回退）：

- 执行验收 = Playwright 真实 VForm 渲染，不用 Node mock-this 当 acceptance；
- 静态护栏必须前置于执行；
- 仅执行断言通过才可 `applied`；
- 危险能力仍整类拒绝。

## 8. Risks

| 风险 | 缓解 |
|---|---|
| 话术把 EventSpec 说成「已写好交互」 | PRD §8；summary 禁用「已更新事件/已应用 JS」 |
| shape 签名与真源漂移 | 提取脚本 + catalog:check；不确定的 key 只登记、标需人工核对 |
| 前端误调 `/event` 并 `loadFormJson` | v0.7 响应不得携带填写后的事件键；UI 无「应用到画布」 |
| 澄清死循环 | 问题上限 + 重复缺口检测；超限 422 |
| `/event` vs `/refine` 抢意图 | 分类规则 + case：结构指令走 refine；交互走 event |
| 范围悄悄滑向生成 JS | tasks 无生成交付物；acceptance 断言事件键仍空 |

## 9. 后续版预告（非本版任务）

`v0.8.0` 已登记（`openspec/changes/ai-form-event-js-execution`）：消费本版 EventSpec → 生成受约束 JS → `eventJsGuard` → 设计器真实预览按 `examples` 断言 → 通过才合入 **全部纯前端事件键**（含生命周期与子表行）及纯前端 `functions`。接口类仍禁写。

## 10. Out of scope reminder

OpenSpec 勾选 ≠ source merged ≠ acceptance passed ≠ release。v0.7 验收通过只证明「问得清、登记得对」，不证明「交互能跑」。
