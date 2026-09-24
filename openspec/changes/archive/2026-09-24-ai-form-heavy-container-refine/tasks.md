# Tasks: ai-form-heavy-container-refine

有序、可验证任务。**仅在实现与相关检查实际完成后勾选**；OpenSpec 意图、局部单测绿、或 Planner mock 路径，均**不能**单独作为 acceptance / release 证据。

## 产品硬门槛（贯穿全部任务）

1. **扁平列 / sub-form / dialog 壳层** NL 写回 ≈ 手动；未提及项保留；
2. **不可新建** data-table / sub-form / vf-dialog；**不扩** create 白名单；**无** reparent；
3. **多级表头 / 事件 / ds* / tableData** → reject；**无半残树**；
4. **未落地不得报成功**（IntentGate + 机器 summary）；
5. **mock-only** Playwright；v0.5 Truth Strict 与结构 op **不回退**。

---

## 交付物 0：基线

- [x] 确认 `v0.5.0` acceptance / `ai-form-v050.spec.ts` 在本分支可复跑
- [x] 锁定 PRD 边界（见 `proposal.md` 用户确认表）：data-table **仅扁平列**；sub-form 结构+壳层；vf-dialog 壳层；grid-sub-form/vf-drawer 仍 NON_GOAL

---

## 交付物 1：Policy 与 Catalog 标记

### 1.1 结构 op 守卫

- [x] `structureRefine.ts`：从 `STRUCTURE_OP_NON_GOAL_TYPES` 移除 `sub-form`；**保留** `data-table` 节点级 remove/reorder/duplicate 拒绝
- [x] 确认 sub-form 内字段 target（非 `type===sub-form`）可走 v0.5 结构 op
- [x] `removeField` 删除整块 sub-form 允许（文档化语义）

### 1.2 容器属性 refine

- [x] `CONTAINER_REFINE_PROPERTY_MATRIX` 增加 `sub-form` 壳层键（见 design doc）
- [x] `CONTAINER_REFINE_PROPERTY_MATRIX` 增加 `vf-dialog` 壳层键；从 `CONTAINER_PROPERTY_REFINE_NON_GOAL` 移除
- [x] `grid-sub-form` / `vf-drawer` / `data-table` 壳层 / `table*` **保持** NON_GOAL
- [x] `checkContainerRefinePolicyParity` 仍全容器 partition 无缺口

### 1.3 Catalog notes / structureSurgery

- [x] `catalogPolicy.structureSurgeryFor`（或 notes）支持 `partial`：`data-table`（列 op）、`sub-form`（子字段 op）
- [x] 同步 `widget-catalog.json` notes；`catalog:check` 通过
- [x] **改写** `acceptance-cases.ts` 中 `data-table structureSurgery === 'unsupported'` 旧断言

### 1.4 Create 白名单

- [x] `REFINE_CREATE_WHITELIST` / `CREATE_NON_GOAL` **不变**
- [x] 静态 case `create-whitelist-unchanged`（基数与 v0.5 一致）

---

## 交付物 2：data-table 扁平列 op

### 2.1 Schema

- [x] `refinePlan.ts`：`addTableColumn` / `removeTableColumn` / `reorderTableColumn` / `updateTableColumn`
- [x] `columnRef`（columnId / prop / label）与 `flatColumnSpec` 类型；禁止 `children` / `render` / `headerFlag` 入参

### 2.2 Merger / 校验

- [x] 实现列合入（`tableColumnRefine.ts` 或 `refineMerger` 内聚）：定位 data-table、max(columnId)+1
- [x] Flatten-only：含嵌套 header 的表 → 全部列 op reject + warning
- [x] 合入走 `compositeSchemaPolicy`（`data-table-column`）；strip 禁写键
- [x] `updateField` 若 patch 含 `tableColumns` 整数组 → strip/reject（`refine-tablecolumns-patch-block`）

### 2.3 IntentGate + Planner

- [x] 列 op 全失败 / 歧义 → 422（`structureIntentUnfulfilled` 或专用 gate）
- [x] `buildHonestSummary` 含 `tableColumns=add|remove|reorder|update` 机器描述
- [x] Planner / mock：扁平列 only；不可新建 data-table；多级表头须拒绝

---

## 交付物 3：sub-form 结构 + 壳层

- [x] 子字段 remove / reorder / duplicate 可落地（agent case）
- [x] `addField` + `parent` 指向 sub-form；type ∈ 现有白名单（`refine-subform-add-field-parent`）
- [x] 壳层 `updateField` + sanitize + Catalog strict（`refine-subform-shell-props`）
- [x] `onSubForm*` 事件键仍 forbidden

---

## 交付物 4：vf-dialog 壳层

- [x] 壳层键 refine 可落地（`refine-dialog-shell-props`）；**改写** v0.5 dialog NON_GOAL 正向断言
- [x] `onOkButtonClick` 等事件禁写（`refine-dialog-event-forbid`）
- [x] 新建 vf-dialog reject（并入 `refine-heavy-create-reject`）
- [x] dialog 内普通字段结构 op 回归（可选子 case，或 v0.5 regression 覆盖）

---

## 交付物 5：Acceptance + Playwright（mock-only）

### 5.1 Agent / static cases

- [x] `refine-datatable-add-column`
- [x] `refine-datatable-update-column`
- [x] `refine-datatable-remove-reorder-column`（可拆为两条）
- [x] `refine-datatable-nested-header-reject`
- [x] `refine-datatable-tablecolumns-patch-block`
- [x] `refine-subform-structure-ops`
- [x] `refine-subform-shell-props`
- [x] `refine-subform-add-field-parent`
- [x] `refine-dialog-shell-props`
- [x] `refine-dialog-event-forbid`
- [x] `refine-heavy-create-reject`（data-table / sub-form / vf-dialog）
- [x] `refine-grid-subform-still-non-goal`
- [x] `catalog-heavy-container-policy-parity`
- [x] `create-whitelist-unchanged`
- [x] `refine-v05-regression`
- [x] `catalog-full-strict-sweep`（回归）
- [x] `frontend-no-secret`（回归）

### 5.2 Playwright

- [x] `e2e/tests/ai-form-v060.spec.ts` — `AGENT_ALLOW_MOCK=1`，`EVIDENCE_VERSION=v0.6.0`
- [x] 列 / sub-form / dialog 各 ≥1 浏览器可观察（截图或 DOM 断言）
- [x] 证据 `docs/evidence/v0.6.0/*.txt`（+ .png 若适用）
- [x] `e2e/package.json` 或根脚本 `test:v060`（若项目惯例需要）

### 5.3 DeliveryGuard

- [x] `.deliveryguard/acceptance/v0.6.0/evidence.json`
- [x] `docs/acceptance/v0.6.0.md`
- [x] `deliveryguard acceptance validate` 证据清单已就绪（**正式 `acceptance.status=passed` 须在 source commit 钉点之后**）

---

## 完成定义（DoD）

**v0.6.0 Done：** 交付物 0–5 全部勾选；上表 acceptance cases pass；Playwright mock evidence 齐；v0.5 回归不回退；DeliveryGuard acceptance **passed**；`deliveryguard check` pass；release 独立 gate。

## Acceptance 表（规划）

| case-id | Requirement | playwright | status |
|---|---|---|---|
| `refine-datatable-add-column` | FR-1 | yes | pass |
| `refine-datatable-update-column` | FR-1 | yes | pass |
| `refine-datatable-remove-reorder-column` | FR-1 | optional | pass |
| `refine-datatable-nested-header-reject` | FR-1 | no | pass |
| `refine-datatable-tablecolumns-patch-block` | FR-1 | no | pass |
| `refine-subform-structure-ops` | FR-2 | yes | pass |
| `refine-subform-shell-props` | FR-2 | yes | pass |
| `refine-subform-add-field-parent` | FR-2 | no | pass |
| `refine-dialog-shell-props` | FR-3 | yes | pass |
| `refine-dialog-event-forbid` | FR-3 | no | pass |
| `refine-heavy-create-reject` | FR-4 | no | pass |
| `refine-grid-subform-still-non-goal` | FR-5 | no | pass |
| `create-whitelist-unchanged` | FR-5 | no | pass |
| `catalog-heavy-container-policy-parity` | FR-5 | no | pass |
| `refine-v05-regression` | FR-5 | yes | pass |
| `catalog-full-strict-sweep` | regression | no | pass |
| `frontend-no-secret` | security | no | pass |
