---
name: deliveryguard-e2e
description: Runs and maintains dual-layer browser E2E for v-form-agent — agent-browser exploratory discovery plus Playwright acceptance evidence mapped to DeliveryGuard cases. Use when adding, running, debugging, or reviewing E2E tests, exploratory UI checks, browser acceptance, AI-to-canvas flows, Excel UI imports, or Playwright evidence.
---

# DeliveryGuard E2E

Read `deliveryguard.config.json`, the target version record, its Evidence Manifest, and [references/case-map.md](references/case-map.md) before changing tests or evidence. Read [references/evidence-contract.md](references/evidence-contract.md) before stating a case result. Read [references/exploratory-layer.md](references/exploratory-layer.md) before using agent-browser.

## Dual-layer model

1. **Exploratory (agent-browser)** — feature-branch discovery and smoke. Output under `docs/exploratory/`. Never marks Manifest cases `pass`. See [references/agent-browser-scope.md](references/agent-browser-scope.md) and [references/diff-to-cases.md](references/diff-to-cases.md).
2. **Acceptance (Playwright)** — deterministic cases with `case-id`, reporter evidence under `docs/evidence/<version>/`. This is the only browser path that may update acceptance records.

Promote exploratory findings only via [references/promotion.md](references/promotion.md) and `docs/e2e/promotion-log.md`.

For the next OpenSpec change, optionally add an `## Acceptance candidates` section to that change's `tasks.md` using `docs/e2e/acceptance-candidates.template.md`. Full checklist: `docs/e2e/next-change-adoption.md`. This is an E2E adoption practice; it does not require editing OpenSpec propose skills.

## Exploratory workflow (agent-browser)

1. Use the same mock stack as Playwright (`v-form:3130`, `agent:3140`, `AGENT_ALLOW_MOCK=1`, empty `DEEPSEEK_API_KEY`).
2. Prefer `cd e2e && npm run explore:smoke` or follow [references/agent-browser-scope.md](references/agent-browser-scope.md).
3. Keep screenshots and notes under `docs/exploratory/<change-id>/`. Do not write those paths into Evidence Manifest cases as pass proof.
4. After exploratory work, run the matching Playwright subset from [references/diff-to-cases.md](references/diff-to-cases.md).

## Acceptance workflow (Playwright)

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
6. Treat `docs/evidence/<version>/<case-id>.txt` as the stable primary artifact. Playwright HTML reports, traces, `e2e/test-results/`, and `docs/exploratory/` are local diagnostics or discovery notes.
7. Update an Evidence Manifest case to `pass` only after its current Playwright run passed and the evidence file identifies the case, observed result, environment, source revision, and capture time.
8. Run `deliveryguard acceptance validate <version>` and `deliveryguard check` after changing acceptance records. A green exploratory or Playwright run does not create source, release, or deployment facts.

On failure, preserve the generated `fail` evidence and trace, diagnose the product or test-infrastructure cause, and do not weaken assertions to obtain a pass.
