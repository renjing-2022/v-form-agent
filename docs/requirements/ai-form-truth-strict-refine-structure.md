# PRD：Truth Strict 全量收敛 + Refine 删/排/复制（v0.5.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-truth-strict-refine-structure-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.5.0` |
| 状态 | 已规划（未实现） |
| 关联 OpenSpec | `ai-form-truth-strict-refine-structure` |

## 1. 背景与问题

`v0.4.0` 已交付 DesignTruthGraph、IntentGate 与 NL 高精度主路径（labelAlign / labelWidth / size 等），但距业务终极目标仍有缺口：

1. **知识覆盖仍分层**：约 657 条 widget 约束虽有 `valueKind`，但未 `strict`；50 抽样 parity 不能等同「全 applicable 键零 nullish」；
2. **操作面不完整**：设计器可删除、同级排序、复制控件，RefinePlan 仅有增改与 `wrapInTabs`，无法 NL 表达「删掉」「移到下面」「复制一份」；
3. **浏览器验收偏薄**：v0.4 Playwright 仅 2 条结构/布局用例，删排复制缺乏可观察证据。

本版在用户确认边界下，补齐 **Truth A2 全量 strict** 与 **delete / reorder / duplicateField** 三类结构操作。

## 2. 产品成功标准（本版硬门槛）

1. **全 applicable 键 strict**：Catalog + Validator 对全部 `applicableKeys`（form + widget）具备与设计器一致的 `valueKind`；有 enum 的键强制 enum；禁止仅出厂指纹推断导致的静默 strip。
2. **NL ≈ 手动（结构子集）**：对已纳入 op 的删除、同级排序、复制，确认写回后 JSON 与手动操作等价；未提及控件保留。
3. **删 tab-pane 语义明确**：删除 tab-pane 时**默认连同子控件一并删除**（与设计器删除 tab 页行为对齐）。
4. **未落地不得报成功**：结构 op 目标歧义、非法 strict 值、空操作须 422 或可读 warning；IntentGate 延续 v0.4。
5. **不扩 create 白名单**：`REFINE_CREATE_WHITELIST` 仍为 v0.4 的 12 type；advanced-field 仅可改既有，不可 NL 新建。

## 3. 本版本目标

### 3.1 Truth Strict 全量收敛（A2）

- 全部 widget `applicableKeys` 与 form `writableKeys` 在 Catalog 中带 **非 nullish `valueKind`**；
- 凡 DesignTruthGraph / editor 解析出 enum 的键，Catalog 与 Validator **强制 enum**；
- `catalog:check` 升级为 **全量 applicable sweep**（替代/补充 50 抽样作为 release 门槛）；
- 未解析 editor 的 applicable 键须登记 **known-gap** 清单，不得 silent pass。

### 3.2 Refine 结构 op

| op | 语义 | 范围 |
|---|---|---|
| `removeField` | 按 target 删除单个 widget | 含 tab-pane / grid-col / 字段；**tab-pane 删除时子树一并删除** |
| `removeFieldsInScope` | parentScope + 可选 filterType 批量删 | 同上语义 |
| `reorderField` | **同级** sibling list 内 before / after / first / last | 不跨容器 reparent |
| `duplicateField` | 复制 target，生成新 id/name，插入同级 list（默认紧跟源后） | 对齐 `designer.copyNewFieldWidget` / `copyNewContainerWidget` 规则 |

**明确不做（本版）：**

- `moveField` 跨 tab-pane / grid-col / 根 **reparent**；
- table / data-table / sub-form 内部 cell 级删排；
- 扩展 `addField` 可新建 type。

### 3.3 验收与 E2E

- DeliveryGuard acceptance manifest（agent/static + Playwright mock）；
- Playwright：**delete / reorder / duplicate** 各 ≥1 可观察用例 + v0.4 回归；
- E2E 环境：**mock-only**（`AGENT_ALLOW_MOCK=1`），不要求 DeepSeek 云服务 SLA 证据。

## 4. 非目标（本版本不做）

- 自由事件 JS / functions / dataSources 执行；
- 重型容器任意深结构编排（data-table 列编排等）；
- `moveField` 跨容器 reparent；
- 扩展 generate/refine **新建**白名单（checkbox / switch 等 advanced-field）；
- 运行时 extension widget（card/alert）静态全覆盖；
- 服务端会话持久化；PDF/Word/OCR；生产拓扑变更；
- 真 LLM 路径作为必选 acceptance（可留 optional 备注，不阻塞本版）。

## 5. 用户与场景

| 编号 | 场景 | 成功标准 |
|---|---|---|
| S1 | 删除字段 | 「删掉备注」→ 目标从 JSON 与画布消失；其他字段保留 |
| S2 | 删 tab 页 | 「删除第二个 tab」→ tab-pane 及其 **内部控件一并删除** |
| S3 | 同级排序 | 「把性别移到姓名下面」→ 同级 list 顺序与手动下移一致 |
| S4 | 复制控件 | 「复制一份评分 radio」→ 新 id/name，options 等同，公式引用不自动复制到非法态 |
| S5 | strict 负例 | 非法 enum/形态 → 422 或 strip + 诚实 summary |
| S6 | 歧义拒绝 | 多个同名 label 且无 scope → 422，不改画布 |
| S7 | 回归 | v0.4 HIGH_PRECISION + v0.3 主路径不回退 |

## 6. 功能需求

### FR-1 Truth Strict 全量

- 全 applicable 键 `valueKind` 入库；enum 键强制校验；
- `catalog:check` 全量 sweep + known-gap 报告；
- generate / refine / Excel 共用 strict Validator。

### FR-2 removeField / removeFieldsInScope

- 精准定位（id / name / label / parentScope）；
- tab-pane 删除：**子 widgetList 一并移除**；
- 删后 id/name 唯一；公式引用悬空 → warning；
- 重型容器内部节点 → NON_GOAL reject。

### FR-3 reorderField（同级 only）

- 仅调整 **同一 parent list** 内顺序（widgetList / tabs / cols 等同层语义）；
- 边界：first/last/before:id/after:id；
- 不实现跨 list reparent。

### FR-4 duplicateField

- deepClone + 新 id + 新 options.name（对齐 designer 复制规则）；
- 插入位置：默认源后一位，可 spec `position`；
- 容器复制：登记子树 id/name 全量重生成策略。

### FR-5 IntentGate 与诚实 summary

- 删/排/复制未命中 → 422；
- strict strip 导致用户意图未落地 → 422；
- 前端 toast 绑定 post-merge。

### FR-6 回归与边界

- v0.4 acceptance 全绿；create 白名单不变；
- mock-only Playwright evidence。

## 7. 验收标准（产品层）

1. 全 applicable strict sweep 通过，或 known-gap 清单经 PRD 签字且 case 覆盖；
2. delete / reorder / duplicate 各 ≥1 agent + playwright pass；
3. tab-pane 删除子控件一并删除有专项 case；
4. 不扩 create；422 歧义 case pass；
5. v0.4 回归 pass。

## 8. 风险

- A2 全量 strict 可能暴露大量 editor 解析缺口 → known-gap + 分 type 修复；
- duplicate 容器子树 id 冲突 → 必须递归 regenerate；
- reorder 与 designer moveUp/moveDown 边界（首/末）→ 对齐 warning 语义。

## 9. 完成定义

OpenSpec `tasks.md` 全部勾选；DeliveryGuard acceptance **passed**；release 独立 gate。
