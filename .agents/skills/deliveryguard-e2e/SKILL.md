---
name: deliveryguard-e2e
description: Runs and maintains Playwright browser E2E cases for v-form-agent, captures repository-local DeliveryGuard evidence, and maps UI outcomes to acceptance cases. Use when adding, running, debugging, or reviewing E2E tests, browser acceptance, AI-to-canvas flows, Excel UI imports, or Playwright evidence.
---

# DeliveryGuard E2E

Read `deliveryguard.config.json`, the target version record, its Evidence Manifest, and [references/case-map.md](references/case-map.md) before changing tests or evidence. Read [references/evidence-contract.md](references/evidence-contract.md) before stating a case result.

## Workflow

1. Keep browser tests in `e2e/tests/`; use Playwright Chromium and the isolated `webServer` ports (`v-form:3130`, `agent:3140`).
2. Default to `AGENT_ALLOW_MOCK=1` with an empty `DEEPSEEK_API_KEY`. Do not use production, real customer files, or paid model calls unless explicitly authorized.
3. Use accessible locators or stable application IDs. Wait for the `/api/agent/v1/generate` response instead of fixed sleeps.
4. Give every acceptance test exactly one `case-id` annotation and attach:
   - `observed`: a concise machine-readable assertion summary;
   - `deliveryguard-screenshot`: the relevant final UI state.
5. Run from `e2e/`:
   - `npm run typecheck`
   - `npx playwright install chromium` when the browser is unavailable
   - `npm test`
6. Treat `docs/evidence/<version>/<case-id>.txt` as the stable primary artifact. Playwright HTML reports, traces, and `e2e/test-results/` are local diagnostics.
7. Update an Evidence Manifest case to `pass` only after its current run passed and the evidence file identifies the case, observed result, environment, source revision, and capture time.
8. Run `deliveryguard acceptance validate <version>` and `deliveryguard check` after changing acceptance records. A green E2E run does not create source, release, or deployment facts.

On failure, preserve the generated `fail` evidence and trace, diagnose the product or test-infrastructure cause, and do not weaken assertions to obtain a pass.
