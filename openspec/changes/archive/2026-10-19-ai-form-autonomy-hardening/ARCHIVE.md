# Archive note: ai-form-autonomy-hardening

Archived against DeliveryGuard version `v0.13.0` after tasks, source, and acceptance were closed. Production tag `v0.13.0` and release facts were recorded after archive (see version record).

## Pre-archive checklist

| Check | Result |
|---|---|
| Tasks all checked | Yes (`tasks.md` §1–§5) |
| Proposal / tasks artifacts exist | Yes (`proposal.md`, `tasks.md`) |
| Linked version validates | `v0.13.0` → `released` after release facts |
| Source | `merged` @ `7acf928786370f0f0d7215b417a5c27af5a384a0` (`app` / `main`) |
| Acceptance | `passed`（7/7 Manifest cases；agent + Playwright；report 齐全） |
| Production deployment | `succeeded` @ `db1b586d471bdd93bebf2ebe7e9f6007b3864e27`（GitHub tree `v0.13.0`） |
| Release | `published` |

## Proposal vs implemented (deliberate notes)

Aligned with proposal: Plan/Scenario Critic、失败分类与修正路由、fingerprint/budget、大表分片索引与可见截断、目标歧义 Ask-before-act、事件 AST 四模式合并与 rollback、capability matrix / preview provenance / 脱敏指标 / 事务完整性、v0.12–v0.10 回归。

Visible residual / intentional limits:

1. 验收 E2E / agent checks 在 `AGENT_ALLOW_MOCK=1` 下执行；真实模型评测仅在授权 `AGENT_EVAL_LIVE=1` 时可选，非本版 acceptance 锚点。
2. AST 合并仅覆盖受支持语法子集；无法证明安全时强制四选一澄清。
3. OpenSpec archive 关闭规格工作流；acceptance 与 release 为独立事实，已在版本记录中分别关闭。

## Archive action

- Move change to `openspec/changes/archive/2026-10-19-ai-form-autonomy-hardening`.
- No OpenSpec `specs/` delta in this change directory.
- DeliveryGuard `openSpec.status` → `archived`，path 更新为上述归档目录。
- Post-archive: `main` + annotated tag `v0.13.0` pushed to `origin`；deployment/release facts recorded on the version record.
