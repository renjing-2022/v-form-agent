# OpenSpec change: ai-form-nl-interaction-compiler

| 项 | 值 |
|---|---|
| Change ID | `ai-form-nl-interaction-compiler` |
| Target version | `v0.9.0` |
| Status | `applied`（acceptance passed；release published @ tag `v0.9.0`） |
| 实现位置 | `main` · source `f9e5244` · production `5e632fb` · tag `v0.9.0` |

## One-line scope

自然语言 → DeepSeek 直接写出结构变更、事件 JS 与验证场景 → 真实预览执行，失败自动修正（≤2 轮）→ 用户确认 → 结构与事件整体写入画布。

## 文档

- `docs/requirements/ai-form-nl-interaction-compiler.md`（primary，revision 3）
- `docs/design/ai-form-nl-interaction-compiler.md`（revision 3）
- `docs/releases/v0.9.0.md`
- `proposal.md` / `tasks.md` / `scenarios.md`

## 任务来源

实现任务以本目录 `tasks.md` 为准（交付物 0–6，均已勾选）。

## 进度摘要

| 交付物 | 状态 |
|---|---|
| 0–6 | 完成 |
| DeliveryGuard | `verified` → `released`（production tag `v0.9.0`） |

## 实现注意

1. 模型直接写 JS；本管线只禁网络请求。
2. mock 无匹配 fixture：交互类诚实报错；明确结构/禁网/澄清可本地意图回退。
3. 题库正例 e2e：真实 VFormRender 预览执行 scenarios，报告由观测组装。
