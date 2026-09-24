# Proposal: ai-form-ask-before-act-governance

| 项 | 值 |
|---|---|
| Change ID | `ai-form-ask-before-act-governance` |
| Target version | `v0.10.0` |
| Primary document | `docs/requirements/ai-form-ask-before-act-governance.md` |
| Affected repository | `app` (`.`) |

## Problem

v0.9 只有自由文本 `questions[]`，没有结构化 Ask-before-act、风险等级和事件冲突选择。继续扩大 Agent 创建面会放大误创建、误覆盖和高风险副作用。

## Scope

1. 结构化 clarification question/answer 契约；
2. `pendingPlan`、表单指纹和多轮状态机；
3. L0–L3 风险策略；
4. AiChat 单选、多选、自由输入和确认 UI；
5. 既有手写事件的安全合并、显式覆盖和取消；
6. 澄清闭环与高风险门禁验收。

## Design notes

- 明确且低风险的指令直接生成候选；Ask-before-act 不是全局强制开关。
- 上传、声明式远程数据源、跳转、storage、`eval` 和事件覆盖固定为 L2。
- 生成 JS 继续禁网；声明式数据源不是放开网络 JS。
- pending plan 绑定当前 form fingerprint，画布变化后答案作废。
- 事件默认安全合并；无法证明可组合时让用户选择前置、后置、覆盖或取消。

## Non-goals

- 扩展组件创建白名单；
- 任意网络 JS；
- 长期服务端会话；
- 生产外部写入。

## Affected contracts

- `interactionOutput`：structured questions、pending plan、risk facts；
- `/api/agent/v1/interaction`：clarify answer action 或等价状态；
- AiChat：澄清表单和风险确认；
- event merge：AST 合并、覆盖确认；
- verification：用户选择后的场景重建与重验。

## Risks

- 提问过多：仅在歧义或 L2 时提问；
- 模型提供非法选项：服务端按 Catalog 和表单真源重判；
- 旧答案套用新画布：fingerprint 门禁；
- 合并改变语义：候选 diff + 真实预览。

## Acceptance criteria

1. `need_clarification` 返回结构化问题并可由 UI 完成回答。
2. 明确 L1 指令不额外阻塞。
3. 六类 L2 动作均需确认；L3 拒绝。
4. 澄清到 applied 的完整 E2E 通过。
5. 事件合并/覆盖/取消均有正负例，未确认覆盖不得写入。
6. v0.9 interaction/refine/generate 回归不退化。
