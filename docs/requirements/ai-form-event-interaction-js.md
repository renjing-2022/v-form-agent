# PRD：交互执行面第一刀 — 事件 shape 登记 + 澄清闭环（v0.7.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-event-interaction-js-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.7.0` |
| 修订 | 3（2026-09-22：纯前端事件全覆盖预留写权限；接口类仍禁；本版仍不合入 JS） |
| 状态 | proposed（未实现；source / acceptance 均为空） |
| 关联 OpenSpec | `ai-form-event-interaction-js` |
| 前置版本 | `v0.6.0` released — 重型容器扁平列 / sub-form / vf-dialog 壳层 |
| 后续版本 | `v0.8.0` planned — OpenSpec `ai-form-event-js-execution`（生成 + 护栏 + 真实渲染 applied） |

## 1. 背景与问题

`v0.6.0` 及之前，所有 `on*` 事件键与 `formConfig.functions` 在 Agent 侧一律 **forbidden（必须为空）**：`isEventKey` + `catalogValidator` 强制 strip，acceptance 有 `refine-dialog-event-forbid` 等负例锁死。表单的**交互执行面**（计算、跨字段规则、联动、校验反馈）无法通过自然语言落地。

上一稿曾把「生成 JS + 真实运行时断言后才 applied」写进同一版。拍板后明确：**先把事件知识与意图澄清做成可验收切片**；把「写进 JSON 并证明跑得对」放到单独一版。这样 v0.7 不假装已经完成交互执行。

## 2. 用户确认边界

| 决策项 | 选择 | 拍板 |
|---|---|---|
| 危险能力（网络 / `dataSources` / `functions` 内网络 / DOM / `eval` / 动态代码 / 定时器） | **一律禁止**，另版再评估 | 2026-09-21 |
| 终局验收锚点 | **必须保证运行正确**：applied 事件须过 **Playwright 真实 VForm 渲染执行断言** | 2026-09-21；**交付落在后续版，不在 v0.7** |
| 交互 API | **新端点** `POST /api/agent/v1/event`；不扩 `/refine` | 2026-09-22 |
| 可写事件面（v0.8 才合入） | **设计器已登记的纯前端事件全覆盖**（含组件 `onCreated`/`onMounted`、表单 `onFormCreated`/`onFormMounted`、子表 `onSubFormRow*`、表格/树/弹窗等面板事件） | 2026-09-22 修订 |
| 接口类事件 | **不做**：`onRemoteQuery`、上传族（`onBeforeUpload`/`onUploadSuccess`/`onUploadError`/`onFileRemove`）、`dataSources` | 2026-09-21 + 2026-09-22 |
| 执行 harness | **Playwright 真实渲染**（非 Node mock-this） | 2026-09-22；**实现落在后续版** |
| 版本切分 | **v0.7 = shape 登记 + 澄清闭环**；生成 / 护栏 / 合入 / 执行验收 **单独一版** | 2026-09-22 |

## 3. 版本定位

> v0.7 交付「能问清楚、能登记对」：新事件端点根据当前 `formJson` 做多轮澄清，产出完备 **EventSpec**（含可判定示例）；事件 shape 与运行时真源对齐。本版 **不生成、不合入、不执行** 事件 JS，**不改写** v0.6「事件必须为空」的合入断言。

终局仍是：任意 NL → 受约束 JS → 真实渲染证明正确。那是后续版的 G3，不是本版话术。

## 4. 终局目标与本版切片

| 切片 | 版本 | 可对外声称 |
|---|---|---|
| 事件 shape 可见且与运行时签名一致；意图可澄清为 EventSpec | **v0.7.0（本版）** | 问清楚了；知识对齐了 |
| 受约束 JS 生成 + 静态白名单护栏 + 合入 | **后续版** | 代码写进 JSON，且过静态安全闸 |
| Playwright 真实渲染按示例断言后才 applied | **后续版（与生成同版）** | 跑对了才算成功 |

## 5. 功能需求（本版）

### FR-1 新端点与澄清闭环

- 新增 `POST /api/agent/v1/event`。`/api/agent/v1/refine` **行为不变**（仍禁止事件键 / `functions` / `dataSources`）。
- 响应态至少两种：
  - `need_clarification`：EventSpec 不完备 → **只返回定向问题**，不生成 JS，不改 `formJson` 事件键；
  - `spec_ready`：返回结构化 EventSpec + 摘要；`formJson` 事件键保持原样（本版通常仍为空）。
- EventSpec 完备条件（缺一则继续澄清）：触发控件与事件键、落点（哪个 `on*` 或后续才写的 `functions`）、覆盖策略意向、**至少一个可判定示例**（`给定输入 → 期望后置状态`）。
- 可判定示例在本版是**澄清完备判据**，并作为后续版生成规格 / 执行 oracle 的契约预留；本版 **不跑** 该示例。

### FR-2 事件 shape 登记（知识层）

- 为 Catalog / `EVENT_PROPERTIES` / `formConfig` 中出现的事件键登记：归属、形参签名、`this` API 白名单、典型意图标签、**写权限**。
- 本版 **合入层仍全部禁写**（与 v0.6 一致）。登记 ≠ 本版可写。
- **`writableIn=v0.8`（预留）：** 一切纯前端事件，含 `onCreated` / `onMounted` / `onFormCreated` / `onFormMounted` / `onSubFormRow*` / 表格与树与弹窗面板事件等（完整表见 v0.8 PRD §6）。
- **`writableIn=never`：** `onRemoteQuery`、上传族、`dataSources`。
- `catalog:check` 校验形参与 v-form 运行时 `new Function(...)` 真源一致。

### FR-3 前端澄清 UI

- `AiChat`（或等价入口）在交互意图下走 `/event`；展示澄清问题并带上会话 `messages` 续问。
- `spec_ready` 时展示 EventSpec 摘要（含示例）；**不提供「确认写回事件代码」**（该按钮属后续版）。
- 结构 / 属性 / formula 优化仍走 `/refine`。

## 6. 用户与场景（本版 P0）

| 编号 | 场景 | 成功标准 |
|---|---|---|
| S1 | 意图不完备（缺字段 / 缺触发 / 缺示例） | `need_clarification` + 定向问题；`formJson` 事件键不变 |
| S2 | 多轮补全后意图完备 | `spec_ready`；EventSpec 含触发、落点、至少一条可判定示例 |
| S3 | 「改单价时把金额设为单价×数量」类计算意图 | 澄清后 EventSpec 指向具体字段 name 与 `onChange`；**不写 JS** |
| S4 | 「选是则显示备注」类联动 | 同上；示例含条件真/假两条更佳，至少一条 |
| S5 | 「表单一打开就把某字段设只读」类生命周期 | EventSpec 可指向 `onCreated` / `onMounted` / `onFormMounted`；**本版不写 JS** |
| S6 | 「子表增行时带出默认值」 | EventSpec 可指向 `onSubFormRowAdd` 等；**本版不写 JS** |
| S7 | 「请求接口填充下拉」类接口意图 | 诚实拒绝；不产出可写 EventSpec |

## 7. 非目标（本版不做）

- **生成**事件 JS / `formConfig.functions` 函数体；
- **合入** `options.on*` / `functions`（v0.6 禁写断言保持 pass）；
- **静态 AST 护栏作为合入闸**、**Playwright 真实渲染执行断言**、`applied` 基于运行时正确；
- 任何网络能力、DOM、`eval` / `Function` 构造、动态 `import`、定时器；
- 接口类事件（远程查询 / 上传 / `dataSources`）；列 `render`（非事件属性，另议）；
- 已有手写事件的覆盖/合并（无写路径则无此问题）；
- 真实 LLM 作为必选验收（澄清可 mock）；
- 会话服务端持久化、生产 LLM 监控。

## 8. 明确的能力天花板（诚实声明）

- 本版**只能保证**：事件 shape 与运行时签名一致；不完备意图被追问；完备时给出 EventSpec，且**不把事件代码写进画布**。
- 本版**不能声称**：已经「自行完成 JS 交互」；不能声称运行时正确。那是后续版在 EventSpec 示例上做生成 + 真实渲染断言之后的话术。

## 9. 测试与验收设计

- static：`event-shape-registry-parity`（签名 vs 运行时真源；写权限全为禁写）；
- agent：澄清不完备 / 完备 / 接口意图拒绝 / 生命周期与子表行可出 EventSpec；
- 回归：`refine-dialog-event-forbid` 等 v0.6 事件禁写 **必须仍 pass**；v0.6 重型容器 + formula + `catalog-full-strict-sweep` + `frontend-no-secret`；
- Playwright：可选 mock-only 澄清 UI（问题可见）；**不**做事件执行冒烟；
- 证据 → `docs/evidence/v0.7.0/`；DeliveryGuard acceptance + `docs/acceptance/v0.7.0.md`。

## 10. Breaking changes（相对 v0.6）

本版 **无合入层 breaking**。事件键在 validator / merger 侧仍必须为空。

允许的可观察变化仅限：

| 位置 | v0.6 | v0.7 |
|---|---|---|
| Catalog 事件元数据 | 多仅为 forbidden 列表 | 增加 shape（params / thisApi / writableIn），**forbiddenKeys 仍含全部 on\*** |
| 新增 HTTP 端点 | 无 `/event` | 有 `/event`，不影响 `/refine` |
| `AiChat` | 只调 `/refine` | 交互意图可调 `/event`；refine 路径不变 |

后续版才会改写 `catalogValidator`「事件必须为空」与 `refine-dialog-event-forbid` 的「一律不可落地」语义。

## 11. 风险

见技术设计 § Risks。对本版：澄清问题质量（mock 可测、真 LLM 漂移）；shape 提取漏签；前端误把 `/event` 当写画布；话术越界声称「已能写 JS」。
