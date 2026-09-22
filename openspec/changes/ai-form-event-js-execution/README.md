# OpenSpec change: ai-form-event-js-execution

| 项 | 值 |
|---|---|
| Change ID | `ai-form-event-js-execution` |
| Target version | `v0.8.0` |
| Status | `proposed`；source 空；acceptance/release `pending` |

v0.8 挂载点。**尚未实现。** 依赖 v0.7 EventSpec 契约。

## One-line scope

完备 EventSpec → 受约束 JS → AST 护栏 → 设计器真实预览跑 examples → 仅 pass 才 applied；Playwright 真实渲染作为仓库验收；不内嵌浏览器到 Agent 请求。

## 文档

- `docs/requirements/ai-form-event-js-execution.md`
- `docs/design/ai-form-event-js-execution.md`
- `proposal.md` / `tasks.md`

## 实现注意

1. 设计态不触发事件：验证必须走 VFormRender 预览。
2. 改写事件空串断言时 **只放开纯前端 allowlist**（不含远程/上传）。
3. `/refine` 不得开始接受 on*。
4. mock 只覆盖生成，不覆盖执行。
5. `onCreated`/`onMounted` 用预览装载触发，不要在设计态点控件。
