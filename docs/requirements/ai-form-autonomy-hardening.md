# PRD：自主验证、事件合并与大表可靠性（v0.13.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-autonomy-hardening-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.13.0` |
| 状态 | proposed（DeliveryGuard planned；source / acceptance / release 未发生） |
| 关联 OpenSpec | `ai-form-autonomy-hardening` |
| 前置版本 | `v0.12.0` planned |

## 1. 目标

在组件创建面补齐后，提高 Agent 在真实大表、既有手写事件和多轮自动修正中的成功率。验证必须能独立发现错误，并在“修代码、重规划结构、请求澄清”之间正确分流，避免生成器与场景同源导致的假通过或无效死循环。

## 2. 自主验证

### FR-1 独立 critic

- Plan Critic 独立检查结构计划、目标解析、风险与能力边界。
- Scenario Critic 根据用户意图和候选表单生成或审阅验收场景。
- critic 输入保留原始意图摘要，但不得直接复用 generator 的结论作为正确答案。
- 候选通过必须同时满足静态策略、运行时报告和场景断言。

### FR-2 修正分流

失败必须分类：

1. handler code defect：允许有限次数代码修正；
2. structure/target defect：返回 planner 重新规划；
3. incomplete/ambiguous intent：Ask-before-act；
4. unsupported/risky：拒绝并说明边界；
5. preview infrastructure：标记阻塞，不消耗业务修正次数。

每次尝试记录不同 fingerprint；相同候选和相同失败不得重复执行。达到预算后返回可操作诊断，不得无限循环。

## 3. 大表上下文

当前摘要的 120 节点、深度 8 上限必须从静默截断改为可感知、可检索：

- 分片索引全部节点、父子关系、label/name/id/type；
- 按意图检索候选区域并保留祖先/兄弟上下文；
- 摘要声明 coverage、omissions 和 fingerprint；
- 目标歧义必须澄清；
- 结构事务前对完整画布重新验证。

## 4. 既有手写事件

在 v0.10 冲突决策基础上实现：

- AST 级安全分析，不以字符串拼接合并；
- 默认只在可证明不冲突时安全合并；
- 支持前置合并、后置合并、显式覆盖、取消；
- 无法解析、动态行为或风险升级时 Ask-before-act；
- 合并后必须保留既有行为场景并验证新行为；
- 覆盖必须保存可回滚候选，不直接破坏当前画布。

## 5. 全组件可靠性

建立组件 × 创建 × 属性 × 事件 × 动作 × 断言 × 风险的 capability matrix。所有静态与运行时扩展 type 均应有正例、负例或明确的 blocked 解释。

## 6. 可观测性与质量门槛

- 记录脱敏后的阶段、失败类别、修正次数、能力缺口和耗时；
- 不记录用户表单值、凭据、完整代码或敏感 endpoint；
- 用固定评测集和授权的真实模型评测度量首轮成功率、澄清率、修正成功率和假通过率；
- preview 报告包含结构 fingerprint、handler fingerprint、scenario 来源和执行环境；
- apply 前再次验证事务 fingerprint，失败可完整 rollback。

## 7. 非目标

- 放开生成 JS 网络请求；
- 以自动重试替代 Ask-before-act；
- 声称测试场景覆盖用户未描述的全部业务行为；
- 收集生产敏感输入作为训练或遥测数据。

## 8. 验收标准

1. 相同候选和错误不会循环执行，所有循环在预算内终止。
2. 结构错误会重规划，语义缺口会澄清，不再一律只修 JS。
3. 超过 120 节点或深度 8 的表单可准确目标定位，截断信息可见。
4. 既有事件支持安全前置、后置、覆盖和取消，并验证旧行为。
5. 全组件 capability matrix 无未解释空洞。
6. 失败报告能区分产品缺陷、模型失败、策略拒绝和预览基础设施问题。
7. 全链路事务失败时 form JSON 和既有 handlers 保持不变。

## 9. 风险

- critic 仍与 generator 同源：使用不同提示、输入边界和确定性校验交叉验证。
- AST 合并改变语义：只合并受支持语法并执行新旧场景。
- 大表检索漏掉跨区域引用：完整依赖索引和 apply 前全图验证。
- 遥测泄露业务数据：字段白名单、散列 fingerprint、采样和保留期控制。
