# Tasks: ai-form-autonomy-hardening

仅在实现与对应检查完成后勾选。

## 1. Critic 与修正状态机

- [ ] 定义 Plan Critic 独立输入输出
- [ ] 定义 Scenario Critic 独立输入输出
- [ ] 实现 code/structure/intent/policy/infrastructure 分类
- [ ] 将分类路由到修代码、重规划、澄清或拒绝
- [ ] 用 fingerprint 和 attempt budget 阻断无进展循环

## 2. 大表上下文

- [ ] 建立完整节点及依赖分片索引
- [ ] 实现意图检索和祖先/兄弟上下文扩展
- [ ] 摘要输出 coverage/omissions/fingerprint
- [ ] 目标歧义接入 Ask-before-act
- [ ] apply 前执行完整画布校验

## 3. 手写事件

- [ ] 建立支持语法子集与 AST 分析
- [ ] 实现安全前置合并
- [ ] 实现安全后置合并
- [ ] 实现显式覆盖和候选 rollback
- [ ] 无法证明安全时提供四选一澄清
- [ ] 合并后验证既有场景和新增场景

## 4. 可靠性与可观测性

- [ ] 生成全组件 capability matrix
- [ ] preview 报告记录结构/handler/scenario/environment fingerprint
- [ ] 记录脱敏失败分类、修正次数和耗时
- [ ] 固定评测集和授权真实模型评测
- [ ] 事务完整性和 rollback 故障注入

## 5. 验收

- [ ] 大于 120 节点和深度超过 8 的表单 E2E
- [ ] 自动修正分流与循环终止回归
- [ ] 手写事件前置/后置/覆盖/取消矩阵
- [ ] 上传、远程、runtime extension 风险回归
- [ ] v0.12/v0.11/v0.10 回归
- [ ] DeliveryGuard acceptance 全证据收口
