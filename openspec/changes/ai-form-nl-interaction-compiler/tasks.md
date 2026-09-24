# Tasks: ai-form-nl-interaction-compiler

有序、可验证。实现前提：v0.8 已发布；在专用 worktree / 分支上实现。

## 约定

1. 模型直接写 JS；本管线只禁网络请求；无 fixture / 无 Key 直接报错，禁止模板回退；
2. Playwright 验收必须真实触发，报告由观测组装，服务端重判；正例另用题库独立断言复验；
3. 任务只在实现与对应检查通过后勾选。

## 交付物 0：API 审计与参考手册

- [x] 用户审阅并确认 `scenarios.md` 题库（可增删改）
- [x] 审计 VForm 渲染态：各事件键执行上下文与可用变量、弹窗关闭、提示消息、子表行内字段访问、数据源请求方法名；结论写入设计 §4
- [x] `interactionApiReference.ts` + `interaction-api-reference-parity` 静态检查
- [x] fixture 表单 `F-wizard` / `F-order` / `F-detail`（完整 widget 配置）

## 交付物 1：生成

- [x] `schemas/interactionOutput.ts`：输出契约与 Scenario（zod）
- [x] 引用校验、事件键合法性、handler 场景覆盖校验
- [x] `interactionGenerator.ts`：prompt（契约 + API 手册 + 事件上下文 + formSummary）、DeepSeek 调用、重写一次
- [x] 意图分类：interaction / mixed / `route_refine` / unsupported / need_clarification
- [x] 回放：`agent/fixtures/interaction/*.json`（含修正轮）；mock 模式无 fixture 报错
- [x] `npm run interaction:record`（真实 Key 录制脚本；人工审阅后提交）
- [x] agent 用例：`interaction-output-schema-reject-invalid`、`interaction-unknown-ref-rewrite`、`interaction-handler-scenario-coverage`、`interaction-no-fixture-no-fallback`、`interaction-route-refine-structure-only`

## 交付物 2：网络检查

- [x] `interactionNetworkPolicy.ts` 静态检查（含语法错误回传）
- [x] 前端验证期网络 API 拦截与恢复（`v-form/src/utils/interactionRunner.ts`）
- [x] 用例：`interaction-network-static-reject`（运行时拦截随 runner 落地，e2e 待交付物 6）

## 交付物 3：结构与事务合入

- [x] `addButton`（Catalog 默认配置、确定性 id、按 tab 页插入）；交互管线允许新建 `button`
- [x] 结构 + 事件事务合入；任一失败全部不写
- [x] agent 用例：`interaction-transaction-all-or-nothing`

## 交付物 4：真实验证与自动修正

- [x] 前端 `interactionRunner.ts`：arrange / act / assert；settle 与超时；错误捕获；焦点、当前 tab、弹窗、子表行数可观察
- [x] 副作用隔离：`window.open`、history、storage 记录桩；定时器清理；`location` 赋值判不可验证
- [x] `interactionRepair.ts`：失败回传、场景指纹校验、最多 2 轮
- [x] `/interaction` apply：服务端逐断言重判 + 确认标记
- [x] 用例：`interaction-repair-scenario-tamper-reject`、`interaction-repair-limit-draft`、`interaction-apply-forged-report-draft`（`interaction-runtime-error-repair` 需真实 LLM，待冒烟）

## 交付物 5：统一入口 UI

- [x] 服务端 `/api/agent/v1/interaction` 路由（generate / repair / apply）
- [x] AiChat 去关键词分流，调用 `/interaction` generate
- [x] 验证 → 修正循环进度展示；代码、场景描述（`scenarioNarrator`）、真实结果展示；确认 / 重新描述
- [x] `route_refine` 直接走 `/refine`
- [x] e2e：`interaction-ui-confirm-flow`（另含 route_refine UI）

## 交付物 6：验收

- [x] `npm run interaction:record` 脚本（需真实 Key；人工审阅后提交）
- [x] `e2e/tests/ai-form-v090.spec.ts`：题库正例 `nl-*`（含独立断言复验）、负例 `nl-neg-*` 全部真实执行
- [x] `npm run interaction:smoke`：真实 DeepSeek 冒烟子集，记录通过率（证据不含 Key）
- [x] 回归：v0.8 26 用例、v0.7、v0.6、formula、strict sweep、frontend-no-secret
- [x] `.deliveryguard/acceptance/v0.9.0/evidence.json` + `docs/acceptance/v0.9.0.md`

## DoD

交付物 0–6 勾选；题库正例全部真实通过、负例全部不可 apply；冒烟有真实结果；回归通过；DeliveryGuard v0.9 acceptance passed。
