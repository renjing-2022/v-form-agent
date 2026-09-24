# PRD：重型容器第一刀 — data-table 列 / sub-form / vf-dialog（v0.6.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-heavy-container-refine-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.6.0` |
| 修订 | 2（2026-09-24：对齐 DeliveryGuard 已发布事实） |
| 状态 | released（DeliveryGuard `release.published`；acceptance passed；OpenSpec `applied`） |
| 关联 OpenSpec | `ai-form-heavy-container-refine` |

## 1. 背景与问题

`v0.5.0` 已交付全量 Truth Strict 与字段级删/排/复制，但重型容器仍整类 NON_GOAL：

1. **data-table**：列定义在 `options.tableColumns`，结构 op 与容器属性 refine 均拒绝；
2. **sub-form**：`widgetList` 子字段无法 NL 删排复制，壳层属性（showBlankRow 等）不可 refine；
3. **vf-dialog**：壳层属性（title / width 等）已在 Catalog 登记，但 `dialog-shell` 策略整包拒绝。

终局排期将本版对齐「重型容器」第一刀：**可验收子集**，而非一次任意深编排。

## 2. 产品成功标准（本版硬门槛）

1. **既有 data-table 扁平列**：增列 / 删列 / 同级重排 / 改列字段（label、prop、width、show、align、fixed、sortable）写回后与手动列编辑等价；多级表头（含 `children` / `headerFlag`）一律拒绝并诚实说明。
2. **既有 sub-form**：对其 `widgetList` 内字段复用 v0.5 结构 op（remove / reorder / duplicate）；壳层属性在白名单内可 `updateField`；`addField` 仅允许现有 create 白名单字段进入该 sub-form。
3. **既有 vf-dialog**：壳层属性 refine（title / width / fullscreen / 显隐与按钮文案等）可落地；事件键仍禁写。
4. **不可新建**：NL 不得新建 `data-table` / `sub-form` / `vf-dialog`（及本版未开放的 `grid-sub-form` / `vf-drawer`）。
5. **未落地不得报成功**：歧义目标、多级表头、非法列 shape → 422 或可读 warning；IntentGate 诚实 summary。
6. **不扩字段 create 白名单**：`REFINE_CREATE_WHITELIST` 保持 v0.5 的 12 type。
7. **验收 mock-only**：不要求真 LLM SLA。

## 3. 本版本目标

### 3.1 data-table — 扁平列结构手术子集

| 能力 | 纳入 |
|---|---|
| 增 / 删 / 同级重排扁平列 | ✅ |
| 改扁平列 `label` / `prop` / `width` / `show` / `align` / `fixed` / `sortable` | ✅ |
| 多级表头 `children` / 嵌套 header | ❌ reject |
| `tableData` / `dsEnabled` / `dsName` / 列 `render` 脚本 | ❌ |
| 操作按钮行为 / 事件 | ❌ |
| NL 新建 data-table | ❌ |

### 3.2 sub-form — 子字段结构 op + 壳层属性

| 能力 | 纳入 |
|---|---|
| `widgetList` 内 remove / reorder / duplicate | ✅ |
| 壳层：`label` / `showBlankRow` / `showRowNumber` / `labelAlign` / `actionColumnPosition` / `hidden` / `disabled` / `name` / `customClass` | ✅ |
| `addField` 进入既有 sub-form（仅现有白名单 type） | ✅ |
| `grid-sub-form` | ❌ 本版延后 |
| NL 新建 sub-form | ❌ |
| `onSubForm*` 事件 | ❌ |

### 3.3 vf-dialog — 壳层属性 refine

| 能力 | 纳入 |
|---|---|
| `title` / `width` / `fullscreen` / `showModal` / `showClose` / `closeOnClickModal` / `closeOnPressEscape` / `center` / `readMode` / `disabledMode` / ok·cancel Label·Hidden / `name` | ✅ |
| `onOkButtonClick` 等事件键 | ❌ |
| `vf-drawer` | ❌ 本版延后（可保留 NON_GOAL） |
| NL 新建 vf-dialog | ❌ |
| dialog 内「任意深结构编排」 | ❌；对已有 `widgetList` 字段可沿用 v0.5 字段 op（同级，不 reparent） |

### 3.4 验收与 E2E

- DeliveryGuard acceptance（agent/static + Playwright mock）；
- Playwright：data-table 列、sub-form 子字段/壳层、vf-dialog 壳层各 ≥1 可观察用例 + v0.5 回归抽样；
- `AGENT_ALLOW_MOCK=1`。

## 4. 非目标（本版本不做）

- 自由事件 JS / functions / dataSources 执行（留给 v0.7）；
- data-table 多级表头、整表数据、远程数据源编排；
- `moveField` / 跨容器 reparent；
- 扩展 generate/refine **新建**字段白名单（checkbox / switch 等）；
- NL 新建 data-table / sub-form / vf-dialog / grid-sub-form / vf-drawer；
- `grid-sub-form` / `vf-drawer` 本版开放；
- 运行时 extension 全覆盖；会话持久化；真 LLM 必选 acceptance。

## 5. 用户与场景

| 编号 | 场景 | 成功标准 |
|---|---|---|
| S1 | 给已有表格加一列「备注」 | 扁平 `tableColumns` 新增合法列；画布可见 |
| S2 | 删掉 / 重排某列 | 列集合与顺序与手动一致；其他列保留 |
| S3 | 改列标题/宽度 | 值形态合法（width 等按 Catalog）；非法拒绝 |
| S4 | 多级表头诉求 | 422 或明确 NON_GOAL warning，不产生半残树 |
| S5 | sub-form 内删/排/复制字段 | 与 v0.5 字段 op 等价 |
| S6 | 改 sub-form「显示行号」等壳层 | options 写回；事件键不变 |
| S7 | 改弹窗标题/宽度 | vf-dialog 壳层落地；事件键仍禁 |
| S8 | 要求新建 data-table/dialog | 拒绝 + 可读说明 |
| S9 | 回归 | v0.5 删排复制 + Truth Strict 不回退 |

## 6. 功能需求

### FR-1 data-table 扁平列 op

- 精确定位既有 data-table（id / name / label）；
- 列定位：columnId / prop / label（歧义 → 422）；
- 合入校验对齐 `compositeSchema`（`data-table-column`）；新列分配唯一 `columnId`；
- 目标列或祖先含 `children` / 多级 header → reject。

### FR-2 sub-form 结构与壳层

- 从 `STRUCTURE_OP_NON_GOAL` 中**有条件**放开：仅当目标位于 `sub-form.widgetList`（或对 sub-form 自身做壳层 patch，不做整容器删排作为本版必选）；
- 壳层键进入 `CONTAINER_REFINE_PROPERTY_MATRIX`；
- 事件键保持 forbidden。

### FR-3 vf-dialog 壳层

- 从 `CONTAINER_PROPERTY_REFINE_NON_GOAL` 移出 `vf-dialog`，写入 refine 白名单键；
- `width` 等形态与 Catalog / editor 一致；
- 事件键 strip + warning / IntentGate。

### FR-4 IntentGate 与诚实 summary

- 列/壳层未落地 → 422；
- summary 机器描述：「已增/删/排 N 列」「已更新 sub-form 壳层」「已更新弹窗标题」等。

### FR-5 边界与回归

- create 白名单不变；不可新建三类 type；
- 无 reparent；无事件执行；
- mock-only Playwright + v0.5 回归。

## 7. 验收标准（产品层）

1. data-table 扁平列增删排改各有 agent case；多级表头负例 pass；
2. sub-form 子字段结构 + 壳层各 ≥1 pass；
3. vf-dialog 壳层 refine + 事件禁写负例 pass；
4. 新建三类 type 负例 pass；create 白名单未扩；
5. v0.5 回归 pass；Playwright mock 证据齐。

## 8. 风险

- 默认 `tableColumns` 样例含嵌套 header → 必须 flatten-only 守卫，避免半合法树；
- 现有 acceptance 断言 `data-table structureSurgery === unsupported`、dialog NON_GOAL → 本版需改写并补证据；
- 列 op 若误用整段 `tableColumns` 替换 → 易丢列；优先专用 op 或受控 patch。

## 9. 完成定义

OpenSpec `tasks.md` 全部勾选；DeliveryGuard acceptance **passed**；release 独立 gate。
