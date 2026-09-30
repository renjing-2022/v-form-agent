# Proposal: ai-form-ask-before-act-governance

| 项 | 值 |
|---|---|
| Change ID | `ai-form-ask-before-act-governance` |
| Target version | `v0.10.0` |
| Primary document | `docs/requirements/ai-form-ask-before-act-governance.md` |
| Design | `docs/design/ai-form-ask-before-act-governance.md` |
| Affected repository | `app` (`.`) |

## Problem

v0.9 只有自由文本 `questions[]`，没有结构化 Ask-before-act、风险等级和事件冲突选择。继续扩大 Agent 创建面会放大误创建、误覆盖和高风险副作用。

## Scope

1. 结构化 clarification question/answer 契约；
2. `pendingPlan`、表单指纹和多轮状态机（含新 action `clarify`）；
3. L0–L3 风险策略与静态 parity；
4. AiChat 单选、多选、自由输入和确认 UI；
5. 既有手写事件的安全合并、显式覆盖和取消；
6. 澄清闭环与高风险门禁验收。

## Design notes

详见 `docs/design/ai-form-ask-before-act-governance.md`。关键边界：

- 明确且无 L2/L3（除可走冲突面板的 `event_overwrite`）时直接 `generated`；Ask-before-act 不是全局强制开关。
- 上传、声明式远程、跳转、storage、`eval_like`、批量删除等 L2 → 先 clarify；**仅事件键冲突** → generated + `eventConflicts`，apply 前决议。
- L3 → `unsupported`，无 pendingPlan。
- pending 仅回传 `PendingPlanView`；resume 留服务端；fingerprint 为整表稳定哈希。
- 事件合并模式仅 apply 阶段；AST 解析复用 `acorn`。
- `confirmOverwrite` 保留为全覆盖快捷方式；新 UI 优先 `eventResolutions`。
- 旧 `questions: string[]` 由 structured `prompt` 派生；验收以 structured 为准。

## Non-goals

- 扩展组件创建白名单；
- 任意网络 JS；
- 长期服务端会话 / 跨刷新持久化；
- 生产外部写入。

## Affected contracts

- `interactionOutput`：structured questions、pending plan、risk facts；
- `/api/agent/v1/interaction`：新增 `clarify`；`apply` 增 `eventResolutions`；
- AiChat：澄清表单、风险确认、事件冲突决议；
- event merge：AST 合并、覆盖确认、cancel；
- verification：按所选合并顺序重建场景并重验。

## Risks

- 提问过多：仅在歧义或 L2 时提问；
- 模型提供非法选项：服务端按 Catalog 和表单真源重判；
- 旧答案套用新画布：fingerprint 门禁；
- 合并改变语义：候选 diff + 按 mode 重验。

## Acceptance criteria

1. `need_clarification` 返回结构化问题并可由 UI 完成回答。
2. 明确 L1 指令不额外阻塞。
3. 六类 L2 动作均需确认；L3 拒绝。
4. 澄清到 applied 的完整 E2E 通过。
5. 事件合并/覆盖/取消均有正负例，未确认覆盖不得写入。
6. v0.9 interaction/refine/generate 回归不退化。
