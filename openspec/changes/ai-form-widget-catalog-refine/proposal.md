# Proposal: ai-form-widget-catalog-refine

| 项 | 值 |
|---|---|
| Change ID | `ai-form-widget-catalog-refine` |
| Target version | `v0.3.0` |
| Primary document | `docs/requirements/ai-form-widget-catalog-refine.md` |
| Supporting design | `docs/design/ai-form-widget-catalog-refine.md` |
| Affected repository | `app` (`.` / 本仓库) |

## Problem

`v0.2.0` 已支持基于当前 `formJson` 的多轮结构、options 与公式优化，但 Agent 的组件知识仍是手工维护的有限白名单，规划摘要也只包含少量字段信息。大量设计器常见属性无法通过现有 `updateField` 合入；样式类诉求只能 warning / 422，不能修改 `formConfig.cssCode`。

这会产生三类可观察问题：

1. LLM 能理解话术，但现有 plan schema / merger 无法表达和写入目标属性；
2. 多个同名、同类或嵌套控件出现时，缺少路径和关键 options 上下文，定位不够稳定；
3. Agent 没有从 v-form 组件定义持续同步的机器可读规范，新增或变化的组件容易与 Agent 白名单漂移。

## Scope

1. 建立以 `v-form/src/components/form-designer/widget-panel/widgetsConfig.js` 和默认 form 配置为真源的 Widget Catalog，描述组件类型、分类、默认 options、可写键、禁写键、枚举约束和嵌套形状。
2. 提供 Catalog 生成/同步与漂移校验机制，使 Agent 的规划、合入和校验共享同一份组件规范。
3. 扩展 refine 定位摘要，至少包含 `id`、`name`、`label`、`type`、稳定路径/父容器线索和必要的当前可写 options 快照。
4. 按目标组件类型向 LLM 注入相关 Catalog 片段，不把全量组件定义塞入单轮 prompt。
5. 扩展受限 RefinePlan 与代码合入能力，使 Catalog 中每个纳入类型的常见、非事件属性都可由自然语言精准修改。
6. 支持受控修改 `formConfig.cssCode`，并在需要时为目标控件设置 `customClass`；对 CSS 做长度、危险构造和作用域检查。
7. 延续 v0.2.0 的确认覆盖、未提及数据保留、FR-6 文案边界及结构/options/公式能力。
8. 补充 Agent 静态/契约验证与 Playwright 端到端验收，覆盖知识库同步、精准定位、属性写入、CSS 修复、非法输入拦截和 P0 回归。

## Non-goals

- 不开放任意事件脚本（如 `onChange`、`onCreated`、`onMounted`）的自然语言生成或改写。
- 不承诺本版完成 `data-table`、`sub-form`、`vf-dialog` 等重型容器的任意深层结构编排；Catalog 可描述其规范，但未支持的结构手术必须明确降级。
- 不引入 Agent 服务端会话持久化或多租户存储。
- 不处理 PDF、Word、图片 OCR。
- 不改变 DeepSeek Key 仅存 Agent 服务端的安全边界。
- 不改变生产部署拓扑。

## Affected contracts

| 契约/边界 | 变更 |
|---|---|
| Widget Catalog | 新增机器可读 Catalog 与生成/漂移校验；`widgetsConfig.js` 仍为组件事实源 |
| `POST /api/agent/v1/refine` | 请求/响应外壳保持兼容；扩展内部 plan 语义以支持类型化属性 patch 与受控 CSS |
| RefinePlan schema | `updateField` 支持 Catalog 驱动的属性 patch；新增 formConfig/CSS 相关受限操作 |
| Refine merger / validator | 按目标 type 校验可写键和值类型；拒绝禁写键、未知键、危险 CSS 和非法结构 |
| Planner context | 表单摘要加入路径/父级/关键 options；只注入相关组件知识 |
| `designer.getFormJson` / `loadFormJson` | 语义不变；每轮读取最新 JSON，确认后整表覆盖 |
| AiChat | 展示属性/CSS warnings 与确认信息；未确认或校验失败不写画布 |

## Design notes

### Catalog 不等于自由 JSON

Catalog 用于告诉模型和代码“什么可以改、值应是什么形状”。模型仍只产生受限操作，Merger 和 Validator 负责最终写入与拒绝，不允许模型直接返回未经校验的完整 `formJson`。

### “常见属性全覆盖”的边界

“全部”指 Catalog 对本版纳入的每个组件类型完整登记设计器中的常见非事件配置项，并允许通过统一类型化 patch 修改；事件回调、内部运行态字段和复杂数据源脚本不因存在于 `options` 就自动开放。

### 属性优先、CSS 补充

样式问题若有稳定的组件属性表达（如 `labelWidth`、`labelWrap`、`displayStyle`、`columnWidth`），优先修改属性；仅属性不足时生成 scoped `cssCode`。两条路径都不得改写未明确要求的文案。

### CSS 合并与安全

CSS 操作应尽量增量合并并绑定 `customClass`，避免覆盖用户已有样式。最低护栏包括长度上限、拒绝 `@import`、`expression(`、`javascript:` 等危险构造，并对过宽全局选择器 warning 或拒绝。具体限制在实现时固化为可测试规则。

### 精准定位与歧义

定位优先级建议为：显式 `id` → `options.name` → 稳定路径 → label/type/父容器组合。若自然语言仍命中多个候选且无法可靠消歧，必须返回 warning/拒绝，不可随机修改一个控件。

## Risks

| 风险 | 缓解 |
|---|---|
| Catalog 与组件库漂移 | 由生成/一致性检查比较类型集合与规范指纹，漂移即验证失败 |
| 全量知识导致 prompt 膨胀 | 基于目标控件类型按需注入，设置上下文预算 |
| 动态属性 patch 绕过类型检查 | Catalog 提供值约束，Schema + Merger + Validator 三层校验 |
| CSS 污染全局或覆盖用户样式 | 优先 scoped class、增量合并、危险规则拒绝、确认后写回 |
| 定位错误导致改错字段 | 使用 id/name/path/父级组合；歧义时拒绝；验收覆盖同名与嵌套场景 |
| 厚 P1 验收面较大 | 按知识层→契约→合入→UI→验收顺序实施，每层有独立可运行检查 |
| P0 回归 | 复用既有 generate/refine E2E 与 FR-6 用例作为回归门禁 |

## Acceptance criteria

1. Catalog 对 `widgetsConfig.js` 中本版纳入类型建立可验证映射，记录默认 options、常见可写键、禁写键和嵌套规则；源文件变化导致一致性检查失败。
2. Agent 规划时只注入当前请求相关的组件知识；表单摘要包含足以稳定定位的路径/父级和关键 options 信息。
3. 至少覆盖不同组件类型与不同值类型的常见属性自然语言修改，并确认写回画布；未提及控件及其属性保持不变。
4. 同名/同类/嵌套控件场景能命中指定目标；无法消歧时不产生随机改写。
5. 样式诉求可以通过组件属性和/或受控 `cssCode` + `customClass` 改善；用户未明确要求时，label/textContent/选项文案保持不变。
6. 未知属性、事件键、类型不匹配、危险 CSS 与非法结构被拒绝或给出可读 warning，且不覆盖当前画布。
7. v0.2.0 的生成、结构、options、公式、显式文案修改和 FR-6 样式禁改文案主路径回归通过。
8. DeepSeek Key 仍仅存在于 Agent 服务端。

## Acceptance candidates

| case-id | Requirement | Type | Verification notes |
|---|---|---|---|
| `widget-catalog-sync` | FR-1 | agent/static | Catalog 类型/默认 options/可写与禁写键和真源一致 |
| `refine-common-properties` | FR-2 | playwright | 不同控件的字符串/布尔/数字/枚举属性自然语言修改并应用 |
| `refine-precise-targeting` | FR-4 | playwright | 同名/同类/嵌套场景按描述命中正确控件 |
| `refine-ambiguous-target-reject` | FR-4 | agent/playwright | 无法消歧时 warning/拒绝且画布不变 |
| `refine-csscode-apply` | FR-3 FR-5 | playwright | 样式问题通过 scoped CSS/属性修复，文案不变 |
| `refine-csscode-reject` | FR-3 | agent/playwright | 危险 CSS 被拒绝且画布不变 |
| `refine-property-policy` | FR-1 FR-2 | agent | 未知键、事件键、类型错误被校验阻断 |
| `refine-p1-regression` | FR-5 | playwright | generate、tab/options/formula、显式文案路径回归 |

