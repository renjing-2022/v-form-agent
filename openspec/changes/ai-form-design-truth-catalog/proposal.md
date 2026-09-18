# Proposal: ai-form-design-truth-catalog

| 项 | 值 |
|---|---|
| Change ID | `ai-form-design-truth-catalog` |
| Target version | `v0.4.0` |
| Primary document | `docs/requirements/ai-form-design-truth-catalog.md` |
| Supporting design | `docs/design/ai-form-design-truth-catalog.md` |
| Affected repository | `app` (`.` / 本仓库) |

## Problem

`v0.3.0` Catalog 解决了「有哪些可写键」，但未达到业务要求的**源码级设计真相全面覆盖**，也未保证自然语言与手动操作等价：

1. **真源过窄**：几乎只同步 `widgetsConfig` 出厂指纹；219 个 property-editor 中仅 2 个 enum 入库；无 `hasConfig` 适用性、无 valueKind、无联动；
2. **值形态错误可静默成功**：如 `labelWidth: "450px"`（设计器要 number）、控件 `size: "default"`（编辑器为 `""`）；
3. **注入/摘要不足**：snippets 缺 valueKind/继承语义；大表截断；`optionItems`/`defaultValue` 未入 snapshot；
4. **定位与批量弱**：无 label 定位、无 tab 作用域批量；用户说「同一 tab 下所有 radio」易偏；
5. **诚实语义缺失**：summary/toast 绑模型文案或 HTTP 200，非 merge 后机器校验；
6. **第二真源**：`widgetTemplates` / generate 白名单与 Catalog 双轨漂移。

业务硬要求：**知识库 ≈ 读设计源码；NL 结果 ≈ 手动操作高精确度；未落地不得报成功。**

## Scope（一步到位）

本变更按 **Deliverable 1–6** 交付，分两阶段（同属 v0.4.0）：

### v0.4.0-a — Truth Compiler + 同源 Validator + IntentGate

1. **DesignTruthGraph**：离线编译 `(scope, type, prop)` 真源图（applicable、editor、valueKind、enum、inherit、unit、composite、linkage、source）；
2. **统一 Validator**：generate / refine / Excel 共用；HIGH_PRECISION 键形态门禁（labelWidth number、size enum、cssText 等）；
3. **IntentGate**：每个被提及的高精度键未落地 → 422；summary 机器校验；前端 toast 绑定 merge 结果。

### v0.4.0-b — NL 面 + 三路径统一 + 完整 acceptance

4. **定位与批量**：label 定位、parentScope、tab 下批量 patch；容器级属性（tab-pane/grid-col 等）纳入或明确边界；
5. **NL 归一**：口语 → 合法字面量（右对齐 → `label-right-align` 等）；
6. **消灭第二真源**：addField 从 widgetsConfig 克隆；generate/Excel 与 Catalog 同源；
7. **漂移与验收**：propertyRegister + 全 editor fingerprint；50×(type,prop) 抽样；Playwright + DeliveryGuard 收口。

### 保留（v0.3 不回退）

- RefinePlan 受限操作机；受控 cssCode；FR-6 文案边界；defaultValue 共存对齐修复。

## Non-goals

- 自由事件 JS / functions / dataSources **执行**作为主验收路径（Catalog **登记**禁写 + 形状说明）；
- 重型容器任意深结构编排一次承诺（data-table 列编排等可登记 shape，refine op 可分期）；
- delete / move / reorder 等**全部**手动操作等价（须在文档与 API 明确支持子集）；
- 运行时在线检索整仓源码（Cursor 式 RAG）作主路径；
- PDF/Word/OCR；服务端会话持久化；生产拓扑变更；
- 运行时 custom widget **动态注册**的静态全覆盖（须有 extension policy）。

## Affected contracts

| 契约/边界 | 变更 |
|---|---|
| Widget Catalog / DesignTruthGraph | 多真源编译；`(type,prop)` 节点；漂移 fingerprint 扩展 |
| `generateWidgetCatalog` / Truth Compiler | 219 editor + propertyRegister + hasConfig + render |
| `buildCatalogSnippets` | valueKind + enum + inherit；按 instruction 命中键注入 |
| `formSummary` | 高精度键 + optionItems/defaultValue（按需）；截断策略统一 |
| `targetResolver` / RefinePlan | label 定位；parentScope；批量 op |
| `refinePropertyPolicy` / `catalogValidator` | 与 Graph 同源；applicable + linkage |
| `refineAlignPolicy` → **IntentGate** | 扩展至 labelWidth/size 等；修复 radio 硬编码 |
| `POST /api/agent/v1/refine` | 422 语义增强；诚实 summary |
| `POST /api/agent/v1/generate` / Excel | 共用 Validator（v0.4.0-b） |
| `AiChat` | 成功 UI 绑定 post-merge 校验 |
| `widgetWhitelist` / `widgetTemplates` | 对齐 widgetsConfig，消除漂移 |

## Design notes

### 「与读源码一样」的可验收定义

对设计器**可配置面静态规范**，Catalog + 注入 + 校验所用事实，应与工程师阅读以下真源后一致：

- `widgetsConfig.js` + 默认 formConfig  
- `propertyRegister.js` + 219 个 `*-editor.vue`（含 type 覆盖链）  
- `designer.hasConfig` 适用性  
- `propertyMixin` / editor 联动  
- 关键渲染约定（`form-item-wrapper` 等）

不包括：任意事件实现的可执行生成；运行时 custom 组件的静态不可知部分（须有 policy）。

### 「与手动操作高精确度」的可验收定义

同一意图下，NL 确认写回后的目标控件/表单相关 options，应与手动在属性面板操作后的结果等价（**合法字面量 + 正确值形态**；未提及控件保留）。若用户意图涉及的键未变为合法值，**不得**形成可确认的成功态。

### 覆盖率策略

- HIGH_PRECISION 矩阵键：**100%** valueKind/enum，零 nullish 出厂指纹；  
- 全量 `(type,prop)`：按 editor 解析 + hasConfig；未解析键不得宣传「源码级高精度」；  
- 随机 50 抽样与面板一致；漂移检查失败即阻断。

详细设计见 `docs/design/ai-form-design-truth-catalog.md` 与 `tasks.md` Deliverable 1–6。

## Risks

| 风险 | 缓解 |
|---|---|
| 219 editor 解析成本 | Truth Compiler 分 kind 解析；golden 抽样；分阶段 a/b |
| Prompt 膨胀 | 按 instruction 命中 (type,prop) 注入 |
| 范围滑向事件执行 | 非目标写死；事件/formula/validation **登记** shape |
| 第二真源复发 | addField 只从 widgetsConfig 克隆；check 阻断 drift |
| 口头全面无法测 | DoD + acceptance 表 + 50 抽样 |

## Acceptance criteria

1. DesignTruthGraph 对 HIGH_PRECISION 键 valueKind/enum 与设计器一致；`450px` / `size=default` 等拒绝。  
2. hasConfig/applicable 抽样与属性面板一致（`catalog-hasconfig-parity`）。  
3. snippets 含 valueKind/enum，非仅 keys。  
4. IntentGate：未落地不得成功 summary/toast；labelAlign 负例仍拦截。  
5. tab 批量 + label 定位至少各 1 条 agent/playwright 用例。  
6. v0.3 回归与 defaultValue 共存不回退；密钥仍仅服务端。  
7. DeliveryGuard acceptance 全 case 通过后方可宣称 v0.4.0 Done。

## Acceptance candidates

| case-id | Requirement | Type | Verification notes |
|---|---|---|---|
| `design-truth-catalog-sync` | FR-1 | agent/static | Truth Compiler + 漂移；valueKind/enum |
| `catalog-hasconfig-parity` | FR-1 | agent/static | applicable 与面板抽样一致 |
| `catalog-snippet-includes-enums` | FR-2 | agent | snippets 含 valueKind/constraints |
| `refine-summary-has-labelalign` | FR-3 | agent | snapshot 高精度键 + inherit |
| `refine-target-by-label` | FR-4 | agent | label 定位 |
| `refine-tab-batch-labelwidth` | FR-4 FR-5 | agent/playwright | tab 下批量 radio |
| `refine-labelalign-nl-parity` | FR-4 FR-5 | agent/playwright | NL 右对齐合法 enum |
| `refine-labelalign-reject-right` | FR-4 FR-5 | agent | 非法 enum 拦截 |
| `refine-labelwidth-number-parity` | FR-1 FR-4 FR-5 | agent | number vs 450px |
| `refine-size-enum-parity` | FR-1 FR-4 | agent | 禁止 default 字面量 |
| `refine-honest-summary` | FR-4 | agent/ui | 诚实完成语义 |
| `refine-v03-regression` | FR-5 | agent/playwright | v0.3 主路径 |
| `frontend-no-secret` | security | static | 前端无密钥 |
