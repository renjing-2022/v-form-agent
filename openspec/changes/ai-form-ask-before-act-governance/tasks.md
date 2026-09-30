# Tasks: ai-form-ask-before-act-governance

仅在实现与对应检查完成后勾选。设计真源：`docs/design/ai-form-ask-before-act-governance.md`。

## 0. 设计与契约冻结

- [x] 撰写技术设计（状态机、schema、L0–L3、事件合并、UI、验证矩阵）
- [x] 将 design 登记进 `v0.10.0` 版本 documents
- [x] 实现前对照设计 §3–§5 做一次契约走查（无未决二义后再动代码）
  - 结论见 `docs/design/ai-form-ask-before-act-governance.md` §12（rev 2）；14 项二义已冻结

## 1. 契约与策略

- [x] zod：`ClarificationQuestion/Answer`、`PendingPlan`、`RiskFact`、`EventResolution`
- [x] `questions: string[]` 改为由 structured `prompt` 派生（兼容旧客户端）
- [x] `computeFormFingerprint` + 样例单测
- [x] `interactionRiskPolicy`：L0–L3 code 表与重判；`checkRiskPolicyParity`
- [x] 事件合并契约：`prepend` / `append` / `overwrite` / `cancel`（保留 `confirmOverwrite` 快捷）

## 2. 服务端状态机

- [x] 内存 `pendingPlanStore`（TTL；无跨刷新）
- [x] `/interaction` 新增 `action: clarify`（fingerprint / 过期 / 填槽）
- [x] `generate`：歧义或 L2 → `need_clarification`；明确 L1 → 直达 `generated`；L3 → 拒绝
- [x] 模型给出的 options 由服务端按 Catalog/表单重写（`clarificationOptionRewrite.ts`；confirm 模板 + widget/event 真源）
- [x] `eventAstMerge` + merger/apply 接入 `eventResolutions`
- [x] 未确认覆盖、指纹漂移、答案过期、用户 cancel → 画布不变

## 3. AiChat UI

- [x] 渲染单选、多选、文本、确认；推荐项与风险徽标
- [x] 展示 pending plan（goal / ambiguities / 影响 / riskFacts / nextSteps）
- [x] 「继续生成 / 返回修改 / 取消」→ clarify 或丢弃 plan
- [x] 当前会话内保持澄清状态（刷新失效为预期）
- [x] 事件冲突面板：diff + mergeSafe 模式下的决议
  - 附：`action: preview` 按决议重建候选后再验证/写入

## 4. 验证

- [x] agent：明确 L1 不追问（设计 A1）— `ask-before-act:check`
- [x] agent：L2 确认门禁与 L3 拒绝（A3/A4）— 同上
- [x] agent：事件合并/覆盖/取消与 fingerprint 过期（A5–A7）— 同上
- [x] E2E：含糊指令 → 回答 → generated → preview → applied（`ask-clarify-loop-apply`）
- [x] E2E：画布漂移后 `plan_expired`，画布不变（`ask-plan-expired-drift`）
- [x] E2E：覆盖取消后画布不变（`ask-conflict-cancel-unchanged`）
- [x] 回归：v0.9 interaction、frontend-no-secret

## 5. DeliveryGuard

- [x] 注册完整 acceptance manifest（映射设计 §9 / PRD FR）
  - evidence：`.deliveryguard/acceptance/v0.10.0/evidence.json`；report：`docs/acceptance/v0.10.0.md`
  - 8/8 cases pass；`acceptance validate` ok
- [ ] 记录真实 source revision 后再更新 sources（工作树未提交；禁止虚构 commit）
- [ ] 在 sources 登记后将版本 `acceptance.status` 从 pending 升为 passed（当前受 `acceptance.before-source` 约束）