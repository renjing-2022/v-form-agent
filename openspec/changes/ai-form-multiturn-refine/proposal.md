# Proposal: ai-form-multiturn-refine

| 项 | 值 |
|---|---|
| Change ID | `ai-form-multiturn-refine` |
| Target version | `v0.2.0` |
| Primary document | `docs/requirements/ai-form-multiturn-refine.md` |
| Supporting design | `docs/design/ai-form-multiturn-refine.md` |
| Affected repository | `app` (`.` / 本仓库) |

## Problem

`v0.1.0` 只支持整表生成，无法对「当前画布已有表单」（导入 / 手拖 / 手改后的最新 JSON）做多轮自然语言优化。业务需要在保留生成入口的同时，用对话调整结构、选项与计算公式，并在确认后整表写回。

## Scope

1. 保留空画布 / 显式整表生成与 Excel 生成入口（兼容现有 `generate`）。
2. 新增基于 `currentFormJson` 的多轮 **refine** 能力：每轮携带前端最新 JSON + 会话消息（会话存前端内存）。
3. P0 优化范围：**结构、字段 options、公式（formula）**；合入时尽量保留未改控件的 `id` / `name`。
4. 扩展 Agent 组件白名单/模板（至少覆盖常见字段 + `tab`/`tab-pane` 及必要 grid），校验失败不写画布。
5. UI：多轮对话、预览 summary/warnings、确认后 `loadFormJson` 整表覆盖。

## Non-goals

- 自定义 CSS（`cssCode`）与自由事件 JS 自动生成（终局有、本版无）；
- Agent 服务端会话持久化；
- 全量冷门组件一次承诺（按白名单渐进）；
- PDF / Word / OCR；
- 生产部署拓扑变更。

## Affected contracts

| 契约 | 变更 |
|---|---|
| `POST /api/agent/v1/refine`（推荐新增） | 输入 `instruction` + `currentFormJson` + `messages[]`；输出 `{ summary, warnings[], formJson }` |
| `POST /api/agent/v1/generate` | 保持兼容，供整表生成 / Excel |
| `designer.getFormJson` / `loadFormJson` | 不改语义；每轮读最新 JSON，确认后整表覆盖 |
| 组件白名单 | 相对 MVP 扩展容器（tab 等）与公式相关 options |
| AiChat | 多轮 UI + 前端内存 session + 生成/优化双入口 |

## Design notes

1. **为何不用「FieldPlan 全量重生成」作为唯一路径**  
   会丢掉手改细节。P0 以 currentFormJson 为基底做受限合入。

2. **为何公式优先于自由 JS**  
   平台已有 `formulaEnabled` / `formula`；P0 验收面可控，自由脚本放到 P1。

3. **会话为何在前端**  
   产品已拍板 P0 前端内存；后续版本再评估服务端 session。

详细设计见 `docs/design/ai-form-multiturn-refine.md`。

## Risks

| 风险 | 缓解 |
|---|---|
| 嵌套组装失败 | 模板化容器形状 + 校验；失败返回可读错误 |
| 整表覆盖误伤 | 未改节点保留；UI 明确确认覆盖 |
| 上下文过长 | messages 可截断摘要，但 formJson 每轮必传最新 |
| 与 generate 行为混淆 | UI/路由区分空表生成与已有表优化 |

## Acceptance criteria

1. 空画布仍可整表生成并确认应用。
2. 已有表上可连续多轮优化，每轮基于最新画布 JSON；确认后画布更新。
3. 至少验证：结构（含 tab 或等价）、options、公式三类变更之一组可复现成功路径。
4. 校验失败 / 未确认时不破坏现有画布。
5. 密钥仍仅存 Agent 服务端。
