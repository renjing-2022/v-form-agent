# Proposal: ai-form-truth-strict-refine-structure

| 项 | 值 |
|---|---|
| Change ID | `ai-form-truth-strict-refine-structure` |
| Target version | `v0.5.0` |
| Primary document | `docs/requirements/ai-form-truth-strict-refine-structure.md` |
| Supporting design | `docs/design/ai-form-truth-strict-refine-structure.md` |
| Affected repository | `app` (`.` / 本仓库) |

## Problem

`v0.4.0` 建立 DesignTruthGraph 与 IntentGate，但：

1. **Truth 仍分层**：657 条 widget 约束非 `strict`；50 抽样不能证明全 applicable 零 nullish（A2 未达）；
2. **结构 op 缺失**：无 delete / 同级 reorder / duplicate；用户无法 NL「删掉」「移到下面」「复制一份」；
3. **E2E 偏薄**：v0.4 Playwright 2 条，结构操作无浏览器证据。

业务终极目标（G1/G2/G3）要求本版补齐 **Truth A2** 与 **删/排/复制** 子集。

## Scope（用户确认边界）

### Deliverable 1 — Truth Strict A2

- 全部 applicable 键 `valueKind` + `strict: true`；enum 键强制 enum；
- `catalog:check` 全量 sweep；known-gap 清单机制；
- generate / refine / Excel 共用 strict Validator。

### Deliverable 2 — Refine 结构 op

| op | 纳入 |
|---|---|
| `removeField` / `removeFieldsInScope` | ✅ |
| `reorderField`（同级 only） | ✅ |
| `duplicateField` | ✅ |
| `moveField` / reparent | ❌ |
| 删 tab-pane | **子控件一并删除** |

### Deliverable 3 — Acceptance + Playwright（mock-only）

- delete / reorder / duplicate / tab-pane cascade 各 ≥1 playwright；
- v0.4 回归；不扩 create；mock-only。

## Non-goals

- reparent / 跨容器 move；
- 扩展 REFINE_CREATE_WHITELIST / generate 白名单；
- 事件 JS 执行；重型容器深改；extension 全覆盖；
- 会话持久化；真 LLM 必选 case。

## Affected contracts

| 契约 | 变更 |
|---|---|
| DesignTruthGraph / Catalog | 全 applicable strict；catalog:check full sweep |
| `refinePlanSchema` | +removeField, +removeFieldsInScope, +reorderField, +duplicateField |
| `refineMerger` | 删/排/复制；tab-pane cascade delete |
| `refineIntentGate` | 结构 op + strict strip 422 |
| `refinePlanner` | 结构 op 提示；禁止 reparent |
| Validator / sanitize | 全 strict fail-closed |
| Playwright | `e2e/tests/ai-form-v050.spec.ts`（或扩展现有 spec） |

## Design notes

- duplicate 对齐 `designer.copyNewFieldWidget` / `copyNewContainerWidget`（递归新 id/name）；
- reorder 仅 sibling list splice，不镜像 `checkWidgetMove` 跨容器规则（因无 reparent）；
- tab-pane 删除语义与 `deleteTabPaneOfTabs` 对齐：不提升 orphan。

## Risks

| 风险 | 缓解 |
|---|---|
| A2 sweep 大量 gap | known-gap + PRD 签字；分 type 修 Compiler |
| duplicate 子树 id | 递归 regenerate |
| strict 422 增多 | 诚实 summary + NL 提示合法值 |

## Acceptance criteria

1. `catalog-full-strict-sweep` pass（或 signed known-gap 仅覆盖明确条目）；
2. remove / reorder / duplicate / tab-pane cascade 各 pass；
3. ambiguous structure reject → 422；
4. create 白名单 unchanged；v0.4 regression pass；
5. DeliveryGuard acceptance passed（mock E2E）。

## Acceptance candidates

| case-id | Requirement | Type |
|---|---|---|
| `catalog-full-strict-sweep` | FR-1 | agent/static |
| `refine-remove-field-by-label` | FR-2 | agent/playwright |
| `refine-remove-tabpane-cascade` | FR-2 | agent/playwright |
| `refine-reorder-sibling` | FR-3 | agent/playwright |
| `refine-duplicate-field` | FR-4 | agent/playwright |
| `refine-structure-ambiguous-reject` | FR-5 | agent |
| `refine-v04-regression` | FR-6 | agent/playwright |
| `frontend-no-secret` | security | static |

## Lifecycle note

OpenSpec status 为 `archived`。DeliveryGuard `v0.5.0` 已 published：source merged（`ce976e8d`，`main`）、acceptance passed、release published（`2026-09-21T03:11:30Z`，锚点 `https://github.com/renjing-2022/v-form-agent/releases/tag/v0.5.0`）。本段只同步已存在事实。
