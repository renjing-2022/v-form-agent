# agent-browser exploratory scope (v-form-agent)

Use this when running exploratory E2E with agent-browser. Keep scope local and mock-only.

## Prerequisites

1. Install once: `npm install -g agent-browser` then `agent-browser install`
2. Start the same stack Playwright uses:
   - agent: `AGENT_ALLOW_MOCK=1`, empty `DEEPSEEK_API_KEY`, port `3140`
   - v-form: `VITE_AGENT_PROXY_TARGET=http://127.0.0.1:3140`, port `3130`
3. Prefer Playwright `webServer` via `cd e2e && npm test` for acceptance; for exploratory-only sessions, start services manually if needed.

## Fixed target

```text
URL:   http://127.0.0.1:3130
Allow: 127.0.0.1, localhost
Out:   docs/exploratory/<change-id>/
```

Suggested project config (`agent-browser.json` at repo root, optional):

```json
{
  "allowedDomains": ["127.0.0.1", "localhost"],
  "screenshotDir": "docs/exploratory/screenshots"
}
```

## Required focus areas

| Area | What to exercise |
|---|---|
| Designer home `/` | Canvas `#formWidgetCanvas`, open AI tab |
| AI panel | Text generate, preview summary, explicit apply |
| Excel path | Upload synthetic assessment workbook, apply scoring radios |
| Negative path | Empty upload → visible error, Apply disabled, canvas preserved |

## Smoke batch (copy / adapt)

```bash
mkdir -p docs/exploratory/local-smoke
agent-browser batch --bail \
  "open http://127.0.0.1:3130" \
  "snapshot -i -s #formWidgetCanvas" \
  "find role tab click --name AI" \
  "snapshot -i -s .ai-agent-panel" \
  "screenshot docs/exploratory/local-smoke/ai-panel.png"
```

For Excel / empty-upload flows, use `upload` with a local fixture under `docs/exploratory/fixtures/` or regenerate a synthetic workbook. Do not use production or customer files.

## MCP / Cursor

`agent-browser mcp` may be used so the coding agent can drive the browser. Still treat every session as exploratory: write notes under `docs/exploratory/`, then run Playwright acceptance before updating any Manifest case.

## Diff mapping

See [diff-to-cases.md](diff-to-cases.md) for which Playwright cases to run after exploratory work.
