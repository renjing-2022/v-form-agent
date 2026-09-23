# Tasks: ai-form-event-js-execution

有序、可验证。实现前提：v0.7 `/event` 澄清 + EventSpec + shape 可运行。

## 硬门槛

1. 无 `executionReport` 全绿不得 `applied`；
2. Playwright 验收必须真实触发 VForm 事件；禁止 mock-this 当证据；
3. Agent 请求内不启动 Playwright；
4. `/refine` 仍禁写事件；
5. 接口类与危险构造仍拒；纯前端事件（含 created/mounted、子表行）可写。

---

## 交付物 0：前提

- [x] v0.7 EventSpec schema / `/event` clarify 在本分支可测
- [x] 锁定纯前端全量 allowlist（EVENT_PROPERTIES − 远程/上传）与 preview（非 designState；生命周期=装载 mounted）执行约束

## 交付物 1：generate + `eventJsGuard`

- [x] `action=generate` → `code_preview` 或 422
- [x] `eventJsGuard.ts` AST 白名单 + 符号存在 + 禁止构造
- [x] mock 指令确定性 JS
- [x] `event-generate-onchange-preview`
- [x] `event-guard-forbid-network`
- [x] `event-guard-forbid-eval-dom-timer`
- [x] `event-guard-unknown-field-ref`
- [x] `event-formula-still-preferred`

## 交付物 2：preview runner + apply

- [x] 前端：候选 JSON 载入 **VFormRender 预览**；跑 examples；组装 `executionReport`
- [x] `action=apply`：校验 results；pass 才写 allowed 键
- [x] `event-apply-without-report-rejected`
- [x] `event-apply-failed-report-draft`
- [x] `event-existing-handwritten-overwrite-or-reject`
- [x] AiChat：验证前禁用「写入画布」

## 交付物 3：Catalog / refine 分流

- [x] allowed-event + 纯前端 `functions` 在 **event apply** 可非空
- [x] refine / catalogValidator 对非 allow 键仍 empty
- [x] 改写 `refine-dialog-event-forbid` → `event-dialog-allowed-vs-danger`
- [x] `event-refine-still-forbids-events`
- [x] shape `writableIn=v0.8` 覆盖全部纯前端事件；接口类 `never`；`catalog:check`
- [x] static `event-allowlist-covers-pure-frontend`

## 交付物 4：Playwright 真实执行 + 回归

- [x] `e2e/tests/ai-form-v080.spec.ts`，`EVIDENCE_VERSION=v0.8.0`
- [x] `event-compute-onchange-apply`（e2e 绿，真实预览 onChange）
- [x] `event-linkage-set-enable-apply`（e2e 绿）
- [x] `event-show-hide-condition-apply`（e2e 绿）
- [x] `event-button-onclick-open-dialog`（e2e 绿）
- [x] `event-created-mounted-apply`（e2e 绿）
- [x] `event-subform-row-apply`（e2e 绿）
- [x] `event-form-validate-submit-guard`（e2e 绿）
- [x] 证据写入 `docs/evidence/v0.8.0/`（e2e reporter）
- [x] `event-v07-clarify-regression`
- [x] `refine-v06-regression`
- [x] `catalog-full-strict-sweep`
- [x] `frontend-no-secret`
- [x] `.deliveryguard/acceptance/v0.8.0/evidence.json`（已生成并校验；source commit 登记前结论保持 pending）
- [x] `docs/acceptance/v0.8.0.md`（已生成；记录 source revision 阻塞）

## 交付物 5：验证真实性修复

首轮 e2e 中 7 条用例手写 `executionReport.pass=true`，前端 runner 对 hidden/disabled/valid/哨兵键直接回填期望值，服务端只看 `ok` 标记；onClick/onFormMounted 生成代码引用未定义的 `value`。以下修复后重跑全部用例。

- [x] codegen 按 eventKey 分派：值事件走求和/显隐，onClick/生命周期/子表行写 expect 字面量，onFormValidate 编译「X 不能小于 N」类规则，规则含糊返回 422（`event-codegen-dispatch-by-event-key`）
- [x] 前端 `eventPreviewRunner` 真实触发（触发字段最后写、按钮 `handleButtonWidgetClick`、子表 `addSubFormRow`、`validateForm`），只报告读到的状态，读不到判失败
- [x] AiChat 隐藏预览复用设计器 appContext（此前独立 `createApp` 无全局组件，控件不渲染）
- [x] 服务端按 `actual` 对照 `expect` 重判，伪造 `ok=true` 降为 draft（`event-apply-forged-ok-rejected`）
- [x] e2e 改为真实输入/点击/装载/增行/校验后读取状态，报告由观测与 examples 比对生成
- [x] `event-ui-apply-gate` 扩为 AiChat 全链路；新增负例 `event-ui-verify-rejects-mismatch`

---

## DoD

交付物 0–4 勾选；抽样 e2e **真实触发**（含生命周期与子表行）pass；无报告不能 applied；接口类仍拒；v0.7/v0.6 回归；DeliveryGuard v0.8 acceptance passed。

## Acceptance 表（规划）

| case-id | Requirement | 真实执行 | status |
|---|---|---|---|
| `event-generate-onchange-preview` | FR-1 | no | agent-passed |
| `event-guard-forbid-network` | FR-2 | no | agent-passed |
| `event-guard-forbid-eval-dom-timer` | FR-2 | no | agent-passed |
| `event-guard-unknown-field-ref` | FR-2 | no | agent-passed |
| `event-apply-without-report-rejected` | FR-3 | no | agent-passed |
| `event-apply-failed-report-draft` | FR-3 | no | agent-passed |
| `event-apply-forged-ok-rejected` | FR-3 | no | agent-passed |
| `event-codegen-dispatch-by-event-key` | FR-1 | no | agent-passed |
| `event-ui-verify-rejects-mismatch` | FR-6 | yes | e2e-passed |
| `event-compute-onchange-apply` | FR-3 | yes | e2e-passed |
| `event-linkage-set-enable-apply` | FR-3 | yes | e2e-passed |
| `event-show-hide-condition-apply` | FR-3 | yes | e2e-passed |
| `event-button-onclick-open-dialog` | FR-3 | yes | e2e-passed |
| `event-created-mounted-apply` | FR-3 | yes | e2e-passed |
| `event-subform-row-apply` | FR-3 | yes | e2e-passed |
| `event-form-validate-submit-guard` | FR-3 | yes | e2e-passed |
| `event-allowlist-covers-pure-frontend` | FR-5 | no | agent-passed |
| `event-existing-handwritten-overwrite-or-reject` | FR-4 | no | agent-passed |
| `event-formula-still-preferred` | FR-1 | no | agent-passed |
| `event-dialog-allowed-vs-danger` | FR-5 | no | agent-passed |
| `event-refine-still-forbids-events` | regression | no | agent-passed |
| `event-v07-clarify-regression` | regression | no | agent-passed |
| `refine-v06-regression` | regression | no | agent-passed |
| `catalog-full-strict-sweep` | regression | no | agent-passed |
| `frontend-no-secret` | security | no | agent-passed |
