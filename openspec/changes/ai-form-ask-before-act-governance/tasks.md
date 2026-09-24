# Tasks: ai-form-ask-before-act-governance

仅在实现与对应检查完成后勾选。

## 1. 契约与策略

- [ ] 定义 structured question/answer、pendingPlan、riskLevel schema
- [ ] 定义 form fingerprint、答案过期和重新规划规则
- [ ] 建立 L0–L3 动作分类与静态 parity 检查
- [ ] 定义事件合并顺序、覆盖确认和取消契约

## 2. 服务端状态机

- [ ] `/interaction` 支持提交结构化澄清答案
- [ ] 模型只可引用服务端给出的组件/动作候选
- [ ] 明确 L1 直达、L2 必问、L3 拒绝
- [ ] 事件 AST 安全合并与不可合并诊断
- [ ] 未确认覆盖、指纹漂移、答案过期均保持画布不变

## 3. AiChat UI

- [ ] 渲染单选、多选、文本、确认问题
- [ ] 展示 pending plan、假设、风险原因和预计影响
- [ ] 支持继续、修改、取消
- [ ] 当前会话内保持澄清状态
- [ ] 展示事件前置/后置合并及覆盖差异

## 4. 验证

- [ ] agent：明确 L1 不追问
- [ ] agent：L2/L3 分类与拒绝
- [ ] agent：事件合并/覆盖门禁
- [ ] E2E：含糊指令 → 回答 → generated → preview → applied
- [ ] E2E：画布漂移后 pending plan 失效
- [ ] E2E：覆盖取消后画布不变
- [ ] 回归：v0.9 interaction、refine、generate、frontend-no-secret

## 5. DeliveryGuard

- [ ] 注册完整 acceptance manifest
- [ ] 记录真实 source revision 后再更新 sources
- [ ] 全部案例有证据后方可将 acceptance 标为 passed
