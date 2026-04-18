# Testing Guide

This project has three distinct testing concerns:

1. PTY-driven product behavior
2. MCP transport and SDK interoperability
3. Manual smoke testing of the advertised tool surface

Use this document for deeper testing guidance. Keep the README focused on what
the project is, how to install it, and the shipped tool surface.

## Choosing a mode

### Stream mode

Use `stream` mode for:

- normal CLIs
- REPL-like tools
- line-oriented interactive flows
- cases where transcript order matters more than screen position

### Buffer mode

Use `buffer` mode for:

- full-screen TUIs
- redraw-heavy terminal apps
- cursor-sensitive layouts
- screen-region and coordinate assertions
- resize and layout-regression checks

When driving redraw-heavy TUIs, prefer `wait_for_screen_change` and
`wait_for_screen_stability` over fixed sleeps.

## Typical workflow

```text
launch_tui(command="node", args=["./examples/counter.js"], mode="buffer")
expect_text(pattern="Counter value: 0")
send_keys(keys="+")
wait_for_screen_stability(stableForMs=200)
assert_contains(text="Counter value: 1")
send_keys(keys="q")
close_session()
```

Captured buffer sessions may persist:

- `screen.txt` for machine-friendly rendered text
- `screen.html` for deterministic human review of the settled buffer state
- `trace.json` and `metadata.json` for diagnostics

`trace.json` keeps a bounded rolling history. Input events record metadata only,
not raw keystroke payloads.
Oversized `screen.html` captures are replaced with a bounded omission page
instead of persisting arbitrarily large rendered HTML.

## Local commands

General local workflow:

```bash
npm install
npm run build
npm test
npm run test:pty
npm run test:mcp
npm run lint
npm run typecheck
```

Useful focused commands:

```bash
npm run test:pty
npm run test:mcp:raw
npm run test:mcp:sdk
npm run test:watch
```

## Validation lanes

Use separate validation lanes so MCP transport regressions are not mixed with
PTY behavior regressions.

### PTY behavior lane

```bash
npm run test:pty
```

This exercises real PTY integration behavior in `src/core/*.integration.test.ts`.

### MCP transport lanes

```bash
# Raw newline-delimited JSON-RPC over stdio against the built server
npm run test:mcp:raw

# Official TypeScript SDK client against the built server
npm run test:mcp:sdk

# Both MCP validation lanes
npm run test:mcp
```

`npm run test:mcp:*` rebuilds `dist/` first and then runs the built server as a
black-box stdio process. Use these commands in local workflows and CI when you
want MCP protocol failures reported separately from PTY behavior failures.

## Inspector smoke testing

Build first, then launch the server under the official Inspector:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

Recommended smoke checks:

- connect successfully over stdio
- confirm `tools/list` returns the advertised tool surface
- call `list_sessions` and verify it returns an empty list in a fresh server
- call `send_keys` with a missing `sessionId` and verify the response is a structured tool error, not a transport failure
- confirm startup and diagnostic logs appear in the Inspector notifications pane or stderr, not in tool results

## Conformance posture

Official conformance remains advisory for now. This server is still stdio-only,
and this repo does not yet expose a suitable URL-based transport target for the
current conformance runner. Treat the raw stdio lane, the SDK interoperability
lane, and the PTY behavior lane as the required validation stack until a URL
transport or dedicated bridge exists.
