# Archive note: ai-form-event-js-execution

Archived against DeliveryGuard version `v0.8.0` after tasks, source, acceptance, and release facts were already closed.

## Pre-archive checklist

| Check | Result |
|---|---|
| Tasks all checked | Yes |
| Proposal / tasks artifacts exist | Yes |
| Linked version validates | `v0.8.0` → `released` |
| Source | `merged` @ `cd81e52d` |
| Acceptance | `passed` |
| Production deployment | `succeeded` (GitHub tree `v0.8.0`) |
| Release | `published` |

## Proposal vs implemented (deliberate notes)

Aligned with proposal scope: constrained event JS, AST guard, real preview execution, server re-judge, overwrite-or-reject for handwritten handlers.

Visible residual / intentional limits:

1. Network / upload / data-source events remained forbidden.
2. Generation used constrained templates, not free-form NL-to-JS; that was delivered in `v0.9.0`.
3. Existing handwritten events were overwrite-or-reject, not merge.

## Archive action

- Move change under repository OpenSpec archive path via `openspec archive`.
- No OpenSpec `specs/` delta existed; archive uses `--skip-specs`.
- DeliveryGuard `openSpec.status` set to `archived` with updated path. Archiving closes the specification workflow only; acceptance and release remain separate facts already recorded on `v0.8.0`.
