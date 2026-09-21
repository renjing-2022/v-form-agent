$ErrorActionPreference = 'Stop'
Set-Location 'e:\projects\gz\lowCode\v-form-agent\agent'
npm run catalog:sync
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run catalog:check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run acceptance:cases
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Location 'e:\projects\gz\lowCode\v-form-agent\e2e'
$env:EVIDENCE_VERSION = 'v0.5.0'
npm test -- tests/ai-form-v050.spec.ts
exit $LASTEXITCODE
