# Archive note: ai-form-nl-interaction-compiler

Archived against DeliveryGuard version `v0.9.0` after tasks, source, acceptance, and release facts were already closed.

## Pre-archive checklist

| Check | Result |
|---|---|
| Tasks all checked | Yes |
| Proposal / tasks artifacts exist | Yes (`proposal.md`, `tasks.md`, `scenarios.md`) |
| Linked version validates | `v0.9.0` → `released` |
| Source | `merged` @ `f9e5244` |
| Acceptance | `passed` |
| Production deployment | `succeeded` (GitHub tree `v0.9.0`) |
| Release | `published` |

## Proposal vs implemented (deliberate notes)

Aligned with proposal scope: unified `/interaction` entry, model-written JS + scenarios, real preview, repair budget, confirm-then-apply, network forbidden.

Visible residual / intentional limits:

1. Interaction create only supported `addButton`; arbitrary widget create remains planned in `v0.11.0` / `v0.12.0`.
2. Ask-before-act structured questions remain planned in `v0.10.0`.
3. Post-release repairs (`static-text` observe, `optionValueType` batch) were recorded as Repair Cases and are not part of this change’s original task list.

## Archive action

- Move change under repository OpenSpec archive path via `openspec archive`.
- No OpenSpec `specs/` delta existed; archive uses `--skip-specs`.
- DeliveryGuard `openSpec.status` set to `archived` with updated path. Archiving closes the specification workflow only; acceptance and release remain separate facts already recorded on `v0.9.0`.
