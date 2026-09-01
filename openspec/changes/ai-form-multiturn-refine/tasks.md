# Tasks: ai-form-multiturn-refine

有序、可验证任务。完成一项再勾选一项；未完成前不得提前勾选。

## 1. 契约与知识层

- [x] 定义 refine 请求/响应 Zod schema（`instruction`、`currentFormJson`、`messages`、`summary`/`warnings`/`formJson`）
- [x] 扩展组件白名单与默认模板：在 MVP 字段基础上增加 `tab` / `tab-pane` 及合入所需的 `grid` / `grid-col`（对齐 `widgetsConfig.js`）
- [x] 实现/扩展 formJson 校验：嵌套容器形状、name 唯一、公式字段基础约束、数量/深度上限

## 2. Refine 合入链路

- [x] 实现基于 `currentFormJson` 的受限变更规划（模型）+ 代码合入（保留未改 `id`/`name`）
- [x] 支持结构变更（至少：增加 tab 并迁移/归类字段）与 options 变更
- [x] 支持适用字段的 `formulaEnabled` / `formula` 设置；无法落地时写入 `warnings`
- [x] 打通 `POST /api/agent/v1/refine`，本地用「已有表 + 两轮指令」冒烟通过校验

## 3. 生成入口兼容

- [x] 确认 `POST /api/agent/v1/generate`（text/excel）行为不被破坏；空画布路径仍可用
- [x] 前端保留整表生成入口，并与优化模式路由清晰可辨

## 4. 前端多轮会话与回填

- [x] AiChat：前端内存多轮消息；每轮提交附带设计器最新 `getFormJson()`
- [x] 展示 summary/warnings；确认后整表 `loadFormJson`；文案提示将覆盖当前表
- [x] 校验失败或请求失败时不写画布

## 5. 验证与收口

- [x] 补充 agent 侧冒烟/单测覆盖 refine 合入与校验失败路径
- [x] 按 Acceptance candidates 落地证据目录 `docs/evidence/v0.2.0/`（实现后）
- [x] 更新启动/使用说明中与「多轮优化」相关的简短说明

## Acceptance candidates

Planned proof for this change. Status values: `planned` | `reuse` | `implemented` | `verified` | `deferred`.
Only Playwright (or other non-exploratory) runs that write `docs/evidence/<version>/<case-id>.*` may move a UI case to `verified`.
agent-browser output under `docs/exploratory/` is discovery only.

本轮按产品要求**不跑 Playwright**；原 playwright 候选改为 `api+static` / `api+smoke` 取证，证据见 `docs/evidence/v0.2.0/<case-id>.txt`。再生：`cd agent && npm run acceptance:cases`。

| case-id | Requirement id(s) | Type | Verification notes | Exploratory? | Status |
|---|---|---|---|---|---|
| `agent-health` | `fr-1` (v0.1 reuse) | api | health 路由 + refine 注册；`docs/evidence/v0.2.0/agent-health.txt` | no | verified |
| `text-generate-apply` | `FR-1` 生成入口 | api+static | generate 管道 + AiChat 显式 apply 接线；Playwright deferred | no | verified |
| `refine-multiturn-apply` | `FR-2` `FR-5` | api+static | 两轮 refine 合入成功；UI 仍需确认 apply | no | verified |
| `refine-structure-tab` | `FR-3` | api+smoke | wrapInTabs + 字符串 targets 归一化 | no | verified |
| `refine-options-formula` | `FR-3` `FR-4` | api+smoke | 第二轮 options/公式 | no | verified |
| `refine-reject-keeps-canvas` | `FR-5` | api+static | 非法新建类型校验拒绝 + 无 lastResult 不可 apply | no | verified |

### Candidate rules

1. Prefer reusing existing Manifest case-ids when the requirement is unchanged (`Status: reuse`).
2. New UI case-ids must be added to `.agents/skills/deliveryguard-e2e/references/case-map.md` when implemented.
3. If exploratory finds a bug that becomes a new case, append a row to `docs/e2e/promotion-log.md` when the Playwright case lands.
4. Do not check a candidate as `verified` until evidence exists and `deliveryguard acceptance validate` is clean for in-scope updates.
5. 本 change 明确延后 Playwright；上述 `verified` 仅表示非 UI E2E 证据已落盘，**不等于** DeliveryGuard Manifest `acceptance.status=passed`。
