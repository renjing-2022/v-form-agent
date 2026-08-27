# E2E case map

| Requirement | Case ID | Playwright behavior |
|---|---|---|
| `fr-4-confirm-apply` | `ui-canvas-apply-e2e` | Text generation uses the local proxy and explicit apply produces visible canvas widgets |
| `fr-3-excel-generate`, `fr-4-confirm-apply` | `ui-excel-canvas-apply-e2e` | A synthetic assessment workbook produces scoring radio options and applies them |
| `fr-5-ops-basics` | `ui-invalid-upload-preserves-canvas` | An empty workbook shows an error, disables apply, and preserves the existing canvas |

Keep case IDs synchronized across the test annotation, `.deliveryguard/acceptance/<version>/evidence.json`, and `docs/evidence/<version>/<case-id>.txt`.
