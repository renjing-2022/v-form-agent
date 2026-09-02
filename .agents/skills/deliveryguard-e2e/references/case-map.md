# E2E case map

| Requirement | Case ID | Playwright behavior |
|---|---|---|
| `fr-4-confirm-apply` (v0.1) | `ui-canvas-apply-e2e` | Legacy id; v0.2.0 uses `text-generate-apply` for the same generate→apply path |
| `fr-1-dual-mode`, `fr-5-confirm-apply`, `td-generate-compat` | `text-generate-apply` | Text generation via local proxy; explicit apply shows canvas widgets |
| `fr-3-excel-generate`, `fr-4-confirm-apply` (v0.1 regression) | `ui-excel-canvas-apply-e2e` | Synthetic assessment workbook → scoring radios on canvas |
| `fr-5-ops-basics` (v0.1 regression) | `ui-invalid-upload-preserves-canvas` | Empty workbook errors; canvas unchanged |
| `fr-3-structure-options`, `td-plan-merge-validate` | `refine-structure-tab` | Refine wrapInTabs then apply; `.tab-container` visible |
| `fr-2-multiturn-session`, `td-session-current-json` | `refine-multiturn-apply` | Two refine rounds (tab then options/formula) applied; session messages remain |
| `fr-3-structure-options`, `fr-4-formula` | `refine-options-formula` | Refine options/formula then apply; option rewrite and/or 总分 visible |
| `fr-5-confirm-apply` | `refine-reject-keeps-canvas` | Forced refine 422 shows error; canvas widget count unchanged |
| `fr-6-text-boundary`, `td-refine-text-policy` | `refine-text-style-policy` | Style-only refine 422; error visible; canvas copy/count unchanged |
| `fr-6-text-boundary` | `refine-explicit-text-apply` | Explicit rename instruction refine 200; new label on canvas after apply |

Keep case IDs synchronized across the test annotation, `.deliveryguard/acceptance/<version>/evidence.json`, and `docs/evidence/<version>/<case-id>.txt`.

These are **acceptance** Playwright cases. Exploratory agent-browser runs use [agent-browser-scope.md](agent-browser-scope.md) and must be promoted via [promotion.md](promotion.md) before becoming a new row here.
