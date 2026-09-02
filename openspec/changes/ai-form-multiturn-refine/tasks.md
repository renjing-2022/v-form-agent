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

再生：`cd e2e && npm test`（`EVIDENCE_VERSION=v0.2.0`）；Agent：`cd agent && npm run acceptance:cases`。

| case-id | Requirement id(s) | Type | Verification notes | Exploratory? | Status |
|---|---|---|---|---|---|
| `agent-health` | `td-refine-endpoint` | api/static | health + refine 注册 | no | verified |
| `text-generate-apply` | `FR-1` `FR-5` | playwright | 空画布生成并确认应用 | no | verified |
| `refine-multiturn-apply` | `FR-2` `FR-5` | playwright | 两轮 refine 后应用到画布 | no | verified |
| `refine-structure-tab` | `FR-3` | playwright | wrapInTabs 后画布出现 tab | no | verified |
| `refine-options-formula` | `FR-3` `FR-4` | playwright | options/公式优化后可见 | no | verified |
| `refine-reject-keeps-canvas` | `FR-5` | playwright | refine 422 不改写画布 | no | verified |
| `agent-smoke-refine` | smoke | smoke | `npm run smoke` / acceptance:cases | no | verified |
| `frontend-no-secret` | `td-security-boundary` | static | 前端无 DeepSeek Key / PAT | no | verified |

### Candidate rules

1. Prefer reusing existing Manifest case-ids when the requirement is unchanged (`Status: reuse`).
2. New UI case-ids must be added to `.agents/skills/deliveryguard-e2e/references/case-map.md` when implemented.
3. If exploratory finds a bug that becomes a new case, append a row to `docs/e2e/promotion-log.md` when the Playwright case lands.
4. Do not check a candidate as `verified` until evidence exists and `deliveryguard acceptance validate` is clean for in-scope updates.
5. Manifest `acceptance.status=passed` 仍受 source=`submitted|merged` 门禁约束；当前 source 若为 `local` 则版本 acceptance 保持 `pending`。
