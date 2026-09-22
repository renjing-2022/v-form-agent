# Tasks: ai-form-event-interaction-js

有序、可验证任务。**仅在实现与相关检查实际完成后勾选。**

本变更 **不含** JS 生成、AST 合入闸、merger 写事件、Playwright 执行断言。那些属于后续版本；本文件出现「后续版」字样的条目 **不要在 v0.7 勾选**。

## 产品硬门槛

1. `/refine` 事件禁写语义不变；
2. `/event` 只澄清或产出 EventSpec，**不写** `on*` / `functions`；
3. 不完备不得 `spec_ready`；`spec_ready` 不得声称已应用 JS；
4. 接口类在澄清阶段拒绝；纯前端键（含 created/mounted、子表行）可出 EventSpec，本版仍不写；
5. v0.6 / strict-sweep / frontend-no-secret 不回退。

---

## 交付物 0：基线（决策已锁定，实现时复核）

- [x] 确认 `v0.6.0` acceptance / `ai-form-v060.spec.ts` 可复跑
- [x] 文档与代码范围一致：新端点；纯前端事件预留 v0.8；接口类 never；本版无生成/合入

## 交付物 1：事件 shape 登记

- [x] 从运行时真源提取 `(type, eventKey) → params[]`（`fieldMixin.js` / dialog / drawer / sub-form 等）
- [x] shape 生成物含 `thisApiAllowlist`、`intentTags`、`writableIn`（v0.7 无写权限）
- [x] `onCreated`/`onMounted`/`onSubFormRow*` 登记且 `writableIn=v0.8+`；`onRemoteQuery`/上传族 `never`
- [x] `catalog:check` 增加签名 parity；**不**把事件键移出 `forbiddenKeys`
- [x] static case `event-shape-registry-parity`

## 交付物 2：`POST /api/agent/v1/event` 澄清闭环

- [x] `agent/src/schemas/eventSpec.ts`：EventSpec、questions、`need_clarification` / `spec_ready`
- [x] `agent/src/routes/event.ts` 注册；不完备 = 200 + `need_clarification`；危险/歧义 422
- [x] `eventPlanner.ts`：意图分类、缺口、定向问题；mock 覆盖测试指令；**禁止输出事件代码**
- [x] 响应中的 `formJson`（若返回）事件键与输入一致且为空或保持原空
- [x] case `event-clarify-incomplete-intent`
- [x] case `event-clarify-complete-to-spec`
- [x] case `event-clarify-danger-reject`
- [x] case `event-clarify-lifecycle-spec`
- [x] case `event-clarify-subform-row-spec`
- [x] case `event-endpoint-does-not-write-onstar`

## 交付物 3：前端分流

- [x] `v-form/src/api/chat` 增加 event 客户端
- [x] `AiChat`：交互意图走 `/event`；渲染 questions；messages 续传；`spec_ready` 只展示摘要
- [x] **无**「确认写入事件代码」按钮；不得因 spec_ready 调用 `loadFormJson` 改事件键
- [x] 结构/属性/formula 仍走 `/refine`

## 交付物 4：Acceptance + 回归

- [x] `event-refine-still-forbids-events`（经 `/refine` 仍 strip/reject 事件）
- [x] **保留** `refine-dialog-event-forbid` 期望（不改写为可落地）
- [x] `refine-v06-regression`
- [x] `catalog-full-strict-sweep`（含于 acceptance:cases / catalog:check）
- [x] `frontend-no-secret`（acceptance:cases 既有）
- [x] `e2e` mock：`event-clarify-ui` / `event-clarify-complete-ui` / `event-refine-route-still-works`（问题可见，不触发事件运行时）
- [x] `.deliveryguard/acceptance/v0.7.0/evidence.json`
- [x] `docs/acceptance/v0.7.0.md`

---

## 明确不属于本文件的后续版工作（不要勾选）

- `eventPlanner` 生成 JS；`eventJsGuard.ts`
- merger 写 `on*` / `functions`；反转 `catalogValidator` 空串规则
- Playwright **真实渲染执行** `examples` 断言；`applied` 闸
- 改写 `refine-dialog-event-forbid` 为允许集可落地

---

## 完成定义（DoD）

**实现切片 Done：** 交付物 0–4（含 E2E）已绿；事件合入层仍禁写。  
**DeliveryGuard：** 证据与报告已写入；`acceptance.status=pending`（闸：`acceptance.before-source`，须先提交并登记 `sources`）；`release=pending`。

## Acceptance 表

| case-id | Requirement | 运行时执行 | status |
|---|---|---|---|
| `event-clarify-incomplete-intent` | FR-1 | no | pass (agent evidence) |
| `event-clarify-complete-to-spec` | FR-1 | no | pass |
| `event-clarify-danger-reject` | FR-1 | no | pass |
| `event-clarify-lifecycle-spec` | FR-1 | no | pass |
| `event-clarify-subform-row-spec` | FR-1 | no | pass |
| `event-endpoint-does-not-write-onstar` | FR-1 | no | pass |
| `event-shape-registry-parity` | FR-2 | no | pass |
| `event-refine-still-forbids-events` | regression | no | pass |
| `refine-dialog-event-forbid` | regression | no | pass |
| `refine-v06-regression` | regression | no | pass |
| `catalog-full-strict-sweep` | regression | no | pass |
| `frontend-no-secret` | security | no | pass |
| `event-clarify-ui` | FR-3 | no | pass (E2E) |
| `event-clarify-complete-ui` | FR-3 | no | pass (E2E) |
| `event-refine-route-still-works` | regression | no | pass (E2E) |
