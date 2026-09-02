# E2E promotion log

Record **only** when an exploratory (agent-browser) finding becomes a Playwright acceptance case.
Do not log ordinary hand-written cases that never went through exploratory discovery.

| Date (UTC+8) | Exploratory source | Severity | Promoted case-id | Requirement | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | No promotions yet — replace this row on first promotion |

## How to append a row

1. Confirm promotion criteria in `.agents/skills/deliveryguard-e2e/references/promotion.md`.
2. Playwright case exists with `case-id`; green run wrote `docs/evidence/<version>/<case-id>.txt`.
3. Add one table row (example):

```markdown
| 2026-09-15 | docs/exploratory/my-change/issue-001.md (+ screenshots) | high | ui-example-case | fr-4-confirm-apply | Empty upload left Apply enabled; locked by expect().toBeDisabled() |
```

4. Keep exploratory artifacts under `docs/exploratory/`. Acceptance evidence remains under `docs/evidence/<version>/`.

See also: [next-change-adoption.md](next-change-adoption.md).
