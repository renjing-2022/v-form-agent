# E2E evidence contract

The custom reporter writes `docs/evidence/<version>/<case-id>.txt` with:

- `case`
- `status`
- `observed`
- `environment`
- `sourceRevision`
- `capturedAt`
- `durationMs`
- `screenshot` when attached
- `error` when the test failed

Requirements:

1. Use repository-relative screenshot paths.
2. Record uncommitted source honestly; never invent a revision.
3. A screenshot supplements assertions and is not the only proof.
4. Failed or skipped output must not be recorded as a passing Manifest case.
5. Playwright output does not prove production deployment or release.
