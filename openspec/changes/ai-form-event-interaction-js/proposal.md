# Proposal: ai-form-event-interaction-js

| 项 | 值 |
|---|---|
| Change ID | `ai-form-event-interaction-js` |
| Target version | `v0.7.0` |
| Primary document | `docs/requirements/ai-form-event-interaction-js.md` |
| Supporting design | `docs/design/ai-form-event-interaction-js.md` |
| Affected repository | `app`（`.` / 本仓库） |
| Predecessor | `v0.6.0` released — 重型容器扁平列 / sub-form / vf-dialog 壳层 |
| 文档修订 | 4 — 2026-09-24 对齐 DeliveryGuard 已发布事实 |

## Problem

v0.6 及之前事件键与 `functions` 一律禁写，交互执行面无法经 NL 进入系统。若同一版同时做「登记 + 澄清 + 自由 JS 生成 + 真实运行时 applied」，改动面过大，且会在执行 harness 未就绪时假装「写进 JSON 即正确」。

## 用户确认边界

| 决策项 | 选择 | 拍板 |
|---|---|---|
| 危险能力 | **一律禁止**（网络 / dataSources / DOM / eval / Function / 动态 import / 定时器） | 2026-09-21 |
| 终局 applied 锚点 | Playwright **真实渲染**执行断言通过才算运行正确 | 2026-09-21；**交付 = 后续版** |
| API | **新端点** `POST /api/agent/v1/event` | 2026-09-22 |
| 纯前端事件面 | **全覆盖预留**（含 created/mounted、子表行、表格/树/弹窗面板）；v0.8 才合入 | 2026-09-22 修订 |
| 接口类 | `onRemoteQuery` / 上传族 / `dataSources` **禁止** | 2026-09-21 |
| 版本切分 | 本版 = **shape 登记 + 澄清闭环**；生成 / 护栏 / 合入 / 执行验收 = **单独一版** | 2026-09-22 |

## 版本定位

v0.7：**知识 + 澄清**。产出 EventSpec（含可判定示例契约），事件键在合入层仍为空。

不在本版声称：已生成 JS、已应用到画布、已验证运行时正确。

## Product hard gates

| # | 门槛 | 本版含义 |
|---|------|----------|
| G1 | 知识 ≈ 运行时真源 | 事件 shape 形参 / 归属从 `new Function` 调用点提取；`catalog:check` parity |
| G2 | NL ≈ 手动，但诚实 | 澄清结果应对齐用户若打开事件面板会选择的键与控件；**不等于**已写代码 |
| G3 | 未落地不得报成功 | 不完备 → `need_clarification`；完备 → `spec_ready`；**禁止** summary 含「已更新事件/已应用 JS」；合入后事件键仍空 |

## Scope

| 决策项 | 本版 |
|---|---|
| 端点 | 新建 `/api/agent/v1/event` |
| shape | 全量可见登记；`writableIn` 仅为 `v0.8+` 或 `never`，本版不合入 |
| 澄清 | `need_clarification` / `spec_ready`；可指向生命周期 / 子表行等纯前端键 |
| 前端 | AiChat 展示追问；无「确认写入事件」 |
| `/refine` | 不变；事件仍禁写 |
| 生成 JS / AST 护栏 / merger 写 on* / Playwright 执行 | **NON-GOAL（后续版）** |
| 接口类事件 | NON-GOAL（澄清阶段即拒绝） |

### Deliverable 1 — 事件 shape 登记

- 提取脚本 + shape 生成物；`catalog:check` 签名 parity；
- Catalog 仍把全部 `on*` / `functions` / `dataSources` 放在 forbidden 写路径；
- case `event-shape-registry-parity`。

### Deliverable 2 — `/event` 澄清闭环

- schema：EventSpec、questions、status；
- `eventPlanner`：分类 / 缺口 / 定向问题；mock 覆盖测试指令；
- 接口意图拒绝；生命周期 / 子表行可 `spec_ready`（仍不写 JS）；
- case `event-clarify-incomplete-intent` / `event-clarify-complete-to-spec` / `event-clarify-danger-reject` / `event-clarify-lifecycle-spec` / `event-clarify-subform-row-spec`。

### Deliverable 3 — 前端分流

- `eventFormByAgent` 客户端；AiChat 续问 UI；
- 不调用 `loadFormJson` 写入事件；
- 可选 mock Playwright：澄清问题可见。

### Deliverable 4 — Acceptance + 回归

- **不改写** `refine-dialog-event-forbid`（仍须 pass）；
- v0.6 / formula / strict-sweep / frontend-no-secret 回归。

## Non-goals（本版）

- 生成或合入事件 JS / `functions`；
- `eventJsGuard`、执行 harness、`ai-form-v070` 运行时触发断言；
- 反转 `catalogValidator` 事件空串规则；
- `onRemoteQuery` / 上传 / `dataSources` 写路径；
- 真实 LLM 必选；会话持久化。

## Breaking changes

**合入层无 breaking。** 仅新增端点与 Catalog 只读 shape 元数据。后续版再改写事件禁写 acceptance。

## Affected contracts

| 契约 | 路径 | 本版 |
|---|---|---|
| 新路由 | `agent/src/routes/event.ts` | 新增 |
| Schema | `agent/src/schemas/eventSpec.ts` | 新增 |
| Planner | `agent/src/services/eventPlanner.ts` | 新增；**无 JS 输出** |
| Shape 知识 | `agent/src/knowledge/` 新模块 + 生成物 | 新增 |
| catalog:check | `generateWidgetCatalog.ts` / check 脚本 | **增加** shape parity；**不**把事件移出 forbiddenKeys |
| refine / merger / catalogValidator | 现有 | **事件禁写语义不变** |
| 前端 API / AiChat | `v-form/src/api/chat/index.ts`、`AiChat/index.vue` | 澄清 UI |
| Acceptance | `agent/scripts/acceptance-cases.ts` | 新澄清/shape case；保留 v0.6 事件禁写 |
| Playwright | 可选澄清 UI；**无**执行 spec |

## Risks

见 design § 8。额外：拆版后若对外仍说「v0.7 能写交互 JS」= G3 违规。

## Acceptance criteria

1. 不完备意图 → `need_clarification`，事件键不变；
2. 完备意图 → `spec_ready` + EventSpec（触发可解析、≥1 示例），事件键仍空；
3. 危险/网络意图 → 拒绝，不合入；
4. 生命周期 / 子表行等纯前端意图 → 可 `spec_ready`（键仍空）；接口类意图 → 拒绝；
5. shape 形参与运行时真源 parity（`catalog:check`）；
6. `refine-dialog-event-forbid` 及等价禁写 case **仍 pass**；
7. `/refine` 回归不回退；`frontend-no-secret` pass；
8. 任何 summary / `applied` 不得表示事件已写入。

## Acceptance candidates

| case-id | Requirement | Type | 运行时执行 |
|---|---|---|---|
| `event-clarify-incomplete-intent` | FR-1 | agent | no |
| `event-clarify-complete-to-spec` | FR-1 | agent | no |
| `event-clarify-danger-reject` | FR-1 | agent | no |
| `event-clarify-lifecycle-spec` | FR-1 | agent | no |
| `event-clarify-subform-row-spec` | FR-1 | agent | no |
| `event-shape-registry-parity` | FR-2 | static | no |
| `event-endpoint-does-not-write-onstar` | FR-1 | agent | no |
| `event-refine-still-forbids-events` | regression | agent | no |
| `refine-dialog-event-forbid` | regression | agent | no |
| `refine-v06-regression` | regression | agent/e2e | no |
| `catalog-full-strict-sweep` | regression | static | no |
| `frontend-no-secret` | security | static | no |
| `event-clarify-ui` | FR-3 | playwright mock-only | no（只断言问题文案可见） |

## Out of scope reminder

不宣称交互执行面已交付。后续版才允许写 JS，且必须以 Playwright 真实渲染断言为 applied 闸。

## Lifecycle note

OpenSpec status 为 `applied`。DeliveryGuard `v0.7.0` 已 published：source merged（`ac28445e`，`main`）、acceptance passed、release published（`2026-09-22T09:03:58Z`，锚点 `https://github.com/renjing-2022/v-form-agent/releases/tag/v0.7.0`）。本段只同步已存在事实。后续写 JS 已由 `v0.8.0` / `v0.9.0` 承接。
