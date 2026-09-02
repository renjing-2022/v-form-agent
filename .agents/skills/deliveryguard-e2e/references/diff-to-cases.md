# Diff → exploratory focus → Playwright cases

Use after a feature-branch change. Exploratory first (optional), then run the matching Playwright acceptance subset before updating Manifest evidence.

| Changed paths | agent-browser focus | Playwright cases |
|---|---|---|
| `v-form/src/**` AI panel / agent UI | AI tab, text generate, apply | `ui-canvas-apply-e2e`, prefer all three if apply wiring changed |
| `agent/src/services/excel*` or Excel UI upload | Excel upload + canvas radios | `ui-excel-canvas-apply-e2e`, `ui-invalid-upload-preserves-canvas` |
| `agent/src/services/planner*` / generate API | Text generate + apply | `ui-canvas-apply-e2e` |
| Shared canvas / apply confirm | Apply disabled/enabled, canvas retention | all three `ui-*-e2e` cases |
| Docs / DeliveryGuard / OpenSpec only | Skip browser exploratory | Skip Playwright unless case-map/evidence changed |

## Commands

Exploratory smoke (services already up on 3130/3140):

```bash
# from repo root, or via e2e npm script
npm --prefix e2e run explore:smoke
```

Acceptance (always before Manifest `pass`):

```bash
cd e2e
npm run typecheck
npm test
# or subset, e.g.:
npx playwright test --grep "canvas|excel|invalid"
```
