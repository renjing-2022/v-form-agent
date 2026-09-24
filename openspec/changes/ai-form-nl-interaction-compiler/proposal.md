# Proposal: ai-form-nl-interaction-compiler

| 项 | 值 |
|---|---|
| Change ID | `ai-form-nl-interaction-compiler`（名称沿用；语义已改为「模型直出 JS」，不含 DSL 编译器） |
| Target version | `v0.9.0` |
| Primary document | `docs/requirements/ai-form-nl-interaction-compiler.md`（revision 4） |
| Supporting design | `docs/design/ai-form-nl-interaction-compiler.md`（revision 3） |
| Acceptance bank | `openspec/changes/ai-form-nl-interaction-compiler/scenarios.md`（用户已审阅） |
| Affected repository | `app`（`.`） |
| Predecessor | `v0.8.0` released — `ai-form-event-js-execution` |
| Worktree / branch | `../v-form-agent-v0.9.0` · `feat/v0.9.0-nl-interaction-js` |

## Problem

用户希望基于现有表单，用自然语言描述页面交互，由模型像前端程序员一样直接写出 JS，并在真实表单里跑对。v0.8 只有正则模板、结构与事件分通道、要求手写期望示例、靠关键词路由，无法覆盖「每页加下一页并校验」等需求。

## 用户确认边界

| 决策项 | 选择 |
|---|---|
| 生成 | DeepSeek **直接写**事件 JS，无中间 DSL / 编译器 |
| 代码禁区 | **只禁网络请求**；DOM、定时器、`eval`、跳转、存储不禁 |
| 正确性 | 模型写验证场景 → 真实预览执行 → 失败回传修正（≤2 轮）→ 服务端重判 |
| 确认 | 写入前展示代码、场景与真实结果，用户确认 |
| 能力面 | C1–C6 全部交付，题库为下限；复杂场景靠多轮澄清 |
| 题库 | Agent 起草，**用户已审阅** |
| 模型验证 | 录制回放 + 真实 DeepSeek 冒烟 |

## Scope

### Deliverable 0 — API 审计与参考手册
渲染态 API / 事件上下文审计；`interactionApiReference` + parity；fixture `F-wizard` / `F-order` / `F-detail`。

### Deliverable 1 — 生成
`interactionOutput` zod；引用与场景覆盖校验；`interactionGenerator`（DeepSeek + 重写一次 + fixture 回放）；意图分类。

### Deliverable 2 — 网络检查
静态 AST 检查 + 验证期运行时拦截。

### Deliverable 3 — 结构与事务合入
`addButton`（含 `eachTabPane`）；结构 + 事件同一事务；交互管线允许新建 `button`。

### Deliverable 4 — 真实验证与自动修正
前端 `interactionRunner`；`interactionRepair`（场景指纹）；`/interaction` apply 重判闸。

### Deliverable 5 — 统一入口 UI
AiChat 去关键词分流；`/interaction` generate → 验证 → 修正 → 确认写入；`route_refine` → `/refine`。

### Deliverable 6 — 验收
题库全量 e2e + 独立断言；真实冒烟；回归；acceptance 证据。

## Non-goals

网络请求（接口、`dataSources`、上传）；列 `render`；智能合并手写事件；跨表单通信；无 Key 时降级模板。

## Affected contracts

见设计 §10。新建：`POST /api/agent/v1/interaction`。`/event` 保留兼容且保持 v0.8 护栏；`/refine` 新建白名单不变（`button` 仅交互管线可建）。

## Risks

代码与场景同源、修正改场景、动态网络调用漏检、验证期副作用、异步时序、状态可观察性、误路由。缓解见设计 §9。

## Acceptance criteria

1. 题库每条正例：generated → 真实预览全部场景 pass（可含修正）→ 确认 → applied 后设计器 JSON 含结构与事件 → 题库独立断言复验通过。
2. 题库每条负例：不可 apply、画布不变、给出原因或澄清问题。
3. 伪造 / 不完整 verificationReport → draft。
4. 修正轮改动场景断言 → 本轮被拒。
5. 直接写出网络调用 → 静态拒绝；经 `eval` 动态发起 → 运行时拦截并判失败。
6. 无 fixture 或无 Key → 明确报错，不回退模板。
7. 纯结构需求 → `route_refine`，结果与 `/refine` 一致。
8. 真实 DeepSeek 冒烟 ≥5 条（含「下一页」），证据记录通过率（不含 Key）。
9. v0.8 26 用例及既定回归通过。

## Acceptance candidates

| case-id | Requirement | Type | 真实执行 |
|---|---|---|---|
| `interaction-api-reference-parity` | FR-2 | static | no |
| `interaction-output-schema-reject-invalid` | FR-2 | agent | no |
| `interaction-unknown-ref-rewrite` | FR-2 | agent | no |
| `interaction-handler-scenario-coverage` | FR-4 | agent | no |
| `interaction-network-static-reject` | FR-5 | agent | no |
| `interaction-network-runtime-intercept` | FR-5 | e2e | yes |
| `interaction-runtime-error-repair` | FR-6 | e2e | yes |
| `interaction-repair-scenario-tamper-reject` | FR-6 | agent | no |
| `interaction-repair-limit-draft` | FR-6 FR-8 | agent | no |
| `interaction-apply-forged-report-draft` | FR-6 | agent | no |
| `interaction-transaction-all-or-nothing` | FR-3 | agent | no |
| `interaction-no-fixture-no-fallback` | FR-8 | agent | no |
| `interaction-route-refine-structure-only` | FR-1 | agent | no |
| `nl-*` / `nl-neg-*` | FR-1–FR-8 | e2e | yes |
| `interaction-ui-confirm-flow` | FR-7 | e2e | yes |
| `interaction-llm-smoke` | FR-2 | smoke | real LLM |
| `v08-regression` 等 | regression | agent/e2e | — |

## Lifecycle note

OpenSpec status 为 `applied`。DeliveryGuard `v0.9.0` 已 published：source merged（`f9e5244`，`main`）、acceptance passed、release published（`2026-09-24T02:24:32Z`，锚点 `https://github.com/renjing-2022/v-form-agent/tree/v0.9.0`）。本文件只同步已存在事实，不回写未发生的 source / acceptance / release。
