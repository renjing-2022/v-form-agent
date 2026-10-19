# Tasks: ai-form-autonomy-hardening

仅在实现与对应检查完成后勾选。

## 1. Critic 与修正状态机

- [x] 定义 Plan Critic 独立输入输出
- [x] 定义 Scenario Critic 独立输入输出
- [x] 实现 code/structure/intent/policy/infrastructure 分类
- [x] 将分类路由到修代码、重规划、澄清或拒绝
- [x] 用 fingerprint 和 attempt budget 阻断无进展循环

## 2. 大表上下文

- [x] 建立完整节点及依赖分片索引
- [x] 实现意图检索和祖先/兄弟上下文扩展
- [x] 摘要输出 coverage/omissions/fingerprint
- [x] 目标歧义接入 Ask-before-act
- [x] apply 前执行完整画布校验

## 3. 手写事件

- [x] 建立支持语法子集与 AST 分析
- [x] 实现安全前置合并
- [x] 实现安全后置合并
- [x] 实现显式覆盖和候选 rollback
- [x] 无法证明安全时提供四选一澄清
- [x] 合并后验证既有场景和新增场景

## 4. 可靠性与可观测性

- [x] 生成全组件 capability matrix
- [x] preview 报告记录结构/handler/scenario/environment fingerprint
- [x] 记录脱敏失败分类、修正次数和耗时
- [x] 固定评测集和授权真实模型评测
- [x] 事务完整性和 rollback 故障注入

## 5. 验收

- [x] 大于 120 节点和深度超过 8 的表单 E2E
- [x] 自动修正分流与循环终止回归
- [x] 手写事件前置/后置/覆盖/取消矩阵
- [x] 上传、远程、runtime extension 风险回归
- [x] v0.12/v0.11/v0.10 回归
- [x] DeliveryGuard acceptance 全证据收口
