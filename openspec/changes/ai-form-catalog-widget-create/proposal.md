# Proposal: ai-form-catalog-widget-create

| 项 | 值 |
|---|---|
| Change ID | `ai-form-catalog-widget-create` |
| Target version | `v0.11.0` |
| Primary document | `docs/requirements/ai-form-catalog-widget-create.md` |
| Affected repository | `app` (`.`) |

## Problem

组件 Catalog 有 37 个静态 type，但 generate 只产 8 类，refine 的创建 schema 仍绑定 8 类，interaction 合入仅支持 `addButton`。白名单与真实能力也存在 `grid/grid-col` 漂移，导致自然语言无法完成普通组件 + JS。

## Scope

1. Catalog 驱动的通用 `createWidget`；
2. 普通、非复合字段全量创建；
3. 组件中文语义别名和歧义澄清；
4. 新组件临时引用、确定性身份和 parent/position；
5. 结构候选与 JS handlers/scenarios 同一事务；
6. 普通组件预览动作和断言矩阵。

## Design notes

- Catalog 增加 `createKind`、`allowedParents`、`eventKeys`、`previewCapabilities`。
- 模型输出操作计划，不直接拼完整 widget JSON。
- `tempRef` 只在候选事务内有效，合入前解析为真实 name/id。
- 默认值、属性和联动全部复用 Catalog/DesignTruthGraph。
- 明确指令直达；type 有歧义时使用 v0.10 structured clarification。

## Non-goals

- 重型/复合容器、上传、远程数据源、runtime extension；
- 网络 JS；
- existing tree 的任意 reparent。

## Affected contracts

- FieldPlan/RefinePlan/InteractionOutput 统一创建操作；
- Widget Catalog create/interaction metadata；
- assembler/refine merger/interaction merger 的共享事务编译器；
- formSummary 的候选引用和父子结构；
- interaction runner 普通组件动作/观测。

## Risks

- 37 type 一次注入导致 prompt 膨胀；
- 别名冲突导致错选组件；
- 同批创建和事件引用身份不稳定；
- 组件 API 与手册漂移。

## Acceptance criteria

1. 普通字段覆盖矩阵全绿。
2. `number` 计数器 + 求和 JS 一句话端到端通过。
3. 结构或事件失败时全事务回滚。
4. 新组件引用、id/name 唯一、parent 合法。
5. Catalog 漂移检查覆盖 create/interaction metadata。
6. v0.10 与 v0.9 回归通过。
