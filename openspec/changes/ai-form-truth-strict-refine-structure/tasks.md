# Tasks: ai-form-truth-strict-refine-structure

有序、可验证任务。**仅在实现与相关检查实际完成后勾选**。

## 产品硬门槛

1. 全 applicable 键 strict（A2）；有 enum 则强制 enum；
2. NL delete / 同级 reorder / duplicate ≈ 手动；tab-pane 删除子树一并移除；
3. 未落地不得报成功；不扩 create；E2E mock-only。

---

## 交付物 1：Truth Strict A2

### 1.1 编译

- [x] Truth Compiler：全部 applicable 键写入 `valueKind` + `strict: true`
- [x] enum 键从 editor/policy 入库，禁止仅指纹推断（沿用 v0.4 withEnumsAndSources + A2 finalize）
- [x] known-gap 报告机制（`collectCatalogStrictEditorGaps`；不阻塞 sweep）

### 1.2 catalog:check

- [x] `checkCatalogFullStrictSweep` — 全量 applicable 断言
- [x] 证据 `catalog-full-strict-sweep.txt`
- [x] 保留 v0.4 `catalog-sample-parity` 回归

### 1.3 Validator

- [x] sanitize/validate 对 strict 键 fail-closed（v0.4 基线 + 全 applicable strict）
- [x] generate / refine / Excel 三路径共用
- [x] IntentGate：strict strip + 用户意图键 → 422（v0.4 基线）

---

## 交付物 2：Refine 结构 op

### 2.1 Schema + Merger

- [x] `removeField` + `removeFieldsInScope`
- [x] tab-pane 删除：**子 widgetList 一并删除**（不对子节点做提升）
- [x] `reorderField` — 同级 first/last/before/after
- [x] `duplicateField` — deepClone + 递归 regenerate id/name
- [x] 对齐 `designer.copyNewFieldWidget` / `copyNewContainerWidget` 语义

### 2.2 守卫

- [x] table / data-table / 内部 cell 删排 → NON_GOAL reject（`STRUCTURE_OP_NON_GOAL_TYPES`）
- [x] 不提供 `moveField` / reparent schema
- [x] 删后 id/name 唯一；公式悬空 warning
- [x] `REFINE_CREATE_WHITELIST` 不变

### 2.3 Planner + IntentGate

- [x] Planner 提示：无 reparent；duplicate 新 id；删 tab 删子树
- [x] 结构 op 全失败 → 422（`structureIntentUnfulfilled`）
- [x] 机器 summary：删/排/复制计数（`buildHonestSummary` structure=*）

---

## 交付物 3：Acceptance + Playwright（mock-only）

### 3.1 Agent cases

- [x] `refine-remove-field-by-label`
- [x] `refine-remove-tabpane-cascade`
- [x] `refine-reorder-sibling`
- [x] `refine-duplicate-field`
- [x] `refine-structure-ambiguous-reject`
- [x] `refine-v04-regression`
- [x] `frontend-no-secret`

### 3.2 Playwright

- [x] `e2e/tests/ai-form-v050.spec.ts`（或等价）— mock-only
- [x] delete / reorder / duplicate / tab-pane cascade 浏览器可观察
- [x] 证据 `docs/evidence/v0.5.0/*.txt` (+ .png)

### 3.3 DeliveryGuard

- [x] `.deliveryguard/acceptance/v0.5.0/evidence.json`
- [x] `docs/acceptance/v0.5.0.md`
- [x] `deliveryguard acceptance validate` pass

---

## 完成定义（DoD）

**v0.5.0 Done：** 交付物 1–3 全部勾选；full strict sweep pass（或 PRD 签字 known-gap）；Playwright mock evidence；DeliveryGuard acceptance **passed**；release 独立 gate。

## Acceptance 表（规划）

| case-id | Requirement | playwright | status |
|---|---|---|---|
| `catalog-full-strict-sweep` | FR-1 | no | pass |
| `refine-remove-field-by-label` | FR-2 | yes | pass |
| `refine-remove-tabpane-cascade` | FR-2 | yes | pass |
| `refine-reorder-sibling` | FR-3 | yes | pass |
| `refine-duplicate-field` | FR-4 | yes | pass |
| `refine-structure-ambiguous-reject` | FR-5 | no | pass |
| `refine-v04-regression` | FR-6 | yes | pass |
| `frontend-no-secret` | security | no | pass |
