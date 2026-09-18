# Tasks: ai-form-design-truth-catalog

有序、可验证任务。**仅在实现与相关检查实际完成后勾选**；OpenSpec 意图、部分 enum 同步、或 agent 契约绿测，均**不能**单独作为「源码级全面覆盖」证据。

## 产品硬门槛（贯穿全部任务）

1. Agent 知识库对 v-form **设计可配置面**的覆盖 ≈ 查阅设计源码（静态规范，非运行时调试）；
2. 自然语言生成/优化结果 ≈ 设计器手动操作（合法值 + 正确值形态 + 目标命中；未落地不得报成功）。

## 里程碑（一步到位，分两阶段交付，同属 v0.4.0）

| 阶段 | 目标 | 完成判据 |
|---|---|---|
| **v0.4.0-a** | DesignTruthGraph 编译 + 全链路同源 Validator + IntentGate | A 层静态规范入库；高精度键形态门禁；summary 机器校验 |
| **v0.4.0-b** | NL 定位/批量 + 三路径统一 + 完整 acceptance | tab 批量、label 定位、generate/Excel 同源；Playwright evidence |

> **自查基线（2026-09-17）**：此前 §1–§5 勾选过早已回退。当前仅 labelAlign/displayStyle 等**局部 enum**落地；`labelWidth: "450px"`、控件 `size: "default"`、诚实 summary、219 editor 形态等**均未达标**，不得宣称 v0.4 完成。

---

## 交付物 1：DesignTruthGraph（离线编译产物）

将 Catalog 从「出厂 options 指纹 + 手写 enum」升级为 **`(scope, type, prop)` 设计真源图**。

### 1.1 真源盘点与 schema

- [x] 盘点入口与高精度属性矩阵初稿（labelAlign / displayStyle / labelWidth 等）
- [x] Catalog schema 支持 `constraints.*.enum` + `source`（向后兼容 v0.3）
- [x] 真源优先级注释已写入 `catalogPolicy.ts`
- [x] **部分**：DesignTruthGraph 节点字段已扩展至 Catalog `OptionConstraint`（`valueKind` / `inheritEmpty` / `unit` / `editor` / `linkageBlockedWhen`）
- [x] **部分**：widgetsConfig unique types 与 Catalog 37 types 一一对齐 + `CREATE_NON_GOAL` 登记（`create-whitelist-catalog-parity`）
- [x] **部分**：`applicableKeys`（canonical variant hasConfig 等价）已入 Catalog + sanitize + `catalog-hasconfig-parity`
- [x] **部分**：接入 `propertyRegister.js` → `editor` 映射 + `property-register-editor-parity`（common/advanced 计数 + HIGH_PRECISION 键）
- [x] **部分**：接入 **219** 个 `*-editor.vue` 解析 `valueKind` + 并列产物 `design-truth-graph.json`（`design-truth-editor-valuekind-parity`）
- [x] **部分**：按 type 覆盖 editor（`{type}-{prop}-editor`）54 条 + `skipsGenericEditor`（如 button.type → button-type-editor）
- [x] **部分**：接入渲染约定：`form-item-wrapper` 等（`labelWidth+'px'`、`!!labelAlign` 继承、class 生效）（`render-convention-parity`）
- [x] **部分**：登记属性联动：`autosize↔rows`、`remote/allowCreate→filterable`、`multiple↔defaultValue`（propertyMixin + editor v-if）
- [x] **部分**：登记复合值 schema：`optionItems`、`validation` 预设、容器列/按钮组/tree 等（`composite-schema-parity`）
- [x] **部分**：登记容器级属性：tab-pane / grid-col / grid / dialog 等（`container-level-properties-parity`）
- [x] **部分**：登记 form vs field 双轨：`customClass` string vs string[]、`labelWidth` number 语义等（`form-field-dual-track-parity`）
- [x] **部分**：登记 identity：`name`/`id` 唯一规则；禁写键 + 事件键 **forbidden 但可见**（`identity-forbidden-parity`）
- [x] **部分**：登记扩展边界：customFields / runtime register 的 static policy（`extension-boundary-policy-parity`）

### 1.2 编译与产物

- [x] **部分**：Truth Compiler 产出 `widget-catalog.json` + `design-truth-graph.json`（219 editors + register 映射 + typeOverrides）
- [x] 淘汰/收敛手写 `ENUMS_BY_TYPE`：enum 主路径 DesignTruthGraph + `catalogEnumPolicy` policy 兜底
- [x] **部分**：HIGH_PRECISION 键 `labelWidth`/`size`/`labelWrap`/`labelHidden` 等已 strict valueKind；其余 nullish 待收敛

---

## 交付物 2：统一 Validator（generate / refine / Excel 共用）

- [x] `valueMatchesConstraint` 作为 sanitize / catalogValidator 唯一匹配入口（v0.3 基线）
- [x] 枚举键强制：`labelAlign`、`displayStyle`（字段 + 表单级 labelAlign）
- [x] **`labelWidth`**：字段/表单均 **number**；拒绝 `"450px"` / 带单位字符串；允许字段 `null` 继承
- [x] **`size`**：按 editor 实际 `""|large|small`；禁止控件级 `"default"` 字面量
- [x] **`columnWidth` / dialog width 等**：cssText（columnWidth strict string；拒绝 number）
- [x] **部分**：`minLength`/`maxLength`/`rows`/`gutter`/`colHeight` 已登记 strict number（WIDGET_TRUTH_VALUE_KIND）
- [x] **`customClass`**：widget string vs form string[] 分轨校验
- [x] **部分**：HIGH_PRECISION + WIDGET_TRUTH_VALUE_KIND 键启用 `strict`，不再宽松标量
- [x] **部分**：`applicable=false` → strip + hasConfig warning（writable 内但不在 applicableKeys）
- [x] **部分**：联动门禁：`linkageBlockedWhen` + multiple/defaultValue + remote/filterable（`refine-linkage-*`）
- [x] generate / Excel 路径 **复用同一 Catalog/Validator**（不得 refine 严、generate 松）

---

## 交付物 3：IntentGate（诚实完成语义）

- [x] `labelAlign` 对齐非法全失败 → 422（`refineAlignPolicy` + `refine-labelalign-reject-right`）
- [x] 修复 `planAlignPatchesAllIllegal` **硬编码 `radio` type** → `planPatchesAllIllegalForKey`（按目标 type）
- [x] **部分**：`labelWidth`/`size` 意图未落地 → 422（`refineIntentGate`）
- [x] summary **机器校验**：`buildHonestSummary`；未变化且 strip → 422
- [x] **部分**：多 op strip 且无变化 → 422；summary 改为事实描述
- [x] 前端 `AiChat`：toast 区分 applied/warnings/未落地
- [x] 用户确认 `loadFormJson` 前：可选二次校验目标键（`preApplyFormJsonGate` 结构门闩 + 设计文档契约）（`loadformjson-preapply-contract`）

---

## 交付物 4：定位、摘要与批量（NL 可操作面）

### 4.1 注入与摘要

- [x] `buildCatalogSnippets` 含 enum（对齐类键）
- [x] `formSummary` snapshot 含 `labelAlign` 等布局键
- [x] snippets 按 **instruction 命中 (type,prop)** 注入 `valueKind` / enum / inherit 说明（`catalog-snippet-includes-enums` 含 valueKind/inheritEmpty）
- [x] **部分**：snapshot 扩展 `optionItems`/`defaultValue`/`validation`（instruction 命中时）
- [x] 统一 `MAX_FIELDS` 截断策略（formSummary 与 validator 均用 `MAX_FIELDS=120`）
- [x] Planner 提示：枚举字面量 + number/cssText 形态示例 + 继承空串语义

### 4.2 NL 归一与定位

- [x] NL 同义词层：「右对齐/居中/左对齐」→ `label-*-align`；「标签宽度 N」→ number N（非 `"Npx"`）
- [x] `resolveTarget` 接入 **label** 匹配
- [x] **部分**：`updateFieldsInScope` + `resolveScopeFields`（parent label/id/name + filterType）
- [x] 引入 **parentScope** path 语法：`tab-pane/label`、`type#name`、`path:…`（`refine-parent-scope-*` + batch 复用）
- [x] 容器属性修改：`tab-pane` label/active、`grid-col` span/offset/responsive 等纳入 `updateField`；其余 9 类 container 登记 NON_GOAL（`container-refine-policy-parity`）

---

## 交付物 5：消灭第二真源（三路径统一）

- [x] refine 主链路：RefinePlan → Merger → Validator（v0.3 基线）
- [x] `addField` / 新建节点：**从 widgetsConfig 默认 options 克隆**，对齐 `widgetTemplates` 漂移（如 `columnWidth:"200px"` vs labelWidth number）
- [x] 扩展 `REFINE_CREATE_WHITELIST` / `FIELD_WHITELIST` 与 Catalog type 集一致，或 PRD 明确 NON_GOAL 并写警告
- [x] Excel 导入路径接入同一 TruthGraph/Validator（generate 路由与 smoke 已共用 validateFormJson + Catalog）

---

## 交付物 6：漂移检查、文档与 DeliveryGuard 收口

### 6.1 漂移与覆盖率

- [x] `catalog:check`：labelAlign/displayStyle/labelWidth/size 编辑器 + fingerprint（4 editors）
- [x] `design-truth-catalog-sync` 证据（含 labelWidth strict number）
- [x] **部分**：fingerprint 纳入 `propertyRegister.js`
- [x] **部分**：`catalog:check` 新增 applicableKeys / form.customClass 校验
- [x] 随机 **50×(type,prop)** 抽样：Catalog valueKind/enum 与 design-truth-graph 一致（`catalog-sample-parity`）

### 6.2 验收用例与 E2E

- [x] `refine-labelalign-nl-parity`（agent）
- [x] `refine-labelalign-reject-right`（agent）
- [x] `refine-summary-has-labelalign`（agent）
- [x] `refine-v03-regression`（agent）
- [x] `frontend-no-secret`（static）
- [x] `refine-labelwidth-number-parity`：`450` 可写、`450px` 必须拒绝
- [x] `refine-size-enum-parity`：禁止控件 `size="default"`
- [x] `refine-honest-summary`：未落地不得成功 summary / toast
- [x] `refine-tab-batch-labelwidth`（agent）
- [x] `refine-target-by-label`（agent）
- [x] `catalog-hasconfig-parity`（agent/static）
- [x] `refine-layout-overlap-properties`：重叠→labelWrap+displayStyle:block+labelWidth；FR-6 负例
- [x] `refine-layout-css-fallback`：属性不足时 setCssCode+customClass 路径
- [x] `nl-synonym-normalize-parity`（agent）
- [x] `generate-catalog-validator-parity`（agent）
- [x] `addfield-catalog-defaults-parity`（agent）
- [x] `property-register-editor-parity`（agent/static）
- [x] `refine-linkage-multiple-defaultvalue`（agent）
- [x] `refine-linkage-remote-filterable`（agent）
- [x] `refine-parent-scope-parse`（agent）
- [x] `refine-container-tabpane-label-active`（agent）
- [x] `refine-container-gridcol-span`（agent）
- [x] `refine-container-non-goal-reject`（agent）
- [x] `container-refine-policy-parity`（agent/static）
- [x] `composite-schema-parity`（agent/static）
- [x] `render-convention-parity`（agent/static）
- [x] `extension-boundary-policy-parity`（agent/static）
- [x] `catalog-sample-parity`（agent/static）
- [x] `loadformjson-preapply-contract`（static）
- [x] Playwright `e2e/tests/ai-form-v040.spec.ts` 跑通 + evidence 落盘
- [x] typecheck / acceptance:cases / smoke 全绿（**不**单独证明全面覆盖）

### 6.3 文档与生命周期

- [x] 更新 PRD/设计文档：与本文里程碑、Deliverable 1–6 对齐
- [x] README 降调：50 抽样 + policy enum 收敛后更新 v0.4 表述；仍注明 release pending
- [x] DeliveryGuard：`sources` 登记 + acceptance manifest 全 case 通过
- [x] OpenSpec status：`ready`（v0.4.0-a + v0.4.0-b 任务勾选 + acceptance passed；release 仍 pending）

---

## Acceptance candidates

| case-id | Requirement id(s) | Type | Verification notes | Exploratory? | Status |
|---|---|---|---|---|---|
| `design-truth-catalog-sync` | FR-1 | agent/static | 多真源编译 + 漂移；含 graph 219 editors | no | verified |
| `design-truth-editor-valuekind-parity` | FR-1 | agent/static | 219 *-editor.vue valueKind + typeOverrides + button.type | no | verified |
| `catalog-hasconfig-parity` | FR-1 | agent/static | `(type,prop).applicable` 与 canonical variant 一致 | no | verified |
| `catalog-snippet-includes-enums` | FR-2 | agent | snippets 含 valueKind/enum/inheritEmpty，instruction 命中优先 | no | verified |
| `property-register-editor-parity` | FR-1 | agent/static | propertyRegister common/advanced → catalog.editor + linkage | no | verified |
| `refine-linkage-autosize-rows` | FR-1 FR-5 | agent | autosize=true 时 rows patch strip | no | verified |
| `refine-linkage-multiple-defaultvalue` | FR-1 FR-5 | agent | multiple 与 defaultValue 形状联动 | no | verified |
| `refine-linkage-remote-filterable` | FR-1 FR-5 | agent | remote=true 时禁止 filterable=false | no | verified |
| `refine-parent-scope-parse` | FR-4 | agent | parentScope 语法解析 | no | verified |
| `refine-parent-scope-batch` | FR-4 FR-5 | agent | parentScope 驱动 tab 下批量 patch | no | verified |
| `refine-container-tabpane-label-active` | FR-4 FR-5 | agent | tab-pane label/active + 单选 linkage | no | verified |
| `refine-container-gridcol-span` | FR-4 FR-5 | agent | grid-col span 经 updateField 落地 | no | verified |
| `refine-container-non-goal-reject` | FR-4 FR-5 | agent | vf-dialog 等容器属性 NON_GOAL | no | verified |
| `container-refine-policy-parity` | FR-1 FR-4 | agent/static | 13 container types 划分 supported/nonGoal | no | verified |
| `composite-schema-parity` | FR-1 | agent/static | optionItems/validation/tree/tableColumns 等 compositeSchema | no | verified |
| `container-level-properties-parity` | FR-1 FR-4 | agent/static | 14 container types containerLevelKeys + propertyScope | no | verified |
| `form-field-dual-track-parity` | FR-1 FR-2 | agent/static | customClass/labelWidth/labelAlign/size 双轨 + dualTrack 元数据 | no | verified |
| `identity-forbidden-parity` | FR-1 FR-2 | agent/static | widget.id/name 唯一 + forbidden 可见禁写 + duplicate id | no | verified |
| `render-convention-parity` | FR-1 FR-2 | agent/static | form-item-wrapper labelWidth+px / labelAlign inherit / class | no | verified |
| `extension-boundary-policy-parity` | FR-1 | agent/static | customFields 空 export + runtime card/alert NON_GOAL + slot extension-runtime | no | verified |
| `catalog-sample-parity` | FR-1 | agent/static | 50×(type,prop) valueKind/enum vs design-truth-graph | no | verified |
| `loadformjson-preapply-contract` | FR-4 | static | loadFormJson 前 preApplyFormJsonGate + 设计文档契约 | no | verified |
| `refine-summary-has-labelalign` | FR-3 | agent | snapshot 含高精度键 + inherit 说明 | no | verified |
| `refine-target-by-label` | FR-4 | agent | 按 label 唯一命中 | no | verified |
| `refine-tab-batch-labelwidth` | FR-4 FR-5 | agent/playwright | 同一 tab 下批量 radio 布局属性 | yes | verified |
| `refine-labelalign-nl-parity` | FR-4 FR-5 | agent/playwright | NL 右对齐 → 合法 enum + 面板可观察 | yes | verified |
| `refine-labelalign-reject-right` | FR-4 FR-5 | agent | `right`/`center` 非法值拦截 | no | verified |
| `refine-labelwidth-number-parity` | FR-1 FR-4 FR-5 | agent | `450` OK；`450px` 拒绝 | no | verified |
| `refine-size-enum-parity` | FR-1 FR-4 | agent | 禁止 `size="default"` | no | verified |
| `refine-honest-summary` | FR-4 | agent/ui | 未落地不得成功 summary/toast | no | verified |
| `refine-layout-overlap-properties` | FR-2 FR-4 FR-5 | agent/playwright | 重叠→属性优先；禁止改字 | yes | verified |
| `refine-layout-css-fallback` | FR-3 FR-5 | agent | 受控 cssCode+customClass 兜底 | no | verified |
| `nl-synonym-normalize-parity` | FR-2 FR-4 | agent | NL 口语 → Catalog 字面量 | no | verified |
| `generate-catalog-validator-parity` | FR-1 FR-5 | agent | generate/excel 同源 Catalog 校验 | no | verified |
| `addfield-catalog-defaults-parity` | FR-1 FR-5 | agent | addField/wrapInTabs 从 Catalog 克隆 | no | verified |
| `create-whitelist-catalog-parity` | FR-1 FR-5 | agent/static | whitelist + NON_GOAL 划分 Catalog 37 types | no | verified |
| `refine-v03-regression` | FR-5 | agent/playwright | v0.3 主路径 + defaultValue 共存 | no | verified |
| `frontend-no-secret` | security | static | 前端无服务端密钥 | no | verified |

---

## 完成定义（DoD）

**v0.4.0-a Done：** 交付物 1 + 2 + 3（IntentGate 核心）+ `design-truth-catalog-sync` / `refine-labelwidth-number-parity` / `refine-size-enum-parity` / `refine-honest-summary` 通过。

**v0.4.0 Done（一步到位）：** 上述 + 交付物 4 + 5 + 6 全部勾选 + acceptance 表无 `pending`/`partial`（已验证项除外）+ Playwright evidence + DeliveryGuard acceptance 非 pending。
