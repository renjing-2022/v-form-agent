# Exploratory → Playwright promotion

Promote an agent-browser finding into an acceptance case only when all of the following hold:

1. Severity is medium or higher (broken flow, wrong state, data loss, security boundary).
2. The issue is reproducible with clear steps and at least one screenshot under `docs/exploratory/`.
3. It maps to a registered requirement (or a new OpenSpec/requirement change is opened first).
4. It can be expressed as a deterministic Playwright assertion (counts, status codes, visible text, enabled/disabled).

## Steps

1. Keep the exploratory note and screenshots under `docs/exploratory/<change-id>/`.
2. Add or strengthen a test in `e2e/tests/` with exactly one `case-id` annotation.
3. Update [case-map.md](case-map.md) and the version Evidence Manifest when the case is in scope.
4. Run `cd e2e && npm test`; confirm `docs/evidence/<version>/<case-id>.txt` fields per [evidence-contract.md](evidence-contract.md).
5. Append exactly one real row to `docs/e2e/promotion-log.md` (see that file for the row format). Skip this step only if the Playwright case was authored without an exploratory finding.
6. Run `deliveryguard acceptance validate <version>` and `deliveryguard check` before claiming acceptance progress.

For the next-change planning checklist (candidates in `tasks.md` + promotion log), see `docs/e2e/next-change-adoption.md`.

## Do not promote

- One-off cosmetic issues without requirement coverage
- Flaky Agent mis-clicks or environment-only failures
- Console warnings that do not affect the user-visible contract
- Natural-language `agent-browser chat` transcripts without a reproducible scripted path
