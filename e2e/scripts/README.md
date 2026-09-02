# Local exploratory smoke (agent-browser)

This script is the exploratory layer. It does **not** write DeliveryGuard acceptance evidence.

Prerequisites:

- `agent-browser` installed (`npm install -g agent-browser && agent-browser install`)
- v-form on `http://127.0.0.1:3130` and agent mock on `3140`

Usage (from `e2e/`):

```bash
npm run explore:smoke
# or
node scripts/explore-smoke.mjs
```

Artifacts go to `docs/exploratory/local-smoke/`.
