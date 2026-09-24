# OpenSpec change: ai-form-truth-strict-refine-structure

| 项 | 值 |
|---|---|
| Change ID | `ai-form-truth-strict-refine-structure` |
| Target version | `v0.5.0` |
| Status | `in_progress`（交付物 1–2 核心已实现；acceptance/E2E 待做） |

本目录为 DeliveryGuard 版本 `v0.5.0` 的 OpenSpec 挂载点。

## 用户确认边界（2026-09-20）

| 决策项 | 选择 |
|---|---|
| Truth 收敛 | **A2** — 全 applicable 键 strict，零 nullish 指纹 |
| 结构 op | **delete + 同级 reorder + duplicateField**；**无 reparent** |
| 删 tab-pane | 子控件 **一并删除** |
| create 白名单 | **不扩展** |
| E2E | **mock-only** |

## 关联文档

- `docs/requirements/ai-form-truth-strict-refine-structure.md`
- `docs/design/ai-form-truth-strict-refine-structure.md`
- `tasks.md` — 权威任务清单

## 前置版本

- `v0.4.0` released — DesignTruthGraph + IntentGate + NL 高精度主路径
