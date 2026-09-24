# OpenSpec change: ai-form-event-interaction-js

| 项 | 值 |
|---|---|
| Change ID | `ai-form-event-interaction-js` |
| Target version | `v0.7.0` |
| Status | `applied`（已 merge `main`；acceptance passed；tag `v0.7.0` published） |
| 文档修订 | 3 — 2026-09-22 纯前端事件全覆盖预留；接口类禁 |

本目录为 DeliveryGuard 版本 `v0.7.0` 的 OpenSpec 挂载点。实现与验收已完成；事件 JS 生成/合入属 `v0.8.0`。

## 用户确认边界

| 决策项 | 选择 |
|---|---|
| 危险能力 | 一律禁止 |
| 终局 applied | Playwright 真实渲染执行断言（**后续版**） |
| API | 新端点 `POST /api/agent/v1/event` |
| 纯前端事件面 | shape 全覆盖预留 v0.8（含 created/mounted、子表行） |
| 接口类 | 远程/上传/`dataSources` 澄清即拒 |
| 本版范围 | **shape 登记 + 澄清闭环**；不生成、不合入、不执行 JS |

## One-line scope

登记事件 shape（全部仍禁写）+ 新 `/event` 端点多轮澄清产出 EventSpec（含可判定示例契约）；不写画布事件键；运行时正确性验收留给下一版。

## 关联文档

- `docs/requirements/ai-form-event-interaction-js.md` — PRD（primary，修订 3）
- `docs/design/ai-form-event-interaction-js.md` — 技术设计（修订 3）
- `proposal.md` / `tasks.md`

## 前置版本

- `v0.6.0` released — 事件仍整类 forbidden（本版合入层保持）

## 实现时注意

1. **不要**改写 `refine-dialog-event-forbid` 为可落地。
2. **不要**在本变更实现 `eventJsGuard` / 执行 harness / merger 写 `on*`。
3. summary / `applied` 不得表示事件 JS 已写入。
4. 后续版执行验收已锁定为 Playwright 真实渲染，不得用 Node mock-this 顶替。
