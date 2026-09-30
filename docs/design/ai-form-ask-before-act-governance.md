# 技术设计：Ask-before-act 澄清与高风险动作治理（v0.10.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-ask-before-act-governance-design` |
| 类型 | technical-design |
| 目标版本 | `v0.10.0` |
| 修订 | 2（2026-09-29：§3–§5 契约走查冻结，见 §12） |
| 关联 PRD | `docs/requirements/ai-form-ask-before-act-governance.md` |
| 关联 OpenSpec | `ai-form-ask-before-act-governance` |
| 前置契约 | v0.9 `/interaction` generate/repair/apply；`interactionOutput`；`eventMerger` / `interactionMerger` 的 `confirmOverwrite`；`acorn` 网络静态检查；AiChat 预览确认 |

## 1. 不变量

1. Ask-before-act **不是**全局强制开关：语义明确且无 L2/L3 风险码时直接 `generated`，仍须预览确认后 `apply`。
2. 澄清阶段（`need_clarification`）**不得**写入画布；`formJson` 原样回传，`applied === false`。
3. 模型不得发明组件名、事件键或动作候选项：选项必须由服务端按 Catalog + 当前表单真源给出或重判。
4. `pendingPlan` 绑定 `formFingerprint`；画布漂移、答案过期或问题 ID 不匹配时作废计划，要求重新 `generate`。
5. 生成事件 JS 继续禁止网络；声明式远程/上传只通过设计器原生配置表达，且固定为 L2。
6. 既有非空事件：默认可尝试安全 AST 合并；无法证明可组合时不得静默覆盖；覆盖须显式确认并展示 diff。
7. L3 本版本一律拒绝（`status/intent = unsupported`），不进入候选预览，不创建可继续的 pendingPlan。
8. **事件合并模式只在 apply 前决议**（`eventResolutions`）；澄清轮不选择 prepend/append。

## 2. 端点与状态机

端点保持 `POST /api/agent/v1/interaction`，在 v0.9 三动作上增加 `clarify`。

| action | 输入要点 | 成功 status | 画布 |
|---|---|---|---|
| `generate` | instruction、currentFormJson、messages | `generated` / `need_clarification` / `route_refine` / `unsupported` | 不变 |
| `clarify` | pendingPlanId、answers、currentFormJson、formFingerprint | `generated` / `need_clarification` / `plan_expired` / `unsupported` / `cancelled` | 不变 |
| `repair` | （同 v0.9） | `generated` / `failed` / `tamper` | 不变 |
| `apply` | 产物、verificationReport、userConfirmed、eventResolutions?、confirmOverwrite? | `applied` / `draft` | 仅 `applied` 写入 |

`plan_expired` / `cancelled` 仅为 **HTTP 响应 status**，不进入 `InteractionOutput.intent` 枚举。

### 2.1 闭环

```text
歧义 或 非 event_overwrite 的 L2
  → generate → need_clarification + pendingPlanView + clarification
  → UI 回答 → clarify(answers)
  → generated（riskFacts + 可选 eventConflicts）→ 预览验证
  → 若有 eventConflicts → UI 选择 prepend|append|overwrite|cancel
  → apply（eventResolutions 或 confirmOverwrite）→ applied | draft

仅目标事件键已有代码、指令否则明确
  → generate 直接 generated + eventConflicts（Ask-before-act = 冲突面板，不再多一轮 clarify）
  → 预览 → resolutions → apply
```

无歧义且无 L2/L3：`generate` 直接 `generated`，无 clarification、无强制冲突面板。

### 2.2 `plan_expired`

以下任一成立即返回 `plan_expired`（HTTP 200，`applied: false`，画布不变）：

- 请求中的 `formFingerprint` ≠ 服务端对 `currentFormJson` 重算值；
- `pendingPlanId` 未知或已消费；
- 答案引用的 `questionId` 不在该 plan 的问题集中；
- plan 超过 TTL（默认会话内存 30 分钟；进程重启即失效——本版本无跨刷新持久化）。

UI 收到后提示「画布或计划已变化，请重新描述」，清空本地 pending 状态。

## 3. 契约（zod 目标形状）

实现落点：`agent/src/schemas/interactionOutput.ts`（及必要时拆分 `clarification.ts`）。下列为设计契约，实现时用 zod 编码并做静态 parity。

### 3.0 字段放置（相对 v0.9 响应）

与现网一致：业务字段以 **HTTP 响应顶层** 为主，`output` 内保留模型产物。

| 字段 | 位置 | 何时出现 |
|---|---|---|
| `output` | 顶层 | 始终（含 intent/handlers/scenarios/questions 派生） |
| `clarification` | 顶层 | `need_clarification` |
| `pendingPlan` | 顶层 | `need_clarification`（仅 `PendingPlanView`，无服务端私有 resume） |
| `riskLevel` / `riskFacts` | 顶层 | `generated` / `need_clarification` / `unsupported`（有判定时） |
| `eventConflicts` | 顶层 | `generated` 且存在非空旧事件键 |
| `formFingerprint` | 顶层 | 回显当前表单指纹（generate/clarify 均宜带） |
| `questions` | 顶层 + `output.questions` | 由 `clarification.questions[].prompt` 派生，兼容旧 UI |

### 3.1 风险等级

```text
RiskLevel = 'L0' | 'L1' | 'L2' | 'L3'

RiskFact {
  level: RiskLevel
  code: string            // 稳定机器码，见 §4；必须 ∈ RISK_CODES
  message: string
  relatedTargets?: string[]  // widget name / eventKey / op
}
```

`riskLevel` = `riskFacts` 中 level 的 max（L3>L2>L1>L0）；无 facts 时缺省按 L1（可写本地候选）或 L0（只读）。

### 3.2 结构化问题 / 答案

**替换** v0.9 语义上的自由文本追问。过渡期仍下发派生 `questions: string[]`；新 UI 只读 `clarification.questions`。验收以 structured 为准。

```text
ClarificationOption {
  id: string              // max 64；服务端生成/重写
  label: string
  description?: string
  recommended?: boolean
  riskLevel?: RiskLevel
  value: string | boolean | number | Record<string, unknown>
}

ClarificationQuestion {
  id: string              // q_<stable>，max 64
  type: 'single_choice' | 'multiple_choice' | 'text' | 'confirm'
  prompt: string
  options?: ClarificationOption[]   // single/multiple/confirm 必填
  allowCustom?: boolean
  defaultOptionIds?: string[]
  recommendedOptionIds?: string[]
  required: boolean
  riskNote?: string
  binds?: { slot: ClarificationSlot }
}

ClarificationSlot =
  | 'target.widget'
  | 'target.eventKey'
  | `risk.confirm:${RiskCode}`      // 如 risk.confirm:upload_config
  // 禁止 binds 到 merge 模式；merge 仅 apply 阶段

ClarificationAnswer {
  questionId: string
  optionIds?: string[]
  text?: string                     // max 2000
  confirmed?: boolean               // confirm 快捷：true=yes，false=no
}

ClarificationPayload {
  questions: ClarificationQuestion[]
  protocol: 'structured-clarify-v1'
}
```

答案合法性：

| type | 合法答案 |
|---|---|
| `single_choice` | 恰好 1 个 `optionIds`，或 `allowCustom` 且非空 `text` |
| `multiple_choice` | ≥1 个 `optionIds`（可另加 custom text 若允许） |
| `text` | 非空 `text`（若 required） |
| `confirm` | `confirmed===true` / optionId=`yes`，或 `confirmed===false` / `no` |

`confirm` 的 options 由服务端模板固定为 `yes` / `no`；模型只填 `prompt` / `riskNote`。  
`confirmed===false`（或选 `no`）→ 响应 `status: 'cancelled'`，删除 plan，画布不变（不必再生成）。

### 3.3 pendingPlan

```text
PendingPlanView {                 // 回传客户端
  id: string                      // plan_<uuid>；clarify 时原样带回作 pendingPlanId
  formFingerprint: string
  createdAt: string               // ISO
  expiresAt: string
  goal: string
  ambiguities: string[]
  assumed?: string[]
  plannedStructure: { summary: string, opKinds: string[] }
  plannedHandlers: { target: string, eventKey: string, action: 'create'|'merge'|'overwrite' }[]
  plannedDeletes?: string[]
  riskLevel: RiskLevel
  riskFacts: RiskFact[]
  nextStepsAfterAnswer: string[]
}

PendingPlanRecord {               // 仅服务端内存
  view: PendingPlanView
  resume: {
    instruction: string
    messages?: ChatTurn[]
    questionSnapshot: ClarificationQuestion[]
    slotValues: Record<string, unknown>   // 已填槽
    modelHints?: unknown                  // 可选；勿当安全边界
  }
}
```

- 查找键 = `view.id`；**不向客户端下发 resume / resumeToken**。
- `need_clarification` 必含顶层 `pendingPlan: PendingPlanView` + `clarification`。
- clarify 再次 `need_clarification` → **新** plan id，旧 record 删除。

### 3.4 formFingerprint

```text
formFingerprint = sha256(stableStringify(stripVolatileKeys(formJson)))
```

冻结规则：

- 对 **整份** `formJson` 做稳定序列化（对象键排序），再 sha256，输出 hex；
- `stripVolatileKeys` 仅删除明确列入 `VOLATILE_FORM_KEYS` 的键（rev2 初始为空集；若日后有纯客户端临时字段再追加）；
- **不做** formConfig 白名单 pick：设计器任意改动（含标签、CSS、事件）均使 plan 过期——刻意收紧；
- API：`computeFormFingerprint(formJson): string`，单测锁定样例。

### 3.5 clarify 请求

```text
InteractionClarifyRequest {
  action: 'clarify'
  pendingPlanId: string
  formFingerprint: string
  currentFormJson: FormJson
  answers: ClarificationAnswer[]
  messages?: ChatTurn[]
}
```

校验顺序：fingerprint 对齐 → plan 存在且未过期 → 答案集合覆盖所有 `required` → optionId ∈ 快照 → text 长度 → 若任一 confirm=no → `cancelled` → 否则填槽 → 风险重判 → 生成 / 再澄清 / `unsupported`。  
缺答或非法答案：HTTP **400**（参数错误），不消耗「生成成功」语义；与 `plan_expired`（200）区分。

### 3.6 事件冲突决议（apply 扩展）

v0.9 仅有布尔 `confirmOverwrite`。v0.10 增加按键决议；`confirmOverwrite: true` = 对所有冲突键视为 `overwrite` 的兼容快捷方式。新 UI 优先发 `eventResolutions`。

```text
EventMergeMode = 'prepend' | 'append' | 'overwrite' | 'cancel'

EventResolution {
  target: string            // widget name 或 'form'；解析同 resolveHandlerTargets
  eventKey: string
  mode: EventMergeMode
}

InteractionApplyRequest += {
  eventResolutions?: EventResolution[]
}
```

| mode | 行为 |
|---|---|
| `prepend` | 新代码在前（§5 包装） |
| `append` | 旧代码在前 |
| `overwrite` | 整键替换；diff 须已在 `eventConflicts` 展示 |
| `cancel` | 该键跳过；其余键与 structure 仍可写；若取消后无任何写入 → `draft` |

门禁：目标键已有非空代码时，须该键 `eventResolutions` 为 `overwrite|prepend|append`，**或** `confirmOverwrite===true`；否则 merge 拒绝（422/`draft`），画布不变。`cancel` 不算写入许可。

### 3.7 候选预览与冲突检测

现行 `buildInteractionCandidate(..., { confirmOverwrite: true })` 会静默覆盖，v0.10 改为：

1. 扫描将写入的每个 handler 键，非空旧代码 → 产生 `EventConflict`；
2. 预览用候选：无 resolutions 时用 **临时 overwrite** 生成 `formJsonCandidate` 仅供预览展示，同时必须下发完整 `eventConflicts`；
3. `apply` 不得依赖「预览曾用 overwrite」；必须带齐决议或 `confirmOverwrite`；
4. 用户选定 `prepend`/`append` 后，前端/服务端按该 mode **重建** candidate 并重跑预览验证（切换 mode 作废旧 `verificationReport`）。

## 4. L0–L3 分类与静态 parity

### 4.1 分类表（固定码）

| code | 默认 level | 触发条件（服务端重判，不信任模型自评） |
|---|---|---|
| `read_only` | L0 | 无 structure/handlers 写入意图 |
| `local_reversible` | L1 | 本地属性/结构候选、纯前端确定性 JS，且无下表 L2/L3 |
| `upload_config` | L2 | structure/option 含上传类控件配置或 upload URL/字段 |
| `remote_datasource` | L2 | 声明式 dataSource / `executeDataSource` **配置写入**（非 JS 联网） |
| `navigation` | L2 | 跳转、打开外链、改 location / router 类意图（含指令启发式 + 代码标识） |
| `browser_storage` | L2 | localStorage / sessionStorage / cookie 写入意图或代码标识 |
| `eval_like` | L2 | 生成 handler 中出现 `eval` / `Function` / `new Function`（交互管线沿用网络 policy，**不**套用 v0.8 eventJsGuard 全量白名单） |
| `event_overwrite` | L2 | 将写入的事件键上已有非空代码 |
| `bulk_delete_rebuild` | L2 | 批量删除或大范围重建结构 |
| `credential_write` | L3 | 写入密钥、token、密码到表单或存储 |
| `network_js` | L3 | 生成 JS 内任意网络（沿用 `interactionNetworkPolicy` / acorn） |
| `production_external_write` | L3 | 生产外部写、未授权 connector |
| `irreversible` | L3 | 明确不可逆且无预览回滚路径的动作 |

策略：

- 命中任一 L3 → `status`/`intent` = `unsupported`，填 `unsupported[]`，**不**建 pendingPlan。
- 最高为 L2 且 code ∈ { upload_config, remote_datasource, navigation, browser_storage, eval_like, bulk_delete_rebuild } → 必须先 `need_clarification`（`risk.confirm:*`），未确认不得 `generated`。
- **仅** `event_overwrite`（可叠加 `local_reversible`）且指令无其它歧义 → 允许直接 `generated` + `eventConflicts`；Ask-before-act 由冲突面板 + apply 门禁完成。
- 无 L2/L3 且指令无歧义 → 直接 `generated`。
- 有歧义（指代不清、多候选组件等）→ `need_clarification`，即使风险为 L1。

### 4.2 静态 parity

新增 `checkRiskPolicyParity`（或并入现有 catalog check）：

- 上表 code 集合与实现枚举 `RISK_CODES` 一致；
- 每个 L2/L3 code 至少一条 fixture 正例与一条负例；
- CI 在 `agent` 单测中执行。

## 5. 事件 AST 安全合并

模块：`agent/src/services/eventAstMerge.ts`，供 `interactionMerger`（主）与必要时 `eventMerger` 调用。

### 5.1 解析器（冻结）

复用已有依赖 **`acorn`**，解析选项与 `interactionNetworkPolicy` 对齐：

```text
ecmaVersion: 'latest'
sourceType: 'script'
allowReturnOutsideFunction: true
allowAwaitOutsideFunction: true
```

不引入第二套解析器。

### 5.2 可合并判定（保守）

仅当同时满足才把 `prepend` / `append` 列入 `suggestedModes`（`mergeSafe=true`）：

1. 新旧代码均被 acorn 解析为 Program.body 语句列表（失败 → 不可合并）；
2. 合并结果再跑 `checkInteractionNetworkStatic`（及 L3 风险扫描）通过；
3. 启发式：不存在相同左值的无条件赋值冲突、导致后段不可达的重复顶层 `return`；**不确定 → 不可合并**；
4. 能生成 diff 预览（old / mergedPrepend / mergedAppend / incoming）。

`mergeSafe=false` 时：`suggestedModes = ['overwrite', 'cancel']` 仅此二者。

### 5.3 包装形状

```javascript
// append: 旧在前
/* --- existing --- */
...old...
/* --- agent --- */
...neu...

// prepend: 新在前
/* --- agent --- */
...neu...
/* --- existing --- */
...old...
```

使用注释锚点；由 `eventAstMerge` 确定性拼接，禁止模型自行拼旧代码。

### 5.4 与预览

用户选择 `prepend` 或 `append` 后，必须按该 mode 重建 `formJsonCandidate` 与 verification；切换 mode 视为新候选，不得复用另一 mode 的 `verificationReport`。
## 6. 服务端处理要点

| 步骤 | 职责 |
|---|---|
| 意图/风险预判 | `generate` 在调用模型前后用规则扫描指令与表单；L3 早拒 |
| 模型输出 | 可建议 questions，但 options.id/value 由服务端重写 |
| 校验 | zod + 引用存在性 + 风险重判 + 网络 guard（v0.9 acorn） |
| pending 存储 | 进程内 Map（planId → PendingPlanRecord）；TTL 30min；无跨刷新 |
| clarify | 填槽后再次走生成；缺槽 → 新 plan + need_clarification；confirm=no → cancelled |
| candidate | 冲突感知预览（§3.7）；顶层 eventConflicts |
| apply | resolutions / confirmOverwrite 门禁 → merge → verification 重判 |

兼容：旧客户端只展示 `questions: string[]` 并用自由文本续聊时，服务端仍可把用户文本当新的 `generate`（无 plan）；**结构化闭环与 L2 门禁的 acceptance 不依赖该路径**。

## 7. AiChat UI

落点：`v-form/src/components/AiChat/index.vue` + `v-form/src/api/chat/index.ts`。

### 7.1 澄清面板

- 按 `clarification.questions` 渲染：单选、多选、文本、确认；
- 展示 `recommended` / `riskNote` / 选项级 `riskLevel` 徽标；
- 展示 `pendingPlan`：goal、ambiguities、plannedHandlers/structure 摘要、riskFacts、nextStepsAfterAnswer；
- 主按钮：「继续生成」→ `clarify`；「返回修改」→ 清空答案可重填；「取消」→ 丢弃 plan，画布不变；
- 会话内（页面未刷新）保持 pending；刷新后 plan 失效属预期（PRD 非目标）。

### 7.2 事件冲突面板

在预览确认前，若 candidate 报告 `eventConflicts[]`：

```text
EventConflict {
  target, eventKey
  existingCode, incomingCode
  mergeSafe: boolean
  suggestedModes: EventMergeMode[]
  diffPreview?: { old: string, mergedPrepend?: string, mergedAppend?: string, incoming: string }
}
```

用户为每项选择 mode；含 `cancel` 的项不写入；全部 cancel 且无其它变更则不调用 apply 或 apply 得 `draft`。

### 7.3 文案

风险徽标与确认文案须区分 L1「预览后写入」与 L2「高风险，请确认」；L3 只展示拒绝原因，无继续生成。

## 8. Affected contracts

| 契约 | 路径 | 变更 |
|---|---|---|
| Output schema | `agent/src/schemas/interactionOutput.ts` | structured clarification、pendingPlan、risk*；deprecate 纯 string questions 为派生 |
| Request schema | 同上 | 新增 `clarify`；`apply` 增 `eventResolutions` |
| Route | `agent/src/routes/interaction.ts` | 分发 clarify；响应带 pendingPlan / riskFacts / eventConflicts |
| Risk policy | 新建如 `interactionRiskPolicy.ts` | L0–L3 重判 + parity |
| Fingerprint | 新建如 `formFingerprint.ts` | 计算与单测 |
| Pending store | 新建如 `pendingPlanStore.ts` | 内存 TTL |
| Event merge | `eventAstMerge.ts` + merger | prepend/append/overwrite/cancel |
| Generator | `interactionGenerator.ts` | 歧义/L2 出路澄清；选项服务端化 |
| Frontend API | `v-form/src/api/chat/index.ts` | 类型与 `clarifyInteraction` |
| AiChat | `AiChat/index.vue` | 澄清表单 + 冲突决议 + pending 状态 |
| Agent tests | `agent` 单测 | L1 不追问、L2/L3、合并门禁、fingerprint |
| E2E | `e2e/tests/ai-form-v0100.spec.ts`（新建） | 澄清闭环、漂移失效、取消不变 |
| 回归 | v0.9 interaction / refine / generate / frontend-no-secret | 不退化 |

## 9. 验证矩阵（设计层）

| ID | 场景 | 期望 |
|---|---|---|
| A1 | 明确本地改属性/无冲突 | `generated`，无 clarification |
| A2 | 「给那个字段加联动」歧义 | `need_clarification` + 组件 choice |
| A3a | 上传/远程/跳转/storage/eval_like | L2 `risk.confirm:*` 后才 `generated` |
| A3b | 仅事件键非空、指令明确 | `generated` + `eventConflicts`，无澄清轮；无决议不可 apply |
| A4 | JS 内 fetch | `unsupported`，不写入 |
| A5 | clarify 后 fingerprint 变 | `plan_expired`，画布不变 |
| A6 | 可合并事件选 append | 按 append 重验后可 apply |
| A7 | 不可合并仅 overwrite；取消 | 画布不变 |
| A8 | 未答 required | clarify **400** |
| A9 | confirm=no | `cancelled`，plan 删除 |
| R1 | v0.9 明确交互 / refine / generate | 回归通过 |

## 10. Risks

| 风险 | 缓解 |
|---|---|
| 过度提问 | 双阈值：仅歧义或 ≥L2；A1 单测锁定 |
| 模型伪造选项 | 服务端按 Catalog/表单重写 options |
| 旧答案套新画布 | fingerprint + plan_expired |
| 合并改变语义 | mergeSafe 保守；按 mode 重验 |
| 内存 plan 丢 | PRD 允许；UI 明示重新描述 |
| 兼容旧 string questions | 派生数组；验收走 structured |

## 11. 实现顺序

1. Schema + fingerprint + risk policy + parity fixtures；
2. pending store + `clarify` 路由与 generator 分支；
3. eventAstMerge + merger/apply resolutions；
4. AiChat 澄清与冲突 UI；
5. agent 单测 → Playwright E2E → DeliveryGuard acceptance。

## 12. 契约走查冻结（rev 2）

对照代码：`interactionOutput.ts`、`routes/interaction.ts`、`interactionMerger.ts`（`confirmOverwrite`）、`interactionApply.ts`（candidate 默认 overwrite）、`interactionNetworkPolicy.ts`（acorn）、`eventJsGuard.ts`（/event 白名单，**交互管线不照搬**）。

| # | 原二义 | 冻结结论 |
|---|---|---|
| W1 | `resumeToken` 是否回传 | 不回传；仅 `PendingPlanView`；resume 留在服务端 Record |
| W2 | risk/clarification/pending 放 output 还是顶层 | 顶层为主；`output.questions` 仅派生兼容 |
| W3 | L3 用 unsupported 还是不可继续的 clarification | 一律 `unsupported`，无 pendingPlan |
| W4 | 事件合并在 clarify 还是 apply | **仅 apply 前**；clarify 禁止 `event.mergeMode` slot |
| W5 | `event_overwrite` 是否强制澄清轮 | 否；可直接 generated + eventConflicts |
| W6 | fingerprint 用 pick 还是整表 | 整表 `stableStringify` + 空 volatile 集 |
| W7 | AST 解析器 | 复用 `acorn`，与网络 policy 同选项 |
| W8 | eval_like vs eventJsGuard | 交互管线：L2 确认；不启用 v0.8 全量白名单 |
| W9 | candidate 静默 overwrite | 预览可临时 overwrite，但必须带 eventConflicts；apply 另计 |
| W10 | 非法答案 vs 过期 | 非法/缺答 → 400；过期 → 200 `plan_expired` |
| W11 | confirm=no | `cancelled` + 删 plan |
| W12 | 多轮澄清 | 新 plan id，旧 plan 删除 |
| W13 | `answersAllowed: true` | 删除；改 `protocol: 'structured-clarify-v1'` |
| W14 | EventResolution.target | 与 `resolveHandlerTargets` 一致（含 form / name 派生） |

走查结论：**§3–§5 无未决二义，可进入 tasks §1 实现。**

OpenSpec 勾选 ≠ 已实现 ≠ 已验收 ≠ 已发布。
