# Next-change adoption: acceptance candidates + promotion log

Use this on the **next** OpenSpec change (do not retrofit closed `v0.1.0` unless you open a new change).

**Scope of this guide:** lives under `docs/e2e/` and is enforced by `deliveryguard-e2e` when you touch browser acceptance. It does **not** require changing `deliveryguard-openspec-propose` or other OpenSpec skills. At propose time, paste the candidates section into `tasks.md` yourself (or ask the agent to follow this doc).

## Why

| Artifact | Role in Harness |
|---|---|
| `openspec/changes/<id>/tasks.md` → **Acceptance candidates** | Plan which cases will prove requirements before/during implementation |
| `docs/e2e/promotion-log.md` | Trace exploratory agent-browser findings that became Playwright acceptance cases |
| Playwright + `docs/evidence/<version>/` | Only path that may mark Manifest `pass` |

## When in the lifecycle

```text
propose  →  tasks.md includes Acceptance candidates (planned cases)
apply    →  implement; optional agent-browser exploratory under docs/exploratory/<change-id>/
promote  →  if finding becomes a case: Playwright + case-map + Manifest + ONE promotion-log row
verify   →  npm test → evidence → acceptance validate / check
```

## Checklist (copy into the change PR / chat)

### At propose time

- [ ] `tasks.md` has section `## Acceptance candidates` (use [acceptance-candidates.template.md](acceptance-candidates.template.md))
- [ ] Every candidate has: `case-id`, requirement id(s), type (`api` / `static` / `playwright` / `smoke`), status `planned`
- [ ] UI candidates note whether exploratory agent-browser is expected during apply
- [ ] Version record links this change; Manifest may still be empty / pending

### During apply

- [ ] Run `cd e2e && npm run explore:smoke` (or scoped agent-browser) when UI paths change
- [ ] Keep notes/screenshots under `docs/exploratory/<change-id>/` only
- [ ] Do **not** point Manifest evidence at `docs/exploratory/`

### On promotion (only if criteria in deliveryguard-e2e `promotion.md` hold)

- [ ] Add/strengthen Playwright test with one `case-id`
- [ ] Update `.agents/skills/deliveryguard-e2e/references/case-map.md`
- [ ] Register/update case in `.deliveryguard/acceptance/<version>/evidence.json` after a green run
- [ ] Append **one real row** to [promotion-log.md](promotion-log.md) (replace the placeholder dash row when first used)
- [ ] `deliveryguard acceptance validate <version>` and `deliveryguard check`

### Done means

- [ ] Acceptance candidates in `tasks.md` are checked or explicitly deferred with reason
- [ ] Manifest cases that claim `pass` have Playwright (or non-UI) evidence under `docs/evidence/<version>/`
- [ ] Promotion log has a row **only** for cases that actually came from exploratory → Playwright

## Minimal example (fictional next change)

**tasks.md excerpt:**

```markdown
## Acceptance candidates

| case-id | Requirement | Type | How verified | Status |
|---|---|---|---|---|
| `ui-apply-keeps-preview` | `fr-4-confirm-apply` | playwright | E2E: apply still requires confirm; preview unchanged | planned |
| `agent-health` | `fr-1-local-agent` | api | reuse existing case if still in scope | planned (reuse) |
```

**After promotion:**

```markdown
| 2026-09-15 | docs/exploratory/fix-preview-bug/issue-001.md | high | ui-apply-keeps-preview | fr-4-confirm-apply | agent-browser found Apply enabled after 400; locked by Playwright |
```
