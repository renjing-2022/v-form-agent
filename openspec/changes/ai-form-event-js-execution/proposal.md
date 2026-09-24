# Proposal: ai-form-event-js-execution

| 项 | 值 |
|---|---|
| Change ID | `ai-form-event-js-execution` |
| Target version | `v0.8.0` |
| Primary document | `docs/requirements/ai-form-event-js-execution.md` |
| Supporting design | `docs/design/ai-form-event-js-execution.md` |
| Affected repository | `app`（`.`） |
| Predecessor | `v0.7.0` released — `ai-form-event-interaction-js`（shape + 澄清；不合入 JS） |

## Problem

v0.7 将交互停在 EventSpec：用户仍不能把计算/规则/联动写成可运行事件。若无执行闸就允许合入，会违反「applied 必须运行正确」，也与 v0.6 起的 G3 冲突。

## 用户确认边界

| 决策项 | 选择 |
|---|---|
| 危险能力 | 仍一律禁止 |
| `/refine` | 仍不写事件；事件只经 `/event` |
| `onSubFormRow*` / 生命周期 | **可写**（纯前端） |
| 接口类 | 远程/上传/`dataSources` 仍禁 |
| DeliveryGuard 执行证据 | Playwright **真实渲染**；禁止 Node mock-this |
| 线上 applied 闸 | 设计器 **preview/render** 真实 VForm + `executionReport`；Agent **不内嵌** Playwright |
| 生成 | 受约束 JS；公式能表达的走 formula |
| 已有手写 | 覆盖-或-拒绝；无智能合并 |

## 版本定位

EventSpec → 生成 → AST 护栏 → `code_preview` → 真实 VForm 跑 examples → 仅 pass 后 `applied` 写画布。否则 `draft`。

## Product hard gates

| # | 本版 |
|---|---|
| G1 | 只写 shape 允许且 `writableIn=v0.8` 的键；签名仍与运行时一致 |
| G2 | NL 落地的行为与手动在预览里写同一段 JS 等价（该条 examples 覆盖到的行为） |
| G3 | 无 report.pass 不得 applied；summary 不得在 draft 时声称已更新事件 |

## Scope

### Deliverable 1 — generate + guard
- `/event` `action=generate`；`eventJsGuard`；mock 确定性代码；
- 负例：网络/eval/DOM/未知字段。

### Deliverable 2 — preview execution + apply
- 前端 preview runner + `executionReport`；
- `action=apply` 校验 report；合入 allowed 键；
- 未预览 / fail → draft。

### Deliverable 3 — Catalog breaking
- allowed-event / 纯前端 functions 可非空；
- 改写 `refine-dialog-event-forbid`（允许集落地，危险仍拒）；
- refine 路径继续 strip 事件。

### Deliverable 4 — Playwright 真实执行验收
- `e2e/tests/ai-form-v080.spec.ts`：S1–S5 至少各 1 条真实触发；
- 证据 `docs/evidence/v0.8.0/`。

## Non-goals

网络与危险构造；行事件写路径；列 render；智能合并；Agent 内启动浏览器当线上闸；mock-this 当 acceptance；v0.7 已交付的澄清（本版回归即可）。

## Breaking changes

见 PRD §10。须同 PR 改写 v0.7 仍锁定的「事件必须为空」断言中 **allowed 子集**；危险类断言保留。

## Affected contracts

见 design §8。

## Risks

伪造 pass、设计态不触发事件、oracle 与 e2e 分叉、范围膨胀到网络 JS。缓解见 design §9。

## Acceptance criteria

1. generate 护栏失败 → 无 candidate 合入；
2. generate 成功 → `code_preview`，画布未确认前事件未写入（或仅 candidate）；
3. 无/失败 executionReport → apply 拒绝，键仍空；
4. report.pass → applied，预览与确认后行为满足 examples；
5. Playwright 对 **联动 / 点击 / 生命周期挂载 / 子表行 / 表单校验** 真实触发 pass；其余可写键不要求一键一条 e2e，但仍须 example report 才 applied；
6. 危险键 / 行事件仍空；refine 仍禁事件；
7. 覆盖手写须确认；formula 优先仍成立；
8. v0.7 澄清回归；v0.6 结构回归。

## Acceptance candidates

| case-id | Requirement | Type | 真实执行 |
|---|---|---|---|
| `event-generate-onchange-preview` | FR-1 | agent | no（只到 code_preview） |
| `event-guard-forbid-network` | FR-2 | agent | no |
| `event-guard-forbid-eval-dom-timer` | FR-2 | agent | no |
| `event-guard-unknown-field-ref` | FR-2 | agent | no |
| `event-apply-without-report-rejected` | FR-3 | agent | no |
| `event-apply-failed-report-draft` | FR-3 | agent | no |
| `event-compute-onchange-apply` | FR-3 FR-4 | e2e | **yes** |
| `event-linkage-set-enable-apply` | FR-3 | e2e | **yes** |
| `event-show-hide-condition-apply` | FR-3 | e2e | **yes** |
| `event-button-onclick-open-dialog` | FR-3 | e2e | **yes** |
| `event-created-mounted-apply` | FR-3 | e2e | **yes** |
| `event-subform-row-apply` | FR-3 | e2e | **yes** |
| `event-form-validate-submit-guard` | FR-3 | e2e | **yes** |
| `event-allowlist-covers-pure-frontend` | FR-5 | static | no |
| `event-existing-handwritten-overwrite-or-reject` | FR-4 | agent | no |
| `event-formula-still-preferred` | FR-1 | agent | no |
| `event-dialog-allowed-vs-danger` | FR-5 | agent | no |
| `event-refine-still-forbids-events` | regression | agent | no |
| `event-v07-clarify-regression` | regression | agent | no |
| `refine-v06-regression` | regression | agent/e2e | no |
| `catalog-full-strict-sweep` | regression | static | no |
| `frontend-no-secret` | security | static | no |

## Out of scope reminder

不宣称任意 NL 都能生成任意 JS（尤其接口类）。保证：**纯前端事件属性均可作为落点** + **已执行 examples 的运行时正确**。

## Lifecycle note

OpenSpec status 为 `applied`。DeliveryGuard `v0.8.0` 已 published：source merged（`cd81e52d`，`main`）、acceptance passed、release published（`2026-09-23T06:16:16Z`，锚点 `https://github.com/renjing-2022/v-form-agent/tree/v0.8.0`）。本段只同步已存在事实。
