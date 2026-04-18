# tui-testing-mcp

MCP server for driving and checking terminal programs over a PTY.

Requires Node >= 20.11. `AGENTS.md` is a symlink to this file.

This project is a TypeScript and Node.js MCP server for testing:
- simple CLI flows in `stream` mode
- full-screen redraw-heavy TUIs in `buffer` mode

Examples of target apps:
- Rust `ratatui`
- Go `bubbletea`
- Python TUIs
- Node CLIs
- raw binaries

## What to optimize for

1. Preserve the MCP testing surface
2. Keep stream mode and buffer mode both useful
3. Prefer exact argv over shell parsing
4. Keep the server language-agnostic
5. Make docs match the actual tool surface
6. Keep stdout clean for MCP stdio transport
7. Add tests with every behavior change

## Core invariants

- `launch_tui` must support exact `command` plus `args`
- shell parsing must be opt-in via `shell: true`
- target-based launch must resolve through config and runner adapters
- stream mode must support capture and text assertions
- buffer mode must support screen-aware inspection
- buffer-mode artifact capture must keep writing `screen.txt` and, when artifacts are captured, may also write deterministic `screen.html`
- session IDs are reusable, but old sessions must be closed first
- session resize must keep PTY and buffer dimensions in sync
- redraw-heavy waits should prefer `wait_for_screen_change` / `wait_for_screen_stability` over fixed sleeps
- command execution must respect security policy
- invalid `artifactRedactions` must fail closed instead of being silently ignored
- all logs go to stderr, never stdout
- MCP tools register via `server.tool(name, rawShape, handler)` — do not switch to `registerTool` with `z.preprocess`, since preprocess wrappers collapse the emitted tools/list JSON schema to `{}` (see src/server/index.ts)

## Session gotchas

- Keep resource bounds explicit. Current expectations are:
  - transcript rolling buffer is capped at 1 MB in UTF-8 bytes, not JS character count
  - session trace is capped at 4096 events
  - non-PTY command helpers cap `stdout` and `stderr` at 1 MB per stream and terminate on overflow
  - rendered `screen.html` capture is capped at 1 MB and may be replaced by a deterministic omission page
- Do not store raw typed input in trace artifacts. `input` trace events should keep metadata only (`length`, `utf8Bytes`, control/newline/escape flags), not the original payload.
- Preserve the newer transcript/buffer allocation behavior in `src/core/session.ts`:
  - transcript chunks are byte-bounded on write
  - raw transcript joins are cached until new PTY output arrives
  - ANSI-stripped transcript reads are cached until new PTY output arrives
- Preserve the newer artifact persistence behavior in `src/artifacts.ts`:
  - `captureAndPersistArtifacts()` should avoid building a second full in-memory bundle just to write files
  - `trace.json` and `metadata.json` are written incrementally instead of one large `JSON.stringify(..., null, 2)` string
  - redaction helpers clone lazily, so unchanged strings/objects/arrays should keep their original references
- Be careful when touching real-PTY integration tests. In this repo, full-suite runs can intermittently fail with blank buffer reads even when the affected file passes in isolation. If a PTY integration fails once under `npm test`, rerun the specific file before assuming your code caused a deterministic regression.
- Three real-PTY integration tests are skipped on Windows via `it.skipIf(process.platform === "win32")` because of ConPTY / node-pty issues documented in `docs/windows-support.md` "Known upstream issues". Do not remove those guards without confirming the upstream fix has landed:
  - `src/core/engine.integration.test.ts` — *reconciles shrink and grow redraws …* (ConPTY drops initial render)
  - `src/core/engine.integration.test.ts` — *cleans isolated working directories on close …* (rmdir races with node-pty handle release, EBUSY)
  - `src/core/wait.integration.test.ts` — *drives a redraw-heavy TUI …* (ConPTY drops initial render)
- The Windows CI job is pinned to Node 20 while macOS and Linux run Node 22, because Node 22 + `node-pty@^1.1.0` + ConPTY assert inside `ncrypto::CSPRNG` when the PTY child is a Node.js process. See `.github/workflows/ci.yml`.

## Project structure

- `src/server/`
  - MCP tool surface
- `src/core/`
  - PTY, terminal buffer, key parsing, sessions, assertions
- `src/runners/`
  - cargo, go, node, python, binary adapters
- `src/config/`
  - config discovery, normalization, schema
- `src/security/`
  - workspace, command, shell, env policy
- `src/bridges/`
  - transport bridges for MCP clients
- `src/shell/`
  - shell parsing and quoting helpers
- `src/` (top-level)
  - `index.ts` entrypoint, `artifacts.ts`, `logging.ts` (stderr only)
- `examples/`
  - small real programs used for integration tests
- `schema/`
  - JSON schema for config
- `tests/mcp/`
  - raw-protocol and SDK interop tests
- `openspec/changes/`
  - active change proposals; completed changes move to `openspec/changes/archive/YYYY-MM-DD-<slug>/`. Always check the archive before describing a change as pending.

## Preferred design choices

### Launching
Prefer:
- `command` + `args`
- `target`

Avoid:
- reparsing a single shell string unless `shell: true`

### Compatibility
Keep conceptual compatibility with the original Python MCP server where it helps:
- same core tool names
- same stream vs buffer model
- similar testing flow

But do not stay locked to Python-era parameter names if they make the TS API worse. If aliases are supported, document them clearly.

When adding a tool that needs Python-surface aliases: spread the relevant `*Alias` fragment from `src/server/aliases.ts` into the raw shape and call `normalize(raw)` at the top of the handler. If a canonical camelCase field is required AND aliased, make it `.optional()` in the schema and check presence after normalize — otherwise Zod rejects snake_case-only calls before the handler runs (see `get_screen_region`, `resize_session`).
Also register the `["snake", "camel"]` pair in `ALIAS_PAIRS` in `src/server/aliases.ts`; `normalize()` only copies pairs listed there. Never inline a bare `snake_case: z.…` field in a handler's schema.
After `normalize(raw)`, camelCase fields that carry a Zod `.default(...)` are guaranteed defined. Don't add defensive `params.x ?? <default>` fallbacks in the handler body — they're dead code.

### Security
Default to least surprise:
- workspace-bounded execution
- explicit shell opt-in
- optional command allow and deny lists
- optional env allowlist

### Testing
Prefer:
- unit tests for parsing, config, policy, and session bookkeeping
- integration tests with a real PTY against `examples/`
- tests for regressions before refactors

### Large files
Current guidance, these are large by choice unless their responsibilities change:
- `src/server/index.ts` keeps inline MCP tool registration so schemas and handlers stay together. Do not split tools into many tiny files just to reduce line count.
- `src/core/session.ts` keeps `SessionManager` and `Session` together because PTY lifecycle and session bookkeeping are tightly coupled.
- If these files grow again, prefer the already-approved helper seams (`src/server/lifecycle.ts`, `src/server/target-commands.ts`, `src/core/session-launch.ts`, `src/core/session-isolation.ts`) over broader refactors.

## Documentation rules

When changing behavior, update:
- `README.md`
- config examples
- `docs/CONFIG.md` when config fields, examples, or config semantics change
- `docs/SECURITY.md` when workspace, command, shell, or env policy semantics change
- `docs/windows-support.md` when platform behavior or Windows-specific caveats change
- tool examples
- any compatibility notes
- artifact docs when capture bundle contents change
- `docs/TESTS.md` when testing workflows, validation lanes, or smoke-test guidance change

Prefer README structure that front-loads:
- what the project is for
- quick start / client setup
- the actual shipped tool surface
- the most common MCP client first, with secondary client setup hidden behind collapsible sections when the list gets long
- grouped tables for broad tool references when a long stack of tiny subsections gets hard to scan
- deeper testing and validation guidance should usually live in `docs/TESTS.md`, not in the README
- deeper config reference should usually live in `docs/CONFIG.md`, not in the README

Do not document features as shipped if they are only partially wired.

## Current direction

The direction is:

- TypeScript MCP server
- PTY-driven terminal automation
- language-agnostic target execution
- safe default execution model
- strong support for Rust and Go TUIs
- ad hoc terminal driving plus target-aware launch and testing

Borrow ideas from the Python repo and Microsoft `tui-test`, but do not imply we embed their runtime unless we actually do.

## Commands

```bash
npm install
npm run build            # clean + tsc
npm run dev              # tsx watch src/index.ts
npm start                # node dist/index.js
npm run start:stdio      # run with --transport stdio
npm test                 # vitest run (all)
npm run test:mcp         # raw protocol + SDK interop (builds first)
npm run test:mcp:raw     # just raw protocol
npm run test:mcp:sdk     # just SDK interop
npm run test:pty         # PTY integration tests in src/core
# Note: `npm test` includes both `src/core/*.integration.test.ts` (the `test:pty` subset)
# and `tests/mcp/*.test.ts`, which black-box `dist/index.js`. Run `npm run build` first,
# or use `npm run test:mcp` which rebuilds. Without a fresh build, MCP lane tests can be stale.
npm run test:watch       # vitest watch mode
npm run lint
npm run typecheck
npm run clean            # remove dist, .turbo, coverage
```

Published binary: `tui-test-mcp` -> `dist/index.js` (see `package.json` `bin`).

## Release expectations

The full pre-publish checklist lives in `docs/RELEASE.md`. The `prepublishOnly` hook enforces the scripted portion (`clean → build → typecheck → lint → test → test:mcp`). The Inspector smoke pass is manual and must be run before every publish.

Before release, make sure:
- docs match the actual server tool surface and the scope sentence in the README
- stream mode works end to end
- target-based launch is covered by tests
- security checks are enforced in launch and command execution paths
- example config works from a nested directory
- published entrypoint is correct (`dist/index.js` is built and runnable)
- CI is green on both `macos-latest` and `ubuntu-latest`
- `docs/windows-support.md` still accurately describes the shipped shell adapter surface
