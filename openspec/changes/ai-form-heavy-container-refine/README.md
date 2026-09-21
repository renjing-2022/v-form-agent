# OpenSpec change: ai-form-heavy-container-refine

| 项 | 值 |
|---|---|
| Change ID | `ai-form-heavy-container-refine` |
| Target version | `v0.6.0` |
| Status | `applied`；source=`local` @ `8cb90a5`；acceptance=`passed`；release pending |

本目录为 DeliveryGuard 版本 `v0.6.0` 的 OpenSpec 挂载点。

## 用户确认边界（2026-09-21）

| 决策项 | 选择 |
|---|---|
| data-table | **扁平列**增删排改；多级表头 reject；**不开放**壳层 / tableData / ds* |
| sub-form | 子字段结构 op + 壳层属性；`addField` 进既有 sub-form（白名单 type only） |
| vf-dialog | **壳层属性** refine；dialog 内字段沿用 v0.5 op |
| 新建 | **不可**新建 data-table / sub-form / vf-dialog |
| grid-sub-form / vf-drawer | **仍 NON_GOAL** |
| reparent / 事件 / 扩 create | **不做** |
| E2E | **mock-only** |

## One-line scope

既有 data-table 扁平列增删排改 + 既有 sub-form 子字段结构 op / 壳层属性 + 既有 vf-dialog 壳层属性 refine；不可新建这些 type；不做事件、不做多级表头、不做 reparent、不扩字段 create 白名单；验收 mock-only。

## 关联文档

- `docs/requirements/ai-form-heavy-container-refine.md` — PRD（primary）
- `docs/design/ai-form-heavy-container-refine.md` — 技术设计
- `proposal.md` — 范围、契约、验收候选、**v0.5 断言改写清单**
- `tasks.md` — **权威**任务清单与 acceptance 表

## 前置版本

- `v0.5.0` released — Truth Strict A2 + remove/reorder/duplicate；重型容器仍 NON_GOAL

## 实现时注意

1. **Breaking**：v0.5 中 `data-table unsupported` / `vf-dialog blocked` 断言须在本版同 PR 改写，见 `proposal.md` § Breaking changes。
2. **列 op 专用路径**：勿依赖 `updateField(tableColumns)` 整段替换。
3. **验收 fixture**：data-table 用扁平列表；嵌套 header 专做负例（widgetsConfig 默认样例含嵌套，不宜直接当正向 fixture）。
