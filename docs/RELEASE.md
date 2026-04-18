# Release Checklist

This is the human-facing gate for publishing `tui-testing-mcp` to npm. It complements the hard gate enforced by `prepublishOnly` in `package.json` by adding the manual Inspector smoke pass, which cannot be automated.

## Scope reminder

Keep release messaging aligned with the project scope:

> stdio MCP server for terminal and TUI testing, supported on macOS and Linux and experimentally on native Windows (cmd-first), guarded execution (not sandboxing), and official MCP conformance remains advisory.

If a release changes any of those five properties, the README, `docs/SECURITY.md`, `docs/TESTS.md`, and `docs/windows-support.md` must be updated together.

## Pre-publish steps

Run these in order from a clean checkout. Stop on the first failure.

1. `git status` is clean, branch is `main`, synced with `origin/main`.
2. `npm ci` to install exact dependency versions.
3. `npm run build` (also clears `dist/`).
4. `npm run typecheck`
5. `npm run lint`
6. `npm test` runs the full vitest suite. `vitest.config.ts` includes `src/**/*.test.ts` and `tests/**/*.test.ts`, which already covers the PTY integration tests (`src/core/*.integration.test.ts`) and the MCP transport tests (`tests/mcp/*.test.ts`).
7. `npm run test:mcp` to force a rebuild of `dist/` and rerun the raw-protocol and SDK-interop lanes against the freshly built server. This catches cases where the black-box stdio target drifts from the sources.
8. Inspector smoke pass (see below). Not scripted; must be run manually.
9. Confirm the published entrypoint is correct: `node dist/index.js --help` (or equivalent startup) exits cleanly and writes nothing to stdout that would break MCP stdio transport.
10. Bump `version` in `package.json`, commit, tag (`git tag vX.Y.Z`), `npm publish`, `git push --tags`.

Steps 2 through 7 are also enforced automatically by `prepublishOnly`. Running them manually first keeps the feedback loop tight and surfaces failures before the publish flow starts.

## Inspector smoke pass

Against the built server, exercise the checklist from `docs/TESTS.md` and record the results (paste them into the release PR or changelog entry):

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

Checklist:

- [X] initialize / connect succeeds over stdio
- [X] `tools/list` returns the advertised tool surface
- [X] `list_sessions` returns an empty list on a fresh server
- [X] `send_keys` with a missing or unknown `sessionId` returns a structured tool error, not a transport-level JSON-RPC error or a crash
- [X] startup and diagnostic logs appear in the Inspector notifications pane or on stderr, never inside tool results

If any check fails, do not publish. Fix the regression and rerun from step 3.

## After publish

- Verify `npx -y tui-testing-mcp@<version>` connects under the Inspector as a fresh smoke.
- Update `CHANGELOG` or release notes with the Inspector smoke outcome, any doc changes, and the platform/Node matrix that was validated.
