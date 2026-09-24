# Proposal: ai-form-autonomy-hardening

## Target

- Version: `v0.13.0`
- Primary requirement: `docs/requirements/ai-form-autonomy-hardening.md`
- Status: proposed
- Depends on: `ai-form-composite-extension-create`

## Problem

扩大创建范围后，主要瓶颈转为验证独立性和复杂画布可靠性。当前生成代码与生成场景可能同源地犯错；自动修正主要围绕代码，无法处理结构计划错误；摘要上限会让大表目标消失；手写事件若只允许拒绝或覆盖，也无法满足增量改造。

## Proposed change

1. 引入独立 Plan Critic 和 Scenario Critic。
2. 建立分类修正状态机，在修代码、重规划、澄清和拒绝之间分流。
3. 为候选和失败建立 fingerprint 与预算，阻断无进展循环。
4. 用可检索分片索引替代静默摘要截断。
5. 用 AST 支持既有事件安全前置、后置与显式覆盖。
6. 建立所有组件和扩展的 capability matrix 与回归门禁。
7. 扩展 preview observability、脱敏质量指标和事务 rollback。

## Contracts

- Critic inputs/outputs
- Repair classification and attempt ledger
- Form index, retrieval and summary coverage
- Event AST merge plan
- Capability matrix
- Preview provenance and fingerprints
- Privacy-safe quality metrics

## Safety

- 沿用 v0.10 风险等级及 Ask-before-act。
- 沿用 v0.12 声明式远程与生成 JS 禁网边界。
- 事件覆盖始终是明确选择，不能从“帮我优化”隐式推导。
- eval 等高风险能力即使运行时存在，也不能绕过风险确认和静态策略。

## Non-goals

- 无限自动尝试；
- 对任意 JavaScript 做无损合并；
- 保存敏感表单内容作为遥测；
- 以模型自评代替运行时验证。

## Risks

- 多 critic 增加延迟和成本；
- 大表索引与画布漂移；
- AST 合并在闭包、异步和副作用顺序上不安全；
- 指标被“容易场景”美化。

通过预算、fingerprint、apply 前全图校验、受支持语法子集和固定评测集降低风险。

## Acceptance

- 失败分类能触发正确的修正路径且无死循环。
- 大表截断可见，目标检索和最终全图验证准确。
- 手写事件四种决策均有可回滚正负例。
- 全组件 capability matrix 和关键组合回归通过。
- 预览报告可追踪结构、handler、scenario 和环境来源。
- 质量指标脱敏且能区分模型、产品、策略和基础设施失败。
