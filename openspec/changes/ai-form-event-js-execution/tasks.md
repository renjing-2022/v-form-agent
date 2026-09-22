# Tasks: ai-form-event-js-execution

有序、可验证。未实现前 **全部不勾选**。实现前提：v0.7 `/event` 澄清 + EventSpec + shape 可运行。

## 硬门槛

1. 无 `executionReport` 全绿不得 `applied`；
2. Playwright 验收必须真实触发 VForm 事件；禁止 mock-this 当证据；
3. Agent 请求内不启动 Playwright；
4. `/refine` 仍禁写事件；
5. 接口类与危险构造仍拒；纯前端事件（含 created/mounted、子表行）可写。

---

## 交付物 0：前提

- [ ] v0.7 EventSpec schema / `/event` clarify 在本分支可测
- [ ] 锁定纯前端全量 allowlist（EVENT_PROPERTIES − 远程/上传）与 preview（非 designState；生命周期=装载 mounted）执行约束

## 交付物 1：generate + `eventJsGuard`

- [ ] `action=generate` → `code_preview` 或 422
- [ ] `eventJsGuard.ts` AST 白名单 + 符号存在 + 禁止构造
- [ ] mock 指令确定性 JS
- [ ] `event-generate-onchange-preview`
- [ ] `event-guard-forbid-network`
- [ ] `event-guard-forbid-eval-dom-timer`
- [ ] `event-guard-unknown-field-ref`
- [ ] `event-formula-still-preferred`

## 交付物 2：preview runner + apply

- [ ] 前端：候选 JSON 载入 **VFormRender 预览**；跑 examples；组装 `executionReport`
- [ ] `action=apply`：校验 results；pass 才写 allowed 键
- [ ] `event-apply-without-report-rejected`
- [ ] `event-apply-failed-report-draft`
- [ ] `event-existing-handwritten-overwrite-or-reject`
- [ ] AiChat：验证前禁用「写入画布」

## 交付物 3：Catalog / refine 分流

- [ ] allowed-event + 纯前端 `functions` 在 **event apply** 可非空
- [ ] refine / catalogValidator 对非 allow 键仍 empty
- [ ] 改写 `refine-dialog-event-forbid` → `event-dialog-allowed-vs-danger`
- [ ] `event-refine-still-forbids-events`
- [ ] shape `writableIn=v0.8` 覆盖全部纯前端事件；接口类 `never`；`catalog:check`
- [ ] static `event-allowlist-covers-pure-frontend`

## 交付物 4：Playwright 真实执行 + 回归

- [ ] `e2e/tests/ai-form-v080.spec.ts`，`EVIDENCE_VERSION=v0.8.0`
- [ ] `event-compute-onchange-apply`
- [ ] `event-linkage-set-enable-apply`
- [ ] `event-show-hide-condition-apply`
- [ ] `event-button-onclick-open-dialog`
- [ ] `event-created-mounted-apply`（预览装载后断言）
- [ ] `event-subform-row-apply`
- [ ] `event-form-validate-submit-guard`
- [ ] 证据写入 `docs/evidence/v0.8.0/`
- [ ] `event-v07-clarify-regression`
- [ ] `refine-v06-regression`
- [ ] `catalog-full-strict-sweep`
- [ ] `frontend-no-secret`
- [ ] `.deliveryguard/acceptance/v0.8.0/evidence.json`（验收时）
- [ ] `docs/acceptance/v0.8.0.md`（验收时）

---

## DoD

交付物 0–4 勾选；抽样 e2e **真实触发**（含生命周期与子表行）pass；无报告不能 applied；接口类仍拒；v0.7/v0.6 回归；DeliveryGuard v0.8 acceptance passed。

## Acceptance 表（规划）

| case-id | Requirement | 真实执行 | status |
|---|---|---|---|
| `event-generate-onchange-preview` | FR-1 | no | planned |
| `event-guard-forbid-network` | FR-2 | no | planned |
| `event-guard-forbid-eval-dom-timer` | FR-2 | no | planned |
| `event-guard-unknown-field-ref` | FR-2 | no | planned |
| `event-apply-without-report-rejected` | FR-3 | no | planned |
| `event-apply-failed-report-draft` | FR-3 | no | planned |
| `event-compute-onchange-apply` | FR-3 | yes | planned |
| `event-linkage-set-enable-apply` | FR-3 | yes | planned |
| `event-show-hide-condition-apply` | FR-3 | yes | planned |
| `event-button-onclick-open-dialog` | FR-3 | yes | planned |
| `event-created-mounted-apply` | FR-3 | yes | planned |
| `event-subform-row-apply` | FR-3 | yes | planned |
| `event-form-validate-submit-guard` | FR-3 | yes | planned |
| `event-allowlist-covers-pure-frontend` | FR-5 | no | planned |
| `event-existing-handwritten-overwrite-or-reject` | FR-4 | no | planned |
| `event-formula-still-preferred` | FR-1 | no | planned |
| `event-dialog-allowed-vs-danger` | FR-5 | no | planned |
| `event-refine-still-forbids-events` | regression | no | planned |
| `event-v07-clarify-regression` | regression | no | planned |
| `refine-v06-regression` | regression | no | planned |
| `catalog-full-strict-sweep` | regression | no | planned |
| `frontend-no-secret` | security | no | planned |
