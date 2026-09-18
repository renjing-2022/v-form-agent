# 技术设计：设计真源 Catalog 与 NL↔手动高精度（v0.4.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-design-truth-catalog-design` |
| 类型 | technical-design |
| 目标版本 | `v0.4.0` |
| 关联 PRD | `docs/requirements/ai-form-design-truth-catalog.md` |
| 关联 OpenSpec | `ai-form-design-truth-catalog`（任务清单见 `tasks.md`） |

## 1. 设计目标

在不破坏 v0.3 refine 主链路的前提下，将 Catalog 从「出厂 options 指纹」升级为 **DesignTruthGraph（设计器可配置面真源图）**，并打通：

**真源编译 → 按需注入 → 同源 sanitize/validate → IntentGate 诚实完成 → NL 与手动操作等价验收。**

产品硬门槛（摘自 PRD）：

1. 知识库覆盖 ≈ 查阅设计源码（静态规范）；  
2. NL 结果 ≈ 手动操作（合法值 + **正确值形态**）；  
3. 未落地 **不得** 成功 summary / toast。

## 2. 总体架构

```text
[ L1 widgetsConfig + formConfig ]
[ L2 propertyRegister.js ]
[ L3 designer.hasConfig → applicable ]
[ L4 {type}-{prop}-editor 覆盖链 ]
[ L5 219 × property-editor → valueKind / enum ]
[ L6 propertyMixin + editor v-if → linkage ]
[ L7 form-item-wrapper 等 → render 约定 ]
        |
        |  Truth Compiler + 漂移 fingerprint
        v
[ DesignTruthGraph / Catalog 2.0 ]
  节点: (scope, type, prop)
  字段: applicable, editor, valueKind, enum, inheritEmpty, unit,
        compositeSchema, linkage, source, nlSynonyms?
        |
        +--> generate / Excel / refine 共用 Validator
        |
[ AiChat ] --> refine | generate
        | 1) formSummary（高精度键 + 按需 optionItems/defaultValue）
        | 2) NL 归一（口语 → 合法字面量）
        | 3) catalogSnippets（命中键优先：valueKind + enum + inherit）
        | 4) RefinePlan（受限 op；含 label/parentScope/batch）
        | 5) sanitize + merge + validate（同源 Graph）
        | 6) IntentGate：未落地 → 422；summary 机器校验
        v
[ summary, warnings[], formJson ] -> 确认 -> loadFormJson（前端绑定 post-merge）
```

## 3. DesignTruthGraph 节点形态

在 v0.3 Catalog schema 上扩展（保持可解析升级）：

| 字段 | 要求 |
|---|---|
| `applicable` | `hasConfig(type, prop)` 等价结果；禁止 type 级 writable 大杂烩 |
| `editor` | 最终生效的 editor 名（含 type 覆盖） |
| `valueKind` | number / string / boolean / enum / cssText / cssSize / array / object |
| `constraints.enum` | 设计器合法字面量；含 `""` 继承语义 |
| `inheritEmpty` | 空串/null 是否表示继承 formConfig |
| `unit` | 如 labelWidth 为 number+px 渲染，columnWidth 为 cssText |
| `compositeSchema` | optionItems、列定义等 item 形状 |
| `linkage` | 条件可见/强制联动（remote、multiple、autosize…） |
| `source` | widgets-config / property-editor / render-convention / policy |
| `writableKeys` / `forbiddenKeys` | 事件等 forbidden 但必须可见 |

### 真源优先级（冲突时）

1. property-editor 明示枚举 / 控件绑定  
2. 渲染 class / 表单约定（保证生效）  
3. widgetsConfig 默认值（存在性与出厂形态，**不**单独推断 valueKind）  
4. catalogPolicy 手写策略（禁写、结构手术、扩展边界）

## 4. 注入、摘要与 NL

### 4.1 catalogSnippets

每个相关 type 至少包含（**instruction 命中键优先，禁止只给 keys**）：

- `writableKeys` / `forbiddenKeys`（摘要）  
- `constraints`：valueKind + enum + inherit 说明  

### 4.2 formSummary.writableSnapshot

高精度键：`labelAlign`, `displayStyle`, `labelWidth`, `labelWrap`, `labelHidden`, `size`, `placeholder`…  
按需：`optionItems`, `defaultValue`, `validation`。  
统一 `MAX_FIELDS` 截断策略。

### 4.3 NL 归一与定位

- 同义词：「右对齐」→ `label-right-align`；「标签宽度 450」→ `labelWidth: 450`（number）  
- 定位：id / name / **label** / **parentScope**（tab-pane）  
- 批量：「同一 tab 下所有 radio」→ scope batch op  

### 4.4 Planner

枚举必须使用 Catalog 字面量；number/cssText 形态写进提示与 snippets。

## 5. 合入、Validator 与 IntentGate

- `valueMatchesConstraint` 为 sanitize 与 catalogValidator **唯一**匹配入口；  
- HIGH_PRECISION 键：**零** nullish 出厂指纹；`labelWidth` number；`size` 禁止 `"default"`；  
- `applicable=false` → strip + warning；linkage 违反 → strip 或 422；  
- **IntentGate**：用户意图涉及的键 merge 后未变合法 → 422；  
- summary **机器生成/校验**，禁止模型自说成功；  
- 前端 toast 绑定 post-merge，非 HTTP 200。

### loadFormJson 前契约（v0.4）

- Agent `POST /generate|/refine` 路径：`sanitize → merge → validateFormJson → IntentGate` 已完成 Catalog 同源校验；  
- 用户确认「应用到设计器」时，`setting-panel.applyAiFormJson` **不复跑全量 Catalog**，但执行 `preApplyFormJsonGate`：  
  - 拦截 duplicate `widget.id` 等 loadFormJson 必失败结构；  
  - 失败则 toast 错误且**不写画布**；  
- 完整 Catalog 复验留在 Agent；客户端仅结构门闩（可选二次校验的契约落点）。

## 6. 三路径统一

- `addField` 从 **widgetsConfig** 默认 options 克隆，消除 `widgetTemplates` 漂移；  
- generate / Excel 与 refine **同一 Graph/Validator**（v0.4.0-b）。

## 7. 等价性与测试设计

| 类型 | 例子 |
|---|---|
| 形态 | `labelWidth: 450` OK；`450px` 拒绝 |
| enum | `labelAlign=right` 拒绝；`label-right-align` OK |
| 诚实 | strip 后 summary 不得称「已全部右对齐」 |
| 批量 | 同一 tab 下所有 radio labelAlign 一致 |
| 定位 | 「性别」字段按 label 命中 |
| applicable | 面板无项的键 patch 被 strip |
| 回归 | defaultValue 共存；v0.3 主路径 |

浏览器：Playwright 至少一条面板/画布可观察用例。

## 8. 里程碑

| 阶段 | 交付 |
|---|---|
| **v0.4.0-a** | §3 Graph + §5 Validator/IntentGate + 形态/诚实 acceptance |
| **v0.4.0-b** | §4 NL/批量 + §6 三路径 + Playwright + DeliveryGuard |

## 9. 非本版技术范围

- 事件脚本**执行**主路径；在线整仓 RAG；  
- 全部手动操作（delete/move/reorder）等价；  
- 运行时 custom widget 静态全覆盖（extension policy）；  
- 重型容器任意结构手术（可登记 shape，op 分期）。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 219 editor 解析不全 | 分 kind 解析 + 50 抽样 + catalog:check 覆盖率 |
| Prompt 膨胀 | 按命中 (type,prop) 注入 |
| 第二真源 | widgetsConfig 克隆 + drift 阻断 |
| 假完成 | IntentGate + DoD（见 tasks.md） |
