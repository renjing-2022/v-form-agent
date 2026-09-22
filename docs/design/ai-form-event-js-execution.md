# 技术设计：交互执行面第二刀 — 受约束 JS + 真实渲染 applied（v0.8.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-event-js-execution-design` |
| 类型 | technical-design |
| 目标版本 | `v0.8.0` |
| 修订 | 2（与 PRD 同步：纯前端事件全覆盖；生命周期用预览装载触发） |
| 关联 PRD | `docs/requirements/ai-form-event-js-execution.md` |
| 关联 OpenSpec | `ai-form-event-js-execution` |
| 前置契约 | v0.7 `EventSpec` / event shape / `POST /api/agent/v1/event` |

## 1. 目标

把 v0.7 的 EventSpec 变成可合入、可验证的事件 JS。不变量：**没有真实 VForm 对 examples 的通过报告，不得 `status=applied`。**

## 2. 状态机（扩展同一端点）

`POST /api/agent/v1/event`

| action | 前提 | 成功 status |
|---|---|---|
| （默认 / clarify） | 同 v0.7 | `need_clarification` / `spec_ready` |
| `generate` | 完备 EventSpec | `code_preview`（含 `patches`/`formJsonCandidate`/`code`）或护栏失败 422 |
| `apply` | `code_preview` + `executionReport.pass===true` 且 report 覆盖全部 examples | `applied` + 可写回的 `formJson` |
| `apply` 缺报告或 fail | — | `draft` 或 422，事件键不写 |

`executionReport` 建议：

```text
{
  runner: 'designer-preview' | 'playwright',
  results: [{ exampleIndex, ok, actual, error? }],
  pass: boolean
}
```

Agent 校验：example 条数一致、全部 ok、runner ∈ 允许集。不信任客户端改 `pass` 而 results 失败——以 results 为准。

## 3. 生成

- 输入：EventSpec + formSummary + 对应 EventShape（params / thisApiAllowlist）。
- 输出：单一或少数 `setEvent` / `setFunctions` 补丁，不是整表自由 JSON。
- mock：对 acceptance 指令吐出固定、可过护栏且能满足该条 example 的 JS。
- formula 可表达的 number 计算：generate 返回 422，提示走 `/refine`。

## 4. `eventJsGuard.ts`

执行与合入之前：

1. acorn/espree parse；
2. 标识符/Member/Call 白名单 = shape.thisApiAllowlist ∪ `{ Math, String, Number, Date, Array, JSON, parseInt, parseFloat, isNaN, undefined, null }` 等明示列表；
3. 字符串字面量中的字段名若作为 `setFieldValue('x')` 第一参，须存在于 formJson；
4. 禁止构造表（PRD FR-2）命中即 fail；
5. 长度上限。

`catalogValidator`：allowed-event 非空字符串必须能通过同一 guard（或合入路径已证明）；其它事件键仍 empty。

## 5. 真实渲染：产品闸 vs 验收闸

### 5.1 产品（设计师预览）

- `code_preview` 后，前端把 `formJsonCandidate` 载入**现有预览/运行态**（VFormRender，非设计态 `designState`——设计态本来不触发 `new Function`）。
- 按 example 触发：
  - `onChange`/`onClick` 等：置值或点击；
  - **`onCreated`/`onMounted`/`onFormCreated`/`onFormMounted`：装载预览并等待 mounted 即算触发**；
  - 子表行事件：在预览里增/插/删行。
- 读 `getFieldValue`、hidden、dialog 可见性，汇总 `executionReport` 后再 `action=apply`。
- 未跑预览：apply 拒绝。

注意：`fieldMixin.handleOnChange` 在 `designState` 下直接 return。验证必须在 **render/preview**，不能在设计画布空点。

### 5.2 验收（Playwright）

- `e2e/tests/ai-form-v080.spec.ts`：真实打开应用 → 走聊天/或直接打 `/event` 后载入预览 → 触发 → 断言 DOM/值 → 确认写入。
- `AGENT_ALLOW_MOCK=1` 只 mock **生成**；**执行必须真实**（页面里真的跑 `new Function`）。
- 禁止单独用 Node 里假 `this` 绿掉 acceptance。

### 5.3 明确不做

Agent Fastify 进程内 `playwright.chromium.launch()` 作为每次 generate 的同步闸——超时、权限、部署形态都不适合本仓库当前 agent。

## 6. 合入

- 新模块或扩 merger：`applyEventPatches(formJson, patches)`，只写 allowed 键。
- 已有非空：无 `confirmOverwrite` → reject。
- IntentGate 等价：`applied===true` 当且仅当目标键相对输入发生变化 **且** report.pass。
- `/refine` 的 planner 仍禁止 on* / functions。

## 7. Catalog breaking

- shape.`writableIn`：所有纯前端 EVENT_PROPERTIES + `onForm*` 从预留改为 `v0.8`；接口类保持 `never`；
- `isForbiddenWidgetKey`：allowed-event 在 **event 合入路径**放行，refine 路径仍禁；
- 实现上优先：**按路由分流**（refine 全禁事件；event apply 只放行 allowlist），避免 refine 模型又开始吐 onClick。

## 8. Affected contracts

| 契约 | 路径 | 变更 |
|---|---|---|
| `/event` | `agent/src/routes/event.ts` | generate / apply + executionReport |
| 生成 | `eventPlanner.ts` 或 `eventCodegen.ts` | EventSpec → JS |
| 护栏 | `eventJsGuard.ts` | 新建 |
| 合入 | `eventMerger.ts` 或 `refineMerger.ts` 隔离函数 | 只被 `/event` apply 调用 |
| 校验 | `catalogValidator.ts` / `identityForbiddenPolicy.ts` | allowed 可非空 |
| 前端 | `AiChat` + preview runner | 预览执行 + 带 report 的 apply |
| Playwright | `e2e/tests/ai-form-v080.spec.ts` | 真实触发证据 |
| acceptance-cases | `agent/scripts/acceptance-cases.ts` | 新 case + 改写 dialog 事件负例 |

## 9. Risks

| 风险 | 缓解 |
|---|---|
| 客户端伪造 `pass` | Agent 重算 pass=every(results.ok)；可要求 actual 快照结构 |
| 在设计态验证导致「永远不触发」 | 文档+代码强制 preview/render；e2e 也走预览 |
| 预览与 Playwright 选择器漂移 | 共用 example oracle 与同一套 trigger helper |
| 范围滑向网络 JS | 护栏负例锁定；writable 名单封闭 |
| 覆盖用户手写 | 显式 confirmOverwrite |
| v0.7 未完成就开写 | 本版实现前提：EventSpec 契约已存在 |

## 10. 实现前提与顺序

1. v0.7 `/event` clarify + shape parity 已在本仓库可运行（建议 v0.7 acceptance passed）；
2. 再实现 guard → codegen → preview runner → apply → Playwright。

OpenSpec 勾选 ≠ 已实现 ≠ 已验收 ≠ 已发布。
