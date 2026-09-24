# Proposal: ai-form-heavy-container-refine

| 项 | 值 |
|---|---|
| Change ID | `ai-form-heavy-container-refine` |
| Target version | `v0.6.0` |
| Primary document | `docs/requirements/ai-form-heavy-container-refine.md` |
| Supporting design | `docs/design/ai-form-heavy-container-refine.md` |
| Affected repository | `app` (`.` / 本仓库) |
| Predecessor | `v0.5.0` released — Truth Strict A2 + remove/reorder/duplicate |

## Problem

`v0.5.0` 补齐字段级删/排/复制与全量 Truth Strict，但重型容器仍整类 NON_GOAL（代码与验收均如此）：

1. **data-table**：`options.tableColumns` 列无法 NL 增删排改；`STRUCTURE_OP_NON_GOAL_TYPES` 与 acceptance 断言 `structureSurgery === 'unsupported'`；
2. **sub-form**：`widgetList` 子字段结构 op 被拒；壳层属性在 `CONTAINER_PROPERTY_REFINE_NON_GOAL`；
3. **vf-dialog**：壳层键已在 Catalog / `containerLevelKeys` 登记，但 `dialog-shell` 策略整包拒绝（acceptance 负例仍期望 blocked）。

终局排期将本版对齐「重型容器」第一刀：**可验收、可校验子集**，不是一次任意深编排。

## Product hard gates（延续 G1/G2/G3）

| # | 门槛 | 本版含义 |
|---|------|----------|
| G1 | 知识库 ≈ 设计真源 | 列 shape 走 `compositeSchemaPolicy`（`data-table-column`）；壳层键与 Catalog strict 一致 |
| G2 | NL ≈ 手动操作 | 扁平列 / sub-form 子字段 / dialog 壳层写回后与手动等价；未提及项保留 |
| G3 | 未落地不得报成功 | 歧义、多级表头、非法列、事件键 → 422 或诚实 warning；IntentGate 机器 summary |

## Scope（用户确认边界，2026-09-21）

| 决策项 | 选择 |
|---|---|
| data-table | **扁平列**增删排改；多级表头 reject；**不开放**壳层布尔 / `tableData` / `ds*` |
| sub-form | `widgetList` 内 remove/reorder/duplicate + 壳层属性；`addField` 进既有 sub-form（仅现有白名单 type） |
| vf-dialog | **壳层属性** refine；dialog 内已有字段沿用 v0.5 字段 op（不 reparent 进/出 dialog） |
| 新建 | **不可** NL 新建 data-table / sub-form / vf-dialog |
| grid-sub-form / vf-drawer | **本版仍 NON_GOAL** |
| reparent / moveField | **不做** |
| 事件键 | **仍禁写**（`onSubForm*` / `onOkButtonClick` 等） |
| create 白名单 | **不扩展**（12 type 不变） |
| E2E | **mock-only**（`AGENT_ALLOW_MOCK=1`） |

### Deliverable 1 — data-table 扁平列 op

| op（命名以实现为准） | 纳入 |
|---|---|
| `addTableColumn` | ✅ |
| `removeTableColumn` | ✅ |
| `reorderTableColumn`（同级 only） | ✅ |
| `updateTableColumn`（label/prop/width/show/align/fixed/sortable） | ✅ |
| `updateField` 整段替换 `tableColumns` | ❌ 主路径禁止；须 strip/reject |
| 多级表头（`children` / `headerFlag`） | ❌ 整表列 op reject |
| `tableData` / `dsEnabled` / `dsName` / 列 `render` | ❌ |
| `removeField` 删 data-table 节点本身 | ❌ 本版非必选（可保持 NON_GOAL） |
| NL 新建 data-table | ❌ |

**列定位**：`columnId` > `prop` > `label`（歧义 → 422）。**新列** `columnId` = max(existing)+1。

### Deliverable 2 — sub-form 结构 + 壳层

| 能力 | 纳入 |
|---|---|
| `widgetList` 内 remove / reorder / duplicate | ✅ |
| 壳层：`name` / `label` / `showBlankRow` / `showRowNumber` / `labelAlign` / `actionColumnPosition` / `hidden` / `disabled` / `customClass` | ✅ |
| `addField` + `parent` 指向既有 sub-form | ✅ |
| `removeField` 删 sub-form 整块 | ✅（对齐「删子表」手动语义） |
| `grid-sub-form` | ❌ |
| NL 新建 sub-form | ❌ |

### Deliverable 3 — vf-dialog 壳层

| 能力 | 纳入 |
|---|---|
| 壳层：`title` / `width` / `fullscreen` / `showModal` / `showClose` / `closeOnClickModal` / `closeOnPressEscape` / `center` / `readMode` / `disabledMode` / ok·cancel Label·Hidden / `name` | ✅ |
| dialog 内字段 remove/reorder/duplicate（target 为字段 type） | ✅ 继承 v0.5，不新增 op |
| `vf-drawer` | ❌ 仍 NON_GOAL |
| 事件键 | ❌ |
| NL 新建 vf-dialog | ❌ |

### Deliverable 4 — Acceptance（mock-only）

- 下列 case 表全部 pass；
- Playwright：`e2e/tests/ai-form-v060.spec.ts`（列 / sub-form / dialog 各 ≥1 可观察）；
- v0.5 回归抽样 + `frontend-no-secret`；
- DeliveryGuard acceptance manifest + `docs/acceptance/v0.6.0.md`。

## Non-goals

- 事件 JS / 受控事件模板（v0.7）；
- data-table 多级表头、整表数据、远程数据源、操作列按钮行为；
- `moveField` / reparent；扩 `REFINE_CREATE_WHITELIST` / generate 白名单；
- `grid-sub-form` / `vf-drawer` 本版开放；
- data-table 壳层属性矩阵（`stripe` / `showPagination` 等）本版不开放；
- 会话持久化；真 LLM 必选 case；运行时 extension 全覆盖；
- 重型容器「一次对话任意业务编排」。

## Breaking changes（相对 v0.5 验收）

实现本版须**改写**下列既有断言，不可双标：

| 位置 | v0.5 期望 | v0.6 期望 |
|---|---|---|
| `acceptance-cases.ts` | `data-table.structureSurgery === 'unsupported'` | `partial` 或等价标记 + 列 op 正向 case |
| `acceptance-cases.ts` | `vf-dialog` 壳层 patch rejected | 壳层可 refine；事件仍 reject |
| `acceptance-cases.ts` | data-table 结构 op warning | 列 op 成功路径 + 嵌套 header 负例 |
| `catalogPolicy.structureSurgeryFor` | data-table → `unsupported` | `partial`（或 notes 分维度） |

## Affected contracts

| 契约 | 路径 | 变更 |
|---|---|---|
| RefinePlan schema | `agent/src/schemas/refinePlan.ts` | + 列级 op；`columnRef` / `flatColumnSpec` |
| 列合入服务 | `agent/src/services/tableColumnRefine.ts`（新建）或 `refineMerger.ts` 内聚 | 定位 table、flatten-only、columnId、composite 校验 |
| 结构 op 守卫 | `agent/src/services/structureRefine.ts` | 从 NON_GOAL 移除 `sub-form`；**保留** `data-table` 节点级结构 op 拒绝 |
| Merger | `agent/src/services/refineMerger.ts` | 接线列 op；sub-form 子树；拦截 `updateField.tableColumns` |
| 容器 refine | `agent/src/knowledge/containerRefinePolicy.ts` | + `sub-form` / `vf-dialog` 矩阵；移除对应 NON_GOAL |
| 容器 sanitize | `agent/src/services/containerRefine.ts` | 随 policy 生效 |
| Catalog policy | `agent/src/knowledge/catalogPolicy.ts` | `structureSurgeryFor` 支持 `partial`；同步 `widget-catalog.json` notes |
| Composite schema | `agent/src/knowledge/compositeSchemaPolicy.ts` | 列 op 合入校验（已有 `tableColumns` schema） |
| Create policy | `agent/src/knowledge/createWhitelistPolicy.ts` | **不变**；加回归断言 |
| IntentGate | `agent/src/services/refineIntentGate.ts` | 列 op / 壳层未落地 → 422；summary `tableColumns=*` |
| Planner / mock | `agent/src/services/refinePlanner.ts` | 列与壳层提示；mock 路径覆盖新 op |
| Acceptance | `agent/scripts/acceptance-cases.ts` | 新 case + 改写 v0.5 重型 NON_GOAL 断言 |
| Playwright | `e2e/tests/ai-form-v060.spec.ts` | mock-only 浏览器证据 |
| npm scripts | `e2e/package.json` 或根脚本 | `test:v060`（若沿用 v050 模式） |

## Design notes

- **列手术专用 op**：禁止模型用 `updateField` 吐完整 `tableColumns` 数组（易丢列）；非法 patch strip + IntentGate。
- **Flatten-only**：`tableColumns` 任一项含非空 `children` 或 `headerFlag===true` → 该表**全部**列 op reject（推荐整表守卫，避免半残树）。
- **sub-form**：`childLists` 已遍历 `widgetList`；守卫改为「仅拒绝 `type===sub-form` 的 reorder/duplicate 若产品不需要」；remove 整块 sub-form 允许。
- **dialog 内字段**：target 为字段 type 时不走 `vf-dialog` NON_GOAL；仅壳层走 container matrix。
- **Truth Strict**：本版不降低 v0.5 A2；`catalog-full-strict-sweep` 回归保留。

## Risks

| 风险 | 缓解 |
|---|---|
| widgetsConfig 默认 `tableColumns` 含嵌套 header | 验收 fixture 使用**扁平列**表；嵌套表专做负例 |
| 旧 unsupported 断言与新产品冲突 | Breaking changes 表 + 同 PR 改写 acceptance |
| columnId 冲突 | max+1；删列不回收 id（与手动设计器常见行为对齐） |
| 范围膨胀 | 锁定 data-table 无壳层、无 drawer/grid-sub-form |

## Acceptance criteria

1. 扁平列 add/remove/reorder/update 各 pass；嵌套 header 负例 pass；
2. sub-form 子字段结构 + 壳层 + `addField` parent pass；
3. vf-dialog 壳层 pass；dialog 事件禁写 pass；
4. 新建 data-table/sub-form/vf-dialog reject；`REFINE_CREATE_WHITELIST` 基数不变；
5. `grid-sub-form` / `vf-drawer` 仍 NON_GOAL；
6. v0.5 回归 + `frontend-no-secret` pass；
7. DeliveryGuard acceptance **passed**（mock E2E）。

## Acceptance candidates

| case-id | Requirement | Type | playwright |
|---|---|---|---|
| `refine-datatable-add-column` | FR-1 | agent | yes |
| `refine-datatable-remove-reorder-column` | FR-1 | agent | optional |
| `refine-datatable-update-column` | FR-1 | agent | yes |
| `refine-datatable-nested-header-reject` | FR-1 | agent | no |
| `refine-datatable-tablecolumns-patch-block` | FR-1 | agent | no |
| `refine-subform-structure-ops` | FR-2 | agent | yes |
| `refine-subform-shell-props` | FR-2 | agent | yes |
| `refine-subform-add-field-parent` | FR-2 | agent | no |
| `refine-dialog-shell-props` | FR-3 | agent | yes |
| `refine-dialog-event-forbid` | FR-3 | agent | no |
| `refine-heavy-create-reject` | FR-4 | agent | no |
| `refine-grid-subform-still-non-goal` | FR-5 | agent | no |
| `create-whitelist-unchanged` | FR-5 | static | no |
| `catalog-heavy-container-policy-parity` | FR-5 | agent/static | no |
| `refine-v05-regression` | FR-5 | agent/playwright | yes |
| `catalog-full-strict-sweep` | regression | agent/static | no |
| `frontend-no-secret` | security | static | no |

## Out of scope reminder

不宣称「重型容器全覆盖」；OpenSpec 勾选 ≠ source merged ≠ acceptance passed ≠ release。

## Lifecycle note

OpenSpec status 为 `archived`。DeliveryGuard `v0.6.0` 已 published：source merged（`8cb90a57`，`main`）、acceptance passed、release published（`2026-09-21T08:05:00Z`，锚点 `https://github.com/renjing-2022/v-form-agent/releases/tag/v0.6.0`）。本段只同步已存在事实。
