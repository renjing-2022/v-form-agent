# 技术设计：自然语言直出交互 JS（v0.9.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-nl-interaction-compiler-design` |
| 类型 | technical-design |
| 目标版本 | `v0.9.0` |
| 修订 | 3（2026-09-23：T0 API 审计结论写入 §4；parity 与 fixture 落地） |
| 关联 PRD | `docs/requirements/ai-form-nl-interaction-compiler.md` |
| 关联 OpenSpec | `ai-form-nl-interaction-compiler` |
| 前置契约 | v0.8 `eventMerger` / 预览执行 / 服务端重判（`valuesMatch`）；v0.5+ refine 结构操作 |

## 1. 不变量

1. 事件 JS 由模型直接生成；除网络请求外不设代码禁区。
2. 没有服务端重判通过的 `verificationReport`，不得 `applied`。
3. 修正轮只能改代码与结构，不能改动已生成场景的断言（服务端对场景做指纹比对）。
4. 结构补丁与事件补丁同一事务：全部写入或全部不写。
5. 用户确认页展示的场景描述由场景数据确定性渲染。
6. 无 Key / 无 fixture 时明确报错，不回退正则模板。

## 2. 端点与状态机

新端点 `POST /api/agent/v1/interaction`（`/event` 保留兼容，规则不变）：

| action | 输入 | 成功 status | 失败 |
|---|---|---|---|
| `generate` | instruction、currentFormJson、messages | `generated`（structure、handlers、scenarios、summary、formJsonCandidate）/ `need_clarification` / `route_refine` / `unsupported` | 模型不可用 → 503；输出无效两次 → `need_clarification` |
| `repair` | 上一轮产物、verificationReport（失败项、报错）、round | `generated`（新代码，场景指纹不变） | round > 2 → `failed`；场景被改 → 拒绝该轮 |
| `apply` | 产物、verificationReport、用户确认标记 | `applied`（formJson） | 重判失败 / 未确认 → `draft` |

`route_refine`：前端直接调用现有 `/refine`。

## 3. 模型输出契约（`schemas/interactionOutput.ts`，zod）

```text
InteractionOutput {
  intent: 'interaction' | 'mixed' | 'structure_only' | 'unsupported' | 'need_clarification'
  summary: string                      // 模型对本次实现的说明
  structure: StructureOp[]             // refine 操作子集 + addButton
  handlers: {
    target: string                     // 控件 name，或 'form'
    eventKey: string                   // onChange / onClick / onFormMounted / onFormValidate / onSubFormRowAdd ...
    code: string                       // 事件函数体
    explain: string
  }[]
  scenarios: Scenario[]
  unsupported: { text, reason }[]
  questions?: string[]                 // need_clarification 时
}

Scenario {
  id, handlerRefs: string[], title
  arrange: { values?: {field: value}, activeTab?: string|number }
  act: ( {input: field, value} | {click: button} | {switchTab: tab} | {mount: true}
       | {addSubFormRow: subForm, values?} | {submit: true} | {wait: ms} )[]
  assert: ( {field, value} | {field, hidden|disabled|required: bool} | {field, label}
          | {activeTab} | {focused: field} | {valid: bool} | {dialogVisible: name, value: bool}
          | {subFormRows: name, count} | {noNetwork: true} | {noError: true} )[]
}
```

服务端校验：

- zod 结构合法；
- `target` / 场景引用的控件存在于表单或 `structure` 新建项；`eventKey` 属于目标控件类型的合法事件；
- 每个 handler 至少被 1 个场景引用；每个场景隐含 `noNetwork` 与 `noError`；
- 网络检查（§5）。

任一不通过 → 带错误回传模型重写一次；仍失败 → `need_clarification`。

## 4. VForm API 参考手册（`interactionApiReference.ts`）

喂给模型的**参考**，不是白名单。手册条目经 T0 审计登记，并由 `checkInteractionApiReferenceParity` 对照源码做存在性检查。

### 4.1 已确认能力

| 对象 | 能力 | 真源 |
|---|---|---|
| 表单 | `getWidgetRef`、`getFieldValue`、`setFieldValue`、`validateForm`、`validateField`、`hideWidgets`/`showWidgets`、`disableWidgets`/`enableWidgets`、`setWidgetsRequired`、`resetForm`、`clearValidate`、`getFormData`/`setFormData`、`showDialog`、`showDrawer`、`getDialogOrDrawerRef`、`getSubFormValues`/`setSubFormValues`、`getFieldWidgets`、`getFormRef` | `form-render/index.vue` |
| 字段 | `setValue`/`getValue`、`setHidden`、`setDisabled`、`setRequired`、`setLabel`、`focus`、`resetField`、`clearValidate`、`getFormRef` | `fieldMixin.js` |
| Tab | `activeTab(index)`（mixin）、`activeTabName`、`getActiveTabIndex()`；页内字段读 `widget.tabs[i].widgetList` | `tab-item.vue`、`containerItemMixin.js` |
| 子表 | `getWidgetRefOfSubForm(name, rowIndex)`、`getSubFormValues`/`setSubFormValues`；事件 `onSubFormRowAdd/Insert/Delete/Change` | `sub-form-item.vue`、`containerItemMixin.js` |
| 提示 | `this.$message.success/error/warning/info`（Element Plus，挂在渲染态） | `form-render/index.vue` 等多处 |

### 4.2 T0 审计结论（2026-09-23）

| 问题 | 结论 |
|---|---|
| 关闭弹窗 | **无** `form.closeDialog(name)`。`showDialog` 返回 DynamicDialog 实例，可调用 `.close()`；打开期间父表单可用 `getDialogOrDrawerRef().close()`；弹窗内事件里 `this.close()` |
| 提示消息 | **可用**：渲染态与字段组件均有 `this.$message` |
| 数据源请求方法名 | **`executeDataSource(dsName, localDsv)`**；内部另有 `runDataSourceRequest` / `initDataSetRequest`。本管线一律视为网络，静态禁止 |
| 子表行内字段 | 子表字段 `onChange` 形参为 `value, oldValue, subFormData, rowId`；也可用 `getWidgetRefOfSubForm` |
| 事件 `this` / 参数 | 见 `EVENT_CONTEXTS`：form 事件 `this`=表单；字段/按钮 `this`=控件，经 `getFormRef()` 调表单；`onFormValidate` 为 AsyncFunction，参数 `formModel`，返回 `false` 失败 |

### 4.3 事件上下文摘要

手册由 `renderInteractionApiReferenceMarkdown()` 生成，必须包含各 `eventKey` 的 params 与 this 绑定（完整列表在源码常量 `EVENT_CONTEXTS`）。

## 5. 网络请求检查（`interactionNetworkPolicy.ts`）

- **静态：** 解析 AST（语法错误直接回传修正）；命中以下即违规：`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon`、`import()`、`axios`/`$http`/`request` 类标识符、VForm 数据源请求方法（T0 确认名称）、`upload` 类控件新建。
- **运行时：** 验证期间临时替换 `window.fetch`、`XMLHttpRequest.prototype.open`、`WebSocket`、`EventSource`、`navigator.sendBeacon`，记录调用并阻止发出；任一记录 → 该场景 `noNetwork` 失败。验证结束恢复。
- 不再使用 v0.8 `eventJsGuard` 的 API 白名单；`/event` 仍使用它。

## 6. 真实预览执行（前端 `interactionRunner.ts`）

- 复用 v0.8 挂载方式（共用设计器 appContext 的隐藏 VFormRender），每个场景重新挂载，互不污染。
- `arrange` 静默设值；`act` 真实触发（输入走组件事件、点击走按钮 onClick、提交走 `validateForm` + `onFormValidate`）；每步后等待 settle（微任务 + `nextTick`，`wait` 指定额外时长，单场景上限 5s）。
- 捕获：handler 抛错、未处理的 Promise 拒绝、`console.error`，写入报告的 `errors`。
- 观测：焦点字段由 `document.activeElement` 反查所属字段；当前 tab 读 `getActiveTabIndex()`；弹窗读对应 ref；读不到判失败。
- **副作用隔离：** 验证期替换 `window.open`、`history.pushState/replaceState`、`localStorage`/`sessionStorage` 为记录桩；定时器在场景结束时清除。对 `location` 的直接赋值无法拦截：静态检测到时，该场景报告 `unverifiable`（不执行，按失败处理），用户可见原因。
- 报告只含观测值；服务端对每条断言用 `valuesMatch` 重判。

## 7. 自动修正（`interactionRepair.ts`）

- 输入：上一轮 handlers/structure、失败场景（断言期望 vs 实际）、报错栈摘要、API 手册。
- 输出：新的 handlers/structure；scenarios 必须原样（按 id + 断言内容计算指纹，不一致拒绝本轮）。
- 最多 2 轮；轮次、每轮失败项进入报告，用户可见。

## 8. 模型接入与可重复性

- `interactionGenerator.ts`：system prompt = 输出契约 + API 参考手册 + 事件上下文 + formSummary + 少量示例；`response_format: json_object`（沿用 `deepseek.ts`）。
- **回放：** `agent/fixtures/interaction/<scenarioId>.json` 存题库每条的 generate 输出及各修正轮输出。`AGENT_ALLOW_MOCK=1` 时按指令匹配回放；无 fixture 报错。
- **录制：** `npm run interaction:record` 用真实 Key 跑题库写 fixture（人工审阅后提交）。
- **冒烟：** `npm run interaction:smoke` 用真实 Key 跑题库子集，产出通过率；证据只含指令、结果摘要，不含 Key。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 代码与场景同源，一起理解错 | 用户确认场景描述；验收另用题库独立断言复验 |
| 修正时改场景迁就代码 | 场景指纹比对，改动即拒绝 |
| 调用不存在的 API | API 手册 + parity；真实执行报错 → 修正 |
| 动态网络调用漏检 | 运行时拦截；未覆盖分支的风险在 PRD §8 披露 |
| 验证期副作用（跳转、存储、定时器） | 记录桩 + 场景结束清理；`location` 赋值判不可验证 |
| 输出无效 JSON / 引用不存在 | zod + 引用校验 + 重写一次 |
| 异步时序 | settle 等待 + `wait` + 单场景超时 |
| 焦点等状态不可观察 | 读 DOM；读不到判失败 |
| 纯结构需求误送 | `structure_only` → `route_refine`；回归 v0.5/v0.6 refine |
| 回退模板冒充成功 | 无 Key / 无 fixture 直接报错；负例覆盖 |

## 10. 受影响契约

| 契约 | 路径 | 变更 |
|---|---|---|
| 统一入口 | `agent/src/routes/interaction.ts` | 新建 |
| 输出契约 | `agent/src/schemas/interactionOutput.ts` | 新建 |
| API 参考手册 | `agent/src/knowledge/interactionApiReference.ts` | 新建 + parity 检查 |
| 生成 | `agent/src/services/interactionGenerator.ts` | 新建（DeepSeek + 回放） |
| 修正 | `agent/src/services/interactionRepair.ts` | 新建 |
| 网络检查 | `agent/src/services/interactionNetworkPolicy.ts` | 新建 |
| 场景渲染 | `agent/src/services/scenarioNarrator.ts` | 新建 |
| 合入 | `eventMerger.ts` + refine merger | 事务化组合 |
| 新建白名单 | `createWhitelistPolicy.ts` | 交互管线允许 `button` |
| 前端 | `AiChat`、`interactionRunner.ts`、`api/chat` | 统一入口、验证、修正循环、确认、写入 |
| 验收 | `agent/scripts/acceptance-cases.ts`、`e2e/tests/ai-form-v090.spec.ts` | 新增 |
