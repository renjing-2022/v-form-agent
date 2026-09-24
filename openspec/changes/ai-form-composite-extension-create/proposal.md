# Proposal: ai-form-composite-extension-create

## Target

- Version: `v0.12.0`
- Primary requirement: `docs/requirements/ai-form-composite-extension-create.md`
- Status: proposed
- Depends on: `ai-form-catalog-widget-create`

## Problem

普通字段创建并不等于整个组件库可创建。重型组件依赖合法子树模板，上传和远程数据源跨越风险边界，`slot`、`card`、`alert` 及 custom/chart 又依赖运行时注册。当前白名单、Catalog 和 merger op 不一致，甚至 `grid/grid-col` 在白名单中也没有完整自然语言创建路径。

## Proposed change

1. 让 Catalog 同时描述叶子、复合、内部和运行时扩展组件。
2. 为复合组件增加版本化 template/preset 和 parent-child schema。
3. 让统一 createWidget 编译复合子树，而不是让模型手写任意嵌套 JSON。
4. 上传与远程数据源仅通过设计器原生声明式配置或受管 connector 表达。
5. 引入 extension manifest，`slot` 和已注册扩展可被发现、校验、创建与预览。
6. 将结构、事件和场景保持在一个原子候选事务中。

## Contracts

- Catalog composite schema and presets
- Extension manifest and registry fingerprint
- Declarative upload/data-source references
- Parent-child and required-child validation
- Composite preview act/assert registry
- Risk assessment integration

## Safety boundary

- 上传、远程、跳转和 storage 继续由 v0.10 风险策略治理。
- 允许声明式受管网络配置，不允许生成 JS 发起网络请求。
- 不保存凭据；生产写、未知 connector 和任意网络代码拒绝。
- internal type 不得脱离父结构创建。

## Non-goals

- 自动接入未注册插件；
- 自动创建生产 connector；
- 上传或远程请求的真实生产执行；
- 绕过组件库运行时约束。

## Risks

- 复合模板与运行时版本不一致；
- 预览环境意外产生真实副作用；
- extension manifest 过度授权；
- 所谓全覆盖只有结构加载而无交互验证。

以 manifest fingerprint、mock preview、能力等级、负例和全量矩阵控制这些风险。

## Acceptance

- Catalog 中所有组件都有明确、可执行的创建能力结论。
- 重型组件的最小合法子树可生成、加载、编辑和预览。
- 上传/远程配置有 L2 确认、脱敏证据和禁网 JS 负例。
- `slot`、`card`、`alert` 及测试扩展可通过 manifest 创建。
- 缺失或漂移 manifest 时诚实拒绝。
- 任一结构、事件或场景失败均不改变画布。
