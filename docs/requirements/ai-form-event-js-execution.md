# PRD：交互执行面第二刀 — 受约束事件 JS 生成 + 真实渲染 applied（v0.8.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-event-js-execution-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.8.0` |
| 修订 | 3（2026-09-24：对齐 DeliveryGuard 已发布事实，不再写 proposed） |
| 状态 | released（DeliveryGuard `release.published`；acceptance passed；OpenSpec `applied`） |
| 关联 OpenSpec | `ai-form-event-js-execution` |
| 前置版本 | `v0.7.0` released — shape 登记 + `/event` 澄清闭环 + EventSpec（含可判定示例契约） |
| 依赖 | v0.7 的 EventSpec / shape / `/event` 契约已落地后再实现本版合入路径 |

## 1. 背景与问题

v0.7 只保证「问得清、登记得对」：`POST /api/agent/v1/event` 产出 EventSpec，事件键在合入层仍为空。用户目标仍是自然语言落地可运行交互（计算、规则、联动），且 **applied 必须运行正确**。

本版接上 v0.7 契约：生成受约束 JS → 静态白名单护栏 → **真实 VForm 按 EventSpec.examples 执行断言** → 通过才合入并标记 applied。接口类事件仍禁止。纯前端事件（含 `onCreated` / `onMounted` / 子表行）均可作为落点。

## 2. 已锁定边界（继承 + 本版）

| 决策项 | 选择 | 来源 |
|---|---|---|
| 危险能力 | 网络 / `dataSources` / DOM / `eval` / `Function` 构造 / 动态 import / 定时器 **一律禁止** | 2026-09-21 |
| 运行正确 | 不得仅凭「字符串写进 JSON」报成功 | 2026-09-21 |
| 验收 harness | DeliveryGuard 证据 = **Playwright 真实渲染**，禁止 Node mock-this 冒充 acceptance | 2026-09-22 |
| API | 仍走 **`/api/agent/v1/event`**，不把事件 op 塞进 `/refine` | 2026-09-22 |
| `onSubFormRow*` / 生命周期 | **纳入纯前端可写面**（不再后置） | 2026-09-22 修订 |
| **线上 applied 闸（本版建议锁定）** | 设计器 **预览区真实 VForm** 跑 examples，回报 `executionReport`；Agent **不在请求内嵌 Playwright** | 见 §3；实现前可反对 |

## 3. 版本定位

> 消费完备 EventSpec，生成纯前端事件/`functions` JS；AST 护栏通过后进入预览执行；**仅 examples 全部断言通过才 applied 并写画布**。护栏失败或执行失败 → `draft` + warning，事件键不写或回滚。

两层「真实渲染」分工（避免把浏览器塞进每次 API）：

| 层 | 谁跑 | 用途 |
|---|---|---|
| 产品 applied 闸 | 设计器预览里的真实 VForm（与用户预览同一运行时） | 每次确认写入前 |
| DeliveryGuard 验收 | Playwright 驱动同一条「生成 → 预览触发 → 断言」 | 仓库证据；禁止 mock-this |

Playwright 证明**这条回路存在且对 P0 场景为真**；不是让生产 Agent 每个请求启动浏览器。

## 4. 与 v0.7 的衔接

```text
v0.7  status=spec_ready + EventSpec(examples[])
        ↓
v0.8  action=generate → 静态护栏 → status=code_preview（候选 JS + formJsonCandidate，未 applied）
        ↓
      设计器预览装载候选 JSON，按 examples 置输入、触发、读后置状态
        ↓
      executionReport.pass → action=apply → status=applied（写画布）
      executionReport.fail / 超时 / 未跑 → status=draft，不 applied
```

v0.7 的 `need_clarification` / `spec_ready` **保持**。本版只追加后续状态，不削弱澄清完备条件。

## 5. 功能需求

### FR-1 受约束生成（同一 `/event`）

- `action=generate`（或 spec_ready 后显式生成）：EventSpec → 候选 JS。
- 落点：**该控件在设计器事件面板上出现的纯前端 `on*`** + 表单级 `onForm*` + 纯前端 `functions`（§6 全表）。接口类键拒绝。
- 纯 number 且 formula 可表达 → **仍走 `/refine` + formula**，本端点拒绝「用事件重复造公式」。
- 生成可 mock（测试指令确定性 JS）；真 LLM 非必选验收。

### FR-2 静态白名单护栏（执行前置，合入闸之一）

- AST 可解析；API ∈ shape.`thisApiAllowlist` + 纯计算内建白名单；
- `getWidgetRef` / `setFieldValue` 等字段名必须在当前表单存在；
- 禁止：`fetch` / XHR / `eval` / `new Function` / `import(` / `document` / 越权 `window` / 定时器 / `dataSources` / 网络；
- 超长 / 明显无关 → reject。命中即不得进入 `code_preview` 合入候选。

### FR-3 真实渲染执行闸（applied 前置）

- 使用 EventSpec.`examples[]` 为 oracle：`given` → 触发 → `expect`（字段值 / hidden / disabled / 校验结论 / 既有 dialog 可见性）。
- 生命周期（`onCreated` / `onMounted` / `onFormCreated` / `onFormMounted`）：**预览装载并等待 mounted** 即为触发。
- **无 executionReport.pass 不得 applied**（用户跳过预览 = 未验证 = draft）。
- 不可判定（示例无法在预览观察）→ draft + warning，不 applied。

### FR-4 合入与覆盖策略

- 仅 `applied` 将 JS 写入 `options.on*` / `formConfig.functions`。
- 目标键已有非空手写：`overwrite-if-confirmed` 且用户显式确认才覆盖；否则 reject。**无智能合并**。
- `/refine` **继续禁止**当事件编辑器；事件只经 `/event`。

### FR-5 Catalog 写权限反转（Breaking）

- 纯前端 allowed-event：`catalogValidator` 允许非空（须过护栏+执行）；
- 接口类 `onRemoteQuery`、上传族、`dataSources`、含网络的 `functions`：**仍必须为空**；
- 改写 v0.6/v0.7 的 `refine-dialog-event-forbid`：**允许集可落地，危险类仍 reject**。

### FR-6 前端

- `spec_ready` 后提供「生成交互代码」；
- `code_preview` 展示代码摘要 +「在预览中验证」；
- 验证通过才启用「确认写入画布」；
- 失败展示 draft/warning，不 `loadFormJson` 事件键。

## 6. 可写事件面（纯前端全覆盖）

真源：`propertyRegister.js` 的 `EVENT_PROPERTIES` + `formConfig` 的 `onForm*` + `functions`。  
**规则：设计器事件面板上有的键，只要不是接口通道，v0.8 均可作为 NL 落点。**

### 6.1 可写（`writableIn=v0.8`）

| 分组 | 键 |
|---|---|
| 生命周期（高频，必须收） | 组件 `onCreated` / `onMounted`；表单 `onFormCreated` / `onFormMounted` |
| 字段常用 | `onClick` / `onInput` / `onChange` / `onFocus` / `onBlur` / `onValidate` / `onAppendButtonClick` |
| 子表 | `onSubFormRowAdd` / `Insert` / `Delete` / `Change` |
| 容器/弹层 | `onTabClick`；dialog/drawer 的 opened / beforeClose / ok / cancel；`onButtonGroupClick` |
| 表格（纯前端回调） | `onPageSizeChange` / `onCurrentPageChange` / `onSortChange` / `onSelectionChange` / 显隐禁用操作按钮 / 操作按钮文案与点击 / 行列单元格点击 / `onGetRowClassName` / `onGetSpanMethod` |
| 树 | `onNodeClick` / `onNodeCheck` / `onNodeContextmenu` / `onCheckChange` |
| 表单数据/校验 | `onFormDataChange` / `onFormValidate` |
| 复用 | `formConfig.functions`（仍禁止网络构造） |

生命周期执行闸：**装载预览并等待 mounted** 视为触发，而不是用户点击。`examples.given` 用初始值，`expect` 为挂载后的字段值/显隐/禁用。

返回值型回调（如 `onGetRowClassName`）：仅当 example 能观察到后置 DOM/状态时才可 applied；否则 draft。

### 6.2 禁写（接口 / 非事件属性）

| 键/能力 | 原因 |
|---|---|
| `onRemoteQuery` | 远程搜索 |
| `onBeforeUpload` / `onUploadSuccess` / `onUploadError` / `onFileRemove` | 上传通道 |
| `dataSources` 及含 `fetch`/XHR 的 `functions` | 数据源/网络 |
| 列 `render` | 不是 EVENT_PROPERTIES，另版 |
| `customRule` | 非事件属性 |

### 6.3 场景

| 编号 | 场景 | applied 标准 |
|---|---|---|
| S1 | 派生/条件计算写入目标字段 | 预览触发后目标值 == expect |
| S2 | A 变化 → set/enable/disable/show/hide B | B 状态 == expect |
| S3 | **打开表单/控件挂载时**执行初始化规则（`onCreated`/`onMounted`/`onFormMounted`） | 预览装载完成后状态 == expect |
| S4 | 按钮 / 弹窗确定取消 / tab | 可见性或值 == expect |
| S5 | 提交前跨字段校验 | 非法 given 被拦截 |
| S6 | 子表增删改行时带默认值或重算 | 行操作后状态 == expect |
| S7 | 接口类意图 | 拒绝，不 applied |
| S8 | 已有手写未确认覆盖 | reject |
| S9 | 执行失败或未跑预览 | draft |

## 7. 非目标

- 网络 / `dataSources` / DOM / `eval` / 动态代码 / 定时器；上传与远程查询事件；
- 列 `render`；智能合并手写事件；
- Agent 请求内启动 Playwright 作为线上闸（仅 acceptance 使用 Playwright）；
- Node mock-this 作为 DeliveryGuard 通过证据；
- 会话持久化、生产 LLM 监控（更后版本）。

## 8. 能力天花板

- **能保证：** 危险构造被拒；合入的代码过 AST 白名单；**对已跑过的 examples 在真实 VForm 上后置状态正确**。
- **不能保证：** 与未写入 examples 的隐含意图一致；examples 覆盖之外的输入组合。

## 9. 测试与验收

- agent/static：生成、护栏正负例、覆盖策略、未执行不得 applied；
- **Playwright（真实渲染，非 mock-this）：** 至少覆盖 **onChange 联动、onClick、生命周期 mounted、子表行、表单校验** 各 1 条真实触发；其余可写键以 agent 合入 + 护栏 + 至少一条 example report 为闸，不要求每个键都有独立 e2e；
- 负例：远程/上传/eval/DOM；未预览 apply 被拒；
- 回归：v0.7 澄清案；v0.6 重型容器；formula；strict-sweep；frontend-no-secret；
- 证据 `docs/evidence/v0.8.0/`；`.deliveryguard/acceptance/v0.8.0/`。

## 10. Breaking（相对 v0.7 / v0.6）

| 位置 | v0.7 | v0.8 |
|---|---|---|
| 纯前端事件空串校验 | 必须为空 | 允许非空（护栏+执行后） |
| `refine-dialog-event-forbid` | 一律空 | 纯前端 dialog 事件可落地；远程/上传仍拒 |
| `functions` | 必须为空 | 纯前端可写；含网络仍拒 |
| `/event` 状态机 | clarification / spec_ready | + code_preview / applied / draft |
| AiChat | 无写入事件 | 验证通过后可确认写入 |

## 11. 风险

见设计文档。核心：预览执行与 Playwright 验收是否同一 oracle；用户跳过预览；生成 JS 幻觉 API（护栏拦）；覆盖手写代码；把 `/refine` 又当成事件通道。
