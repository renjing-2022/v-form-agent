# PRD：设计真源 Catalog 与自然语言高精度对齐手动操作（v0.4.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-design-truth-catalog-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.4.0` |
| 状态 | 已验收（本地 acceptance passed；release 视部署事实） |
| 关联 OpenSpec | `ai-form-design-truth-catalog` |

## 1. 背景与问题

`v0.3.0` 已建立以 `widgetsConfig.js` 为真源的 Widget Catalog，并支持常见属性 refine 与受控 `cssCode`。但产品验收与真实使用仍暴露系统性缺口：

1. Catalog 主要反映**出厂默认 options 指纹**，未覆盖设计器属性编辑器中的合法枚举与取值语义（例如 `labelAlign` 必须为 `label-right-align`，而非自然语言常识中的 `right`）；
2. 规划时仅向模型注入 `writableKeys` / `forbiddenKeys`，**不注入 enum/约束**，模型「知道能改」却不知道「该写成什么」；
3. 表单摘要 `writableSnapshot` 缺少关键当前值（如 `labelAlign`），定位与改写缺少对照；
4. 字段级非法枚举可能被当成普通 string 写入，导致属性面板与画布「看起来没生效」。

业务方明确要求：

> **Agent 对 v-form 的知识库覆盖程度，应与查阅平台源码（设计器可配置面）无本质差异；自然语言描述的生成/优化结果，应与用户在设计器中手动操作达到高精确度一致。**

本版本将上述要求立为可验收产品目标，而不是口头愿景。

## 2. 产品成功标准（本版硬门槛）

1. **源码级知识覆盖（设计可配置面）**  
   Agent Catalog 必须能回答并约束：某控件在设计器里可配哪些属性、合法取值是什么、默认是什么、哪些键禁写。其信息完备度应达到：工程师打开 `widgetsConfig.js` + 对应 `property-editor` + 关键渲染 class 约定后所能确认的配置事实，而不是仅有一份键名列表。

2. **自然语言 ≈ 手动操作（高精确度）**  
   对已纳入本版的设计器操作（改标签对齐、显示样式、常见 options、表单级布局属性等），用户用自然语言表达的意图，经确认写回后，画布 JSON 与属性面板状态应与手动点选同一操作等价（合法值、目标控件、未提及项保留）。

3. **错值不可静默成功**  
   模型若输出设计器不接受的值（如 `labelAlign: "right"`），必须被拒绝或 strip，并给出可读说明（提示合法枚举），不得留下「JSON 有值但面板/样式不生效」的半成功状态。

## 3. 本版本目标

1. **多真源 Catalog 2.0**：以设计可配置面为范围，合并至少三类真源并保持可同步校验：
   - `widgetsConfig.js`（及默认 formConfig）：类型、默认 options、嵌套形状；
   - `setting-panel/property-editor`（及属性注册表）：枚举、控件适用性、取值形态；
   - 关键渲染约定（如 `label-*-align` class）：保证写入值与视觉/面板一致。
2. **按需注入完整约束**：规划器对本轮相关 type 注入可写键 + **enum/类型约束**（及必要说明），禁止只给键名。
3. **摘要对照**：`formSummary`/`writableSnapshot` 覆盖本版高精度操作所依赖的当前属性值（至少含 `labelAlign`、`displayStyle`、`labelWidth` 等布局/样式相关键）。
4. **合入与校验同源**：Merger/Validator 使用同一 Catalog 约束；非法枚举不得写入可应用结果。
5. **高精度验收矩阵**：建立「自然语言话术 → 等价手动操作」对照用例（正例 + 错值负例），覆盖多控件批量与单控件场景。
6. **延续既有能力**：v0.1–v0.3 的生成、Excel、结构/公式、受控 CSS、FR-6 文案边界、以及已修复的 `defaultValue` 误伤校验，不得回退。

## 4. 非目标（本版本不做）

- 将「读源码级」扩展到任意自由编写事件 JS / `functions` / 数据源脚本并作为主验收路径（Catalog 可登记事件键为**已知但禁写**，执行面另版）；
- 承诺重型容器（data-table / sub-form / dialog 等）一次对话完成任意业务编排；
- Agent 运行时在线检索整仓源码（Cursor 式 RAG）作为主路径；
- PDF / Word / OCR；服务端会话持久化；生产拓扑变更。

说明：非目标不等于永久不做；交互执行面与重型结构仍属终局，但不在本版用「知识库更全」冒充已交付。

## 5. 用户与场景

| 编号 | 场景 | 成功标准 |
|---|---|---|
| S1 | 标签右对齐 / 居中 | 自然语言「右对齐」写入 `label-right-align`（字段级或表单级按意图），属性面板显示对应选项，画布标签对齐可见变化 |
| S2 | 错值防护 | 若模型产出 `right`/`center` 等非法值，结果不可应用或被纠正为合法枚举，并有可读 warning |
| S3 | 与手动操作等价 | 同一批 radio 上，NL「全部右对齐」与手动逐个选择右对齐后的关键 options 一致（允许 id/name 稳定保留） |
| S4 | 知识可追溯 | Catalog 条目能指出约束来自哪类真源（widgetsConfig / editor / render），漂移检查失败即阻断 |
| S5 | 回归 | v0.3 主路径（属性、CSS、定位、FR-6、defaultValue 共存）仍通过 |

## 6. 功能需求

### FR-1 设计真源覆盖

- Catalog 必须覆盖本版纳入的设计器可配置属性之**合法值空间**，不得仅有出厂默认值类型推断；
- 字段级与表单级共享语义的属性（如 `labelAlign`）必须使用与设计器相同的枚举集合；
- 事件等禁写键仍须在 Catalog 中可见为 forbidden，避免模型「以为不存在」。

### FR-2 注入与规划

- `catalogSnippets`（或等价结构）必须包含本轮相关属性的 enum/约束摘要；
- Planner 系统提示须明确：对齐类等属性只能使用 Catalog 枚举字面量；
- 上下文仍按需注入，禁止把全量 Catalog 无差别塞入单轮 prompt。

### FR-3 摘要高精度

- 对高精度操作相关键，摘要必须带上当前值（含空字符串表示「继承表单」的语义说明，若需要）；
- 多轮仍以最新 `getFormJson()` 为画布真相源。

### FR-4 合入精确度与失败可读

- 非法枚举、未知键、禁写键：统一 strip 或拒绝，并 warning；
- 成功路径：确认后 `loadFormJson` 整表覆盖；未确认不改画布；
- 批量修改（如「所有评分项右对齐」）必须稳定命中目标集合，歧义时拒绝而非部分乱改。

### FR-5 等价性验收

- 至少一组「NL ↔ 手动操作」对照用例纳入自动化（Agent 契约 + 必要的 Playwright）；
- 至少一组历史缺陷回归：`labelAlign` 不得接受 `right`；有 `defaultValue` 时仍可改对齐。

## 7. 验收标准（产品层）

1. Catalog 对纳入属性的枚举/约束与设计器编辑器一致，漂移检查可失败阻断。
2. 「右对齐/居中」类话术端到端写入合法枚举并在属性面板/画布可观察生效。
3. 非法枚举不能形成可确认的错误成功态。
4. 规划注入内容可证明包含 enum（契约测试），而非仅 writableKeys。
5. v0.3 回归通过；DeepSeek Key 仍仅存 Agent 服务端。

## 8. 约束与假设

- 模型：DeepSeek 云 API；
- 「与读源码一样」的范围界定为 **设计器可配置面的静态规范**（结构 + 属性合法域 + 禁写），不是动态调试整个运行时；
- 「与手动操作高精确度」指写入结果等价，不要求复刻鼠标点击过程；
- 合入与校验以代码 + Catalog 为准，模型输出不可信任。

## 9. 风险

- 属性编辑器数量大、形态不一 → 需可增量同步与覆盖率门槛，避免「宣布全面却大量缺枚举」；
- 注入变厚导致上下文膨胀 → 严格按目标 type/本轮触及键注入；
- 过度承诺「读源码一样」若含事件执行 → 本版用非目标划清，避免范围失控。

## 10. 实现里程碑与完成定义（OpenSpec）

权威任务清单：`openspec/changes/ai-form-design-truth-catalog/tasks.md`。

| 阶段 | 范围 |
|---|---|
| **v0.4.0-a** | DesignTruthGraph 编译 + 统一 Validator + IntentGate（形态门禁、诚实 summary） |
| **v0.4.0-b** | NL 归一/label 定位/tab 批量 + generate/Excel 同源 + Playwright + DeliveryGuard acceptance |

**v0.4.0 Done** 条件：两阶段任务全部勾选；acceptance 表无 pending/partial（已 verified 项除外）；不得仅凭局部 enum 同步宣称「源码级全面覆盖」。
