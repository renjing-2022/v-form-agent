# Tasks: ai-form-widget-catalog-refine

有序、可验证任务。仅在实现与相关检查实际完成后勾选；OpenSpec 意图不作为 source 或 acceptance 证据。

## 1. Catalog 真源与生成

- [x] 盘点 `widgetsConfig.js`、默认 formConfig 和容器运行时结构，定义 Catalog schema：type/category/defaultOptions/writableKeys/forbiddenKeys/structure/constraints
- [x] 实现 Catalog 生成或同步脚本，以 `widgetsConfig.js` 为组件事实源，产出 Agent 可导入的机器可读结果
- [x] 为所有本版纳入组件登记常见非事件属性；事件回调、内部运行态字段与复杂脚本字段明确列入禁写或非本版范围
- [x] 建立 Catalog 漂移检查：组件类型、关键默认 options 或规范指纹变化时验证失败，并提供可读差异
- [x] 增加 Catalog schema/覆盖率/漂移检查自动化用例，产生稳定的 `widget-catalog-sync` 验证输出

## 2. Refine 契约与策略

- [x] 扩展 RefinePlan schema，支持 Catalog 驱动的类型化属性 patch，并保持现有 `updateField`、公式和结构操作兼容
- [x] 定义并实现受限 formConfig/CSS 操作（含必要的 `customClass` 绑定），禁止模型直接返回未经校验的完整 formJson
- [x] 规定未知键、禁写键、类型错误和枚举错误的统一行为（拒绝或 strip + warning），并固化为契约测试
- [x] 更新 Planner 规则：属性可表达时优先属性，属性不足时使用受控 CSS；未明确要求时禁止改文案

## 3. 精准定位与按需知识注入

- [x] 扩展 form 摘要遍历，记录稳定 path、父容器线索和相关 writable options 当前值，同时保持数量/深度/长度边界
- [x] 实现目标候选匹配优先级：id → name → path → label/type/父级组合，并检测歧义
- [x] 歧义无法消除时返回可读 warning/拒绝，不随机修改任一控件
- [x] 根据目标候选 type 按需注入 Catalog 片段，限制单轮知识上下文大小，不发送无关全量 Catalog
- [x] 增加同名、同类、嵌套及多轮最新 formJson 的定位测试

## 4. 属性合入与校验

- [x] 扩展 Merger：按目标 type 的 `writableKeys` 写入字符串、布尔、数字、枚举、数组/对象等受支持属性
- [x] 保证未提及节点、id/name、未请求 options 与用户已有配置原样保留
- [x] Validator 复用 Catalog 对属性键、值类型、枚举和容器形状做最终检查
- [x] 未纳入结构手术能力的重型容器返回明确 warning，不产生半合法树
- [x] 增加至少覆盖不同组件类型和值类型的属性合入正例，以及未知/禁写/类型错误负例

## 5. 受控 cssCode

- [x] 实现 cssCode 增量合并策略，保留已有用户 CSS，并可为目标控件生成/复用 scoped `customClass`
- [x] 实现 CSS 长度上限及危险构造检查，至少拒绝 `@import`、`expression(`、`javascript:` 等规则
- [x] 对过宽全局选择器、无法稳定作用于目标控件的样式给出 warning 或拒绝
- [x] 样式请求优先使用可表达的组件属性；进入 CSS 路径时继续执行 FR-6 文案保护
- [x] 增加安全 CSS 应用、已有 CSS 保留、危险 CSS 拒绝、样式请求文案不变的自动化测试

## 6. API 与前端交互

- [x] 保持 `POST /api/agent/v1/refine` 请求/响应外壳兼容，接入扩展 plan、Catalog、定位、属性与 CSS 校验链路
- [x] AiChat 展示属性/CSS warnings 与目标摘要；校验失败或歧义时不提供可应用的错误结果
- [x] 确认前画布不变；确认后通过 `loadFormJson` 写入最新预览结果，并保留整表覆盖提示
- [x] DeepSeek Key 与其他服务凭证继续仅存在于 Agent 服务端

## 7. 验证、文档与 DeliveryGuard 收口

- [x] 更新 Agent 使用/架构说明：Catalog 真源、同步命令、可写/禁写边界、CSS 护栏和定位规则
- [x] `cd agent && npm run typecheck` 通过
- [x] `cd agent && npm run acceptance:cases` 通过，并覆盖 Catalog、属性策略、定位歧义与 CSS 护栏
- [x] `cd agent && npm run smoke` 通过，确认 generate/refine API 兼容
- [x] `cd e2e && npm run typecheck` 通过
- [x] 按 DeliveryGuard E2E 约定新增/维护 Playwright 用例及 case-map，运行 v0.3.0 验收候选
- [x] 复跑 v0.2.0 主路径回归：生成、tab/options/formula、显式文案、样式禁改文案
- [ ] 实现完成后仅从真实 revision 记录 source；建立 v0.3.0 Evidence Manifest 并验证后再更新 acceptance
- [x] 运行 `deliveryguard check`，在无诊断且任务完成后再申请归档 OpenSpec

## Acceptance candidates

证据目录候选：`docs/evidence/v0.3.0/`。Agent 检查使用 `cd agent && npm run acceptance:cases`；UI 验收使用 `cd e2e && npm test` 并设置项目既有的 v0.3.0 evidence 环境变量。

| case-id | Requirement id(s) | Type | Verification notes | Exploratory? | Status |
|---|---|---|---|---|---|
| `widget-catalog-sync` | `FR-1` | agent/static | Catalog 与 widgetsConfig 类型/默认属性/策略一致；漂移可检测 | no | candidate |
| `refine-common-properties` | `FR-2` | playwright | 多类型、多值类型常见属性自然语言修改并确认写回 | yes | candidate |
| `refine-precise-targeting` | `FR-4` | playwright | 同名/同类/嵌套场景精准命中指定目标 | yes | candidate |
| `refine-ambiguous-target-reject` | `FR-4` | agent/playwright | 歧义 warning/拒绝且画布保持不变 | no | candidate |
| `refine-csscode-apply` | `FR-3` `FR-5` | playwright | scoped CSS/属性改善样式且文案不变 | yes | candidate |
| `refine-csscode-reject` | `FR-3` | agent/playwright | 危险 CSS 被拦截且画布不变 | no | candidate |
| `refine-property-policy` | `FR-1` `FR-2` | agent | 未知键、事件键、类型/枚举错误被拦截 | no | candidate |
| `refine-p1-regression` | `FR-5` | playwright | generate、tab/options/formula、显式文案等 P0 回归 | no | reuse/extend |
| `frontend-no-secret` | security boundary | static | 前端无 DeepSeek Key 或其他服务端凭证 | no | reuse |

### Candidate rules

1. UI 新 case-id 实现时同步更新 `.agents/skills/deliveryguard-e2e/references/case-map.md`。
2. Exploratory 发现且固化为 Playwright 的缺陷，按项目约定更新 promotion log。
3. 只有证据产物存在且 Evidence Manifest 校验通过后，candidate 才可标记 verified。
4. source 未达到 `submitted|merged` 前，版本 acceptance 保持 `pending`。
