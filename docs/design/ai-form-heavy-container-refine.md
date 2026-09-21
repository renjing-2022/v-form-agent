# 技术设计：重型容器第一刀 — data-table / sub-form / vf-dialog（v0.6.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-heavy-container-refine-design` |
| 类型 | technical-design |
| 目标版本 | `v0.6.0` |
| 关联 PRD | `docs/requirements/ai-form-heavy-container-refine.md` |
| 关联 OpenSpec | `ai-form-heavy-container-refine` |

## 1. 设计目标

在 v0.5 Truth Strict + 字段结构 op 基线上，开放重型容器**可校验子集**：

1. **data-table**：扁平 `tableColumns` 增删排改；
2. **sub-form**：`widgetList` 结构 op + 壳层属性 refine；
3. **vf-dialog**：壳层属性 refine；
4. 保持 create 白名单、无 reparent、无事件执行、mock-only。

## 2. Policy 边界调整

### 2.1 结构 op NON_GOAL（相对 v0.5）

| type | v0.5 | v0.6 |
|---|---|---|
| `data-table` | 整类 reject | **列级专用 op**；节点级 remove/reorder/duplicate **仍 reject** |
| `sub-form` | 整类 reject | **子节点** remove/reorder/duplicate；**remove 整块 sub-form 允许** |
| `grid-sub-form` | reject | **仍 reject** |
| `vf-dialog` / `vf-drawer` | reject | 结构 op 仍可不对壳层节点做必选删排；dialog 内字段沿用通用字段 op |
| `table` / `table-cell` | reject | **仍 reject** |

`Catalog.notes.structureSurgery`：可为 `data-table` / `sub-form` 引入 `partial` 或分字段说明；不得再断言「完全 unsupported」若本版已开放子集（acceptance 同步改写）。

### 2.2 容器属性 refine

| type | 动作 |
|---|---|
| `sub-form` | 从 `CONTAINER_PROPERTY_REFINE_NON_GOAL` 移出 → `CONTAINER_REFINE_PROPERTY_MATRIX` |
| `vf-dialog` | 同上 |
| `data-table` | **本版不开放**壳层布尔矩阵（`stripe` / `showPagination` 等）；保持 NON_GOAL |
| `grid-sub-form` / `vf-drawer` | 保持 NON_GOAL |

### 2.3 Create

- `CREATE_NON_GOAL` 对 `data-table` / `sub-form` / `vf-dialog` **保持**；
- `REFINE_CREATE_WHITELIST` **不扩**；
- `addField` 进入既有 `sub-form`：parent 定位 + type ∈ 现有白名单。

## 3. data-table 列 op

### 3.1 Schema（草案）

```typescript
{ op: 'addTableColumn', table: TargetRef, column: FlatColumnSpec, position?: ReorderPosition }
{ op: 'removeTableColumn', table: TargetRef, column: ColumnRef }
{ op: 'reorderTableColumn', table: TargetRef, column: ColumnRef, position: ReorderPosition }
{ op: 'updateTableColumn', table: TargetRef, column: ColumnRef, patch: Partial<FlatColumnSpec> }

type ColumnRef = { columnId?: number; prop?: string; label?: string }
type FlatColumnSpec = {
  prop: string
  label: string
  width?: string
  show?: boolean
  align?: string
  fixed?: string
  sortable?: boolean
  // 禁止：children, headerFlag, render（自由脚本）
}
```

### 3.2 Merger 规则

1. 定位 data-table；失败 / 歧义 → 结构失败；
2. **Flatten-only 守卫**：若 `tableColumns` 任一项含非空 `children` 或 `headerFlag===true`，**本版对该表所有列 op reject**（或仅拒绝触及嵌套分支的 op；推荐整表拒绝列手术并 warning「含多级表头」）；
3. `add`：分配下一 `columnId`；校验 `compositeSchema` required keys；
4. `remove` / `reorder`：仅在顶层数组 splice；
5. `update`：仅允许白名单键；strip `render` / `children`；
6. 禁止整表静默替换未提及列。

### 3.3 不采用整段 `updateField(tableColumns)` 作为主路径

避免模型吐完整数组导致丢列；专用 op + 受控 patch。

## 4. sub-form

### 4.1 结构

- `childLists` 已含 `widgetList`；关键是放宽 `structureOpNonGoalMessage`：当 **target 为 sub-form 内字段**（或 parent 为 sub-form）时允许；
- 对 **type===sub-form 自身** 的 `removeField`：**允许**（删整块子表）；reorder/duplicate 整块 sub-form **本版不做**。

### 4.2 壳层

```text
CONTAINER_REFINE_PROPERTY_MATRIX['sub-form'] = [
  'name', 'label', 'showBlankRow', 'showRowNumber', 'labelAlign',
  'actionColumnPosition', 'hidden', 'disabled', 'customClass'
]
```

sanitize 走现有 container refine + Catalog strict。

## 5. vf-dialog 壳层

```text
CONTAINER_REFINE_PROPERTY_MATRIX['vf-dialog'] = [
  'name', 'title', 'width', 'fullscreen', 'showModal', 'showClose',
  'closeOnClickModal', 'closeOnPressEscape', 'center',
  'readMode', 'disabledMode',
  'okButtonLabel', 'okButtonHidden', 'cancelButtonLabel', 'cancelButtonHidden'
]
```

- 从 `CONTAINER_PROPERTY_REFINE_NON_GOAL` 删除 `vf-dialog`；
- `vf-drawer` 保留 NON_GOAL；
- 事件键继续 `isEventKey` / forbidden。

## 6. IntentGate / Planner

- 列 op 全失败 → 422；
- 多级表头请求 → 422 或 plan 阶段拒绝；
- summary：`tableColumns=add|remove|reorder|update`、`sub-form shell`、`dialog shell`；
- Planner 提示：不可新建重型容器；不可多级表头；不可跨容器 move。

## 7. 测试设计

| case-id | 类型 | 说明 |
|---|---|---|
| `refine-datatable-add-column` | agent/playwright | 扁平增列 |
| `refine-datatable-remove-reorder-column` | agent | 删/排 |
| `refine-datatable-update-column` | agent | 改 label/width |
| `refine-datatable-nested-header-reject` | agent | 多级表头 reject |
| `refine-subform-structure-ops` | agent/playwright | 子字段删或排或复制 |
| `refine-subform-shell-props` | agent/playwright | showRowNumber 等 |
| `refine-dialog-shell-props` | agent/playwright | title/width |
| `refine-dialog-event-forbid` | agent | onOk 禁写 |
| `refine-heavy-create-reject` | agent | 新建三类 reject |
| `refine-v05-regression` | agent/playwright | v0.5 抽样 |
| `create-whitelist-unchanged` | static | 白名单基数不变 |

E2E：`EVIDENCE_VERSION=v0.6.0`，`AGENT_ALLOW_MOCK=1`。

## 8. 非本版技术范围

- grid-sub-form / vf-drawer 开放；
- reparent / moveField；
- 事件模板生成；
- create 白名单扩展；
- 真 LLM 必选 case。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 嵌套 header 半残树 | 整表 flatten-only 守卫 |
| 旧 case 断言 unsupported | 同步改写 acceptance |
| 列 op 与 updateField 双路径 | 主路径专用 op；updateField 改 tableColumns 可继续 strip/reject |
| dialog width 形态 | 沿用 Catalog valueKind / cssText |
