# Archive note: ai-form-composite-extension-create

Archived against DeliveryGuard version `v0.12.0` after tasks, source, and acceptance were closed. Production tag / release facts remain separate and are recorded only after a concrete production anchor exists.

## Pre-archive checklist

| Check | Result |
|---|---|
| Tasks all checked | Yes (`tasks.md` §1–§5) |
| Proposal / tasks artifacts exist | Yes (`proposal.md`, `tasks.md`) |
| Linked version validates | `v0.12.0` → `verified` at archive time |
| Source | `merged` @ `ca648fa0bd41f87593d814f84ba0a1ff3d893f8a` (`app` / `main`) |
| Acceptance | `passed`（11/11 Manifest cases；agent + Playwright；report 齐全） |
| Production deployment | pending（尚未 push / tag） |
| Release | pending |

## Proposal vs implemented (deliberate notes)

Aligned with proposal: 复合模板与父子约束、上传/声明式远程受管引用、runtime extension manifest（slot/card/alert）、internal 无父负例、复合+JS 原子事务、Catalog 37 type 创建矩阵、v0.11/v0.10 回归。

Visible residual / intentional limits:

1. 验收 E2E 在 `AGENT_ALLOW_MOCK=1` 下执行；真实 DeepSeek 路径未作为本版本 acceptance 锚点。
2. custom/chart 等无 manifest 扩展仅做发现与诚实拒绝，不猜测创建。
3. worktree/CI 需本地提供 gitignored `v-form/lib/vuedraggable/dist`（不入提交）。

## Archive action

- Move change to `openspec/changes/archive/2026-10-13-ai-form-composite-extension-create`.
- No OpenSpec `specs/` delta in this change directory.
- DeliveryGuard `openSpec.status` → `archived`，path 更新为上述归档目录。
