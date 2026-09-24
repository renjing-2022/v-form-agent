# PRD：v-form AI 组件知识库与厚 P1 优化（v0.3.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-widget-catalog-refine-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.3.0` |
| 修订 | 2（2026-09-24：对齐 DeliveryGuard 已发布事实） |
| 状态 | released（DeliveryGuard `release.published`；acceptance passed；OpenSpec `archived`） |
| 关联 OpenSpec | `ai-form-widget-catalog-refine` |

## 1. 背景与问题

`v0.2.0`（P0）已交付多轮 refine：结构（含 tab）、`optionItems`、公式，以及「样式诉求不得改文案冒充修复」（FR-6）。业务终极目标仍是：用自然语言对当前画布做**精准、合规范**的配置与样式调整。

当前缺口：

1. `updateField` 可写键过窄（基本只有 label / required / optionItems / textContent），大量常见属性话术无法落地；
2. 纯样式问题只能 warning / 422，无法写 `formConfig.cssCode`；
3. Agent 仅有部分类型白名单与瘦 `formSummary`，**不具备**以 `widgetsConfig.js` 为真源的全组件知识库，定位与改写易偏。

本版本采用**厚 P1**策略：一次交付知识库底座 + 常见属性全覆盖写入 + 受控自定义 CSS，避免按零碎属性/细小问题反复开小版本。

## 2. 本版本目标（厚 P1）

1. **组件知识库（Catalog）**：以 `v-form/.../widgetsConfig.js`（及默认 formConfig）为规范真源，为 Agent 提供机器可读的组件结构、默认 options、可写键、禁写键、嵌套形状；规划时按目标控件**按需注入**，支撑精准定位与合规范合入。
2. **常见属性全覆盖**：对 Catalog 中登记的每个组件类型，开放设计器常见可配置属性的自然语言改写（非事件脚本）；合入仍走「模型规划 → 代码合入与校验」。
3. **受控 `cssCode`**：允许根据用户样式/布局描述生成或修订 `formConfig.cssCode`（及必要的 `customClass`），经护栏校验后进入预览，用户确认后整表写回。
4. **精准定位**：每轮仍以最新 `getFormJson()` 为真相源；摘要与 Catalog 足以用自然语言稳定命中目标控件（id / name / label / 类型 / 路径）。
5. **延续 P0 能力**：结构 / options / 公式 / FR-6 文案边界在扩展属性与 CSS 后仍然有效——有 CSS 能力后，仍禁止用改字冒充样式修复。

## 3. 非目标（本版本不做）

- 自由生成任意事件 JS（`onChange` / `onCreated` 等）作为主验收路径；
- 重型容器的复杂结构深改一次承诺（如 data-table / sub-form / dialog 的完整业务编排）；未支持时须可读 warnings，不得半残树；
- Agent 服务端会话持久化、多租户存储；
- PDF / Word / 图片 OCR；
- 生产拓扑或密钥存放方式变更。

以上仍属终局路线，可在后续版本（如事件脚本 / 重型容器）单独验收。

## 4. 用户与场景

| 编号 | 场景 | 成功标准 |
|---|---|---|
| S1 | 知识库驱动改属性 | 对白名单内组件，用自然语言改常见 options（如 placeholder、labelWidth、displayStyle 等）可预览并确认写回 |
| S2 | 样式 / 重叠类诉求 | 「标签与选项重叠」等可走属性修复和/或受控 cssCode，不得仅改文案；确认后画布视觉可改善 |
| S3 | 精准定位 | 多字段表单中按名称/标签/类型描述能命中正确控件；未提及控件保持不变 |
| S4 | 规范合入 | 非法键、禁写键、非法嵌套或危险 CSS 被拒绝或 warning，未确认不写画布 |
| S5 | P0 回归 | 整表生成、多轮结构/options/公式、FR-6 显式改文案与样式禁改文案仍可用 |

## 5. 功能需求

### FR-1 Catalog 真源与同步

- Catalog 必须以仓库内 `widgetsConfig.js`（及既有默认 form 配置约定）为来源，可生成/维护为 Agent 可读产物；
- 含：type、结构形状、默认 options、**可写属性清单**、禁写键（至少含事件回调类）、容器嵌套规则；
- 规划器不得依赖模型「背」全量规范；应按目标 type 注入相关片段。

### FR-2 常见属性 refine

- 扩展 `updateField`（或等价 op）可写键至各类型「常见属性」全集（以 Catalog 为准）；
- 仅允许写入 Catalog 标明可写的键；类型不匹配或未知键进入 warnings / 拒绝；
- 未提及字段的 id / name / 未请求属性必须保留。

### FR-3 受控 cssCode

- 支持根据样式意图增补或修订 `formConfig.cssCode`；可配合 `customClass`；
- 须有护栏（如长度上限、禁止明显危险构造）；校验失败不写画布；
- UI 仍须用户确认后 `loadFormJson` 整表覆盖。

### FR-4 定位与摘要

- 传给规划器的表单摘要须足以定位（不少于 id/name/label/type；必要时含 path 或关键 options 快照）；
- 多轮会话仍以每轮最新 formJson 为准。

### FR-5 文案与样式边界（延续并强化 FR-6）

- 仅当用户明确要求改文案时，才可改 label / textContent / 选项文字；
- 样式类诉求优先属性与 cssCode；禁止改字冒充样式修复。

## 6. 验收标准（产品层）

1. Catalog 覆盖 `widgetsConfig.js` 中本版纳入的组件类型，且可写/禁写键可被校验引用。
2. 至少一类「常见属性」自然语言改写可端到端确认写回；非法属性被拦截。
3. 至少一类样式诉求可通过受控 cssCode（和/或属性）改善，且不触碰未请求文案。
4. 多字段场景下定位正确；P0 生成与 refine 主路径回归通过。
5. DeepSeek Key 仍仅存 Agent 服务端。

## 7. 约束与假设

- 模型：DeepSeek 云 API；
- 规范真源：`widgetsConfig.js` + 默认 form 配置；**合入与校验以代码为准**；
- 应用策略：整表确认覆盖；
- 厚 P1 一次交付主诉求；细小缺陷以同版本修复/回归处理，不为每个属性另开交付版本。

## 8. 风险

- Catalog 与 `widgetsConfig` 漂移 → 生成管线或校验失败即阻断，避免静默过期；
- 开放过多 options + cssCode → 护栏与验收矩阵必须先于放行；
- 上下文膨胀 → 按目标 type 按需注入，禁止整库塞入单次 prompt。
