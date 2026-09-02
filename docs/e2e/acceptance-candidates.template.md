# Template: Acceptance candidates (paste into tasks.md)

Copy the section below into `openspec/changes/<change-id>/tasks.md` when proposing a change. Adjust rows; delete unused types.

```markdown
## Acceptance candidates

Planned proof for this change. Status values: `planned` | `reuse` | `implemented` | `verified` | `deferred`.
Only Playwright (or other non-exploratory) runs that write `docs/evidence/<version>/<case-id>.*` may move a UI case to `verified`.
agent-browser output under `docs/exploratory/` is discovery only.

| case-id | Requirement id(s) | Type | Verification notes | Exploratory? | Status |
|---|---|---|---|---|---|
| `example-api-case` | `fr-x-...` | api | command or script that produces evidence txt | no | planned |
| `example-ui-case` | `fr-y-...` | playwright | assert user-visible contract; one case-id annotation | yes (during apply) | planned |

### Candidate rules

1. Prefer reusing existing Manifest case-ids when the requirement is unchanged (`Status: reuse`).
2. New UI case-ids must be added to `.agents/skills/deliveryguard-e2e/references/case-map.md` when implemented.
3. If exploratory finds a bug that becomes a new case, append a row to `docs/e2e/promotion-log.md` when the Playwright case lands.
4. Do not check a candidate as `verified` until evidence exists and `deliveryguard acceptance validate` is clean for in-scope updates.
```

## Types

| Type | Typical runner | Evidence |
|---|---|---|
| `api` | curl / agent smoke / script | `docs/evidence/<version>/<case-id>.txt` |
| `static` | source scan | same |
| `smoke` | `agent npm run smoke` | same |
| `playwright` | `cd e2e && npm test` | `.txt` + optional `.png` via reporter |
| `exploratory-only` | agent-browser | `docs/exploratory/` — **never** Manifest pass alone |
