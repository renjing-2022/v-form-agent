# E2E dual-layer model

E2E in this repository has two layers. They strengthen each other; they are not substitutes.

| Layer | Tool | When | Output | Can mark Manifest `pass`? |
|---|---|---|---|---|
| Exploratory | [agent-browser](https://github.com/vercel-labs/agent-browser) | Feature branch, UI debugging, pre-PR discovery | `docs/exploratory/<change-id>/` | **No** |
| Acceptance | Playwright + `deliveryguard-reporter` | Version gate, case change, CI-style local verify | `docs/evidence/<version>/<case-id>.txt` | **Yes** |

## Why this strengthens E2E

- **Discovery**: agent-browser finds broken flows, console noise, and UX gaps that fixed specs may miss.
- **Stability**: Playwright keeps deterministic assertions, `case-id` mapping, and DeliveryGuard evidence.
- **Promotion**: high-value exploratory findings become new or stronger Playwright cases (see [promotion.md](promotion.md)).
- **Speed**: day-to-day work can use exploratory smoke; acceptance still runs the full Playwright suite before claiming verified.

## Hard rules

1. Never copy agent-browser reports into `.deliveryguard/acceptance/*/evidence.json` as passing proof.
2. Never treat `agent-browser chat` natural-language runs as acceptance.
3. Use the same mock environment as Playwright (`v-form:3130`, `agent:3140`, `AGENT_ALLOW_MOCK=1`).
4. Promote only reproducible, requirement-mapped issues into Playwright acceptance cases.
