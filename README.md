# tui-testing-mcp

Like Playwright, but for terminal UIs.

`tui-testing-mcp` is an MCP server for driving and checking interactive terminal programs over a PTY. It supports simple sequential CLI flows in `stream` mode and full-screen redraw-heavy TUIs in `buffer` mode.

Scope in one sentence: stdio MCP server for terminal and TUI testing, Unix-focused (macOS and Linux), native Windows unsupported, guarded execution (not sandboxing), and official MCP conformance remains advisory.

This project is a TypeScript and Node.js port of the original Python MCP TUI test server, expanded toward language-agnostic target execution for Rust, Go, Python, Node, and raw binaries. It keeps the same PTY-plus-buffer testing model, but the product here is an MCP server, not a standalone test framework.

## Why use it

Use this when you want an MCP client or coding agent to:
- launch a terminal program in a PTY
- send input
- capture output
- inspect a full-screen TUI buffer
- wait for text
- wait for redraws or screen stability without ad hoc sleeps
- assert on terminal state
- persist reviewable artifacts, including `screen.html` for buffer-mode captures
- resolve named targets from config instead of guessing commands

Good fits:
- Rust `ratatui`
- Go `bubbletea`
- Python TUIs
- Node CLIs
- built binaries

See [Non-goals](#non-goals) for what this is explicitly not trying to be.

## Current shape

Today the project includes:

- split runtime across `core/`, `server/`, `runners/`, `config/`, and `security/`
- exact `command` plus `args` launching
- explicit `shell: true` support for raw shell commands
- target-based launch through runner adapters and JSON config
- stream-mode capture and assertions
- buffer-mode screen inspection and coordinate checks
- screen-settling waits for redraw-heavy TUIs
- rendered `screen.html` artifacts for captured buffer sessions
- workspace and command security policy
- unit and integration coverage around core behavior

## Non-goals

These are intentionally out of scope for the first release. If you need any of them, this is not the tool:

- a general-purpose end-user terminal recorder
- a standalone assertion library independent of MCP
- a browser-style visual snapshot system
- a full replacement for every native language test runner

## Requirements

- Node.js 20.11 or newer
- macOS or Linux
- `node-pty` must build successfully for your local Node version

## Platform Support

| Area      | Status             | Notes                                                |
| --------- | ------------------ | ---------------------------------------------------- |
| macOS     | Supported          | Covered by CI (`macos-latest`, Node 22).             |
| Linux     | Supported          | Covered by CI (`ubuntu-latest`, Node 22).            |
| Windows   | Unsupported        | No Windows CI; `cmd.exe` adapter ships but is unvalidated. |
| WSL2      | Not supported yet  | Not evaluated or tested; may work, not guaranteed.   |
| Transport | stdio only         | No HTTP or SSE transport. See [docs/TESTS.md](docs/TESTS.md). |

Windows remains unsupported because the repo does not yet validate the `cmd.exe` shell adapter against a real Windows runner, does not run Windows CI, and has not validated PTY snapshot stability on Windows. See [docs/windows-support.md](docs/windows-support.md) for the full evaluation, blockers, and prerequisites before this should be reconsidered.

Official MCP conformance is advisory for this project. The required validation stack is the three lanes documented in [docs/TESTS.md](docs/TESTS.md): raw stdio, SDK interoperability, and PTY behavior.

## Quick start

```bash
npm install
npm run build
npm start
```

The server speaks MCP over stdio. For one-off MCP client setup, the shortest form is:

```bash
npx -y tui-testing-mcp
```

There are no special trigger words. Once the server is connected in your MCP client, ask in plain English for the outcome you want.

## MCP client setup

All examples below use the published package and assume `node` and `npx` are already available on your machine.

Recommended default, Claude Code:

Add this server as a local stdio MCP process:

```bash
claude mcp add --transport stdio --scope local tui-test -- \
  npx -y tui-testing-mcp
```

Notes:

- Put all Claude flags before the server name (`tui-test`)
- Use `--` to separate Claude's flags from the server command and its args
- `--scope local` keeps the server private to your current project
- `--scope project` writes shared config to `.mcp.json`
- `--scope user` makes the server available across your projects

If you want to check in a shared project config, create `.mcp.json` in the repo root:

```json
{
  "mcpServers": {
    "tui-test": {
      "command": "npx",
      "args": [
        "-y",
        "tui-testing-mcp"
      ]
    }
  }
}
```

Use `--scope project` if you want Claude Code to write the shared config for you:

```bash
claude mcp add --transport stdio --scope project tui-test -- \
  npx -y tui-testing-mcp
```

Verify and manage the server with:

```bash
claude mcp list
claude mcp get tui-test
claude mcp remove tui-test
```

Inside Claude Code, use `/mcp` to confirm the server is connected.

Other clients:

<details>
<summary>Codex</summary>

Add the server with the Codex CLI:

```bash
codex mcp add tui-test -- npx -y tui-testing-mcp
```

Verify and manage it with:

```bash
codex mcp list
codex mcp get tui-test
codex mcp remove tui-test
```

Codex CLI and the Codex IDE extension share the same MCP config. If you want to edit it directly, add this to `~/.codex/config.toml`:

```toml
[mcp_servers."tui-test"]
command = "npx"
args = ["-y", "tui-testing-mcp"]
```

</details>

<details>
<summary>Cursor</summary>

Create `~/.cursor/mcp.json` on macOS/Linux:

```json
{
  "mcpServers": {
    "tui-test": {
      "command": "npx",
      "args": ["-y", "tui-testing-mcp"]
    }
  }
}
```

Restart Cursor after adding the server. Cursor's editor and `cursor-agent` CLI share the same MCP configuration.

</details>

<details>
<summary>Windsurf</summary>

In Windsurf, go to `Settings` > `Tools` > `Windsurf Settings` > `Add Server`, or edit `~/.codeium/mcp_config.json` directly:

```json
{
  "mcpServers": {
    "tui-test": {
      "command": "npx",
      "args": ["-y", "tui-testing-mcp"]
    }
  }
}
```

After adding the server, use Windsurf's refresh button so Cascade reloads the tool list.

</details>

<details>
<summary>VS Code (GitHub Copilot Agent Mode)</summary>

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "tui-test": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tui-testing-mcp"]
    }
  }
}
```

You can also add it from the Command Palette with `MCP: Add Server`.

</details>

<details>
<summary>Claude Desktop</summary>

```json
{
  "mcpServers": {
    "tui-test": {
      "command": "npx",
      "args": ["-y", "tui-testing-mcp"]
    }
  }
}
```

</details>

<details>
<summary>OpenCode</summary>

Add this to `opencode.json` in your project root, or to `~/.config/opencode/opencode.json` for a global install:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tui-test": {
      "type": "local",
      "command": ["npx", "-y", "tui-testing-mcp"],
      "enabled": true
    }
  }
}
```

</details>

## How to ask for it

You do not need a bundled skill just to use this MCP. After adding the server to Claude Code, Codex, Cursor, or another MCP client, ask naturally for the task you want.

Good prompt patterns:

- "Run the TUI in this repo and tell me if it starts"
- "Test the TUI layout at 100x30 and check whether the footer stays visible"
- "Launch the counter example and verify that pressing `+` increments the value"
- "Run this CLI in stream mode and check that `--help` exits successfully"
- "Discover runnable targets in this workspace and launch the right one"
- "Resize the app to 120x40 and tell me whether the sidebar wraps"

Helpful details to include when you know them:

- the command or target to run
- whether this is a line-oriented CLI (`stream`) or a full-screen TUI (`buffer`)
- the text, cursor position, or screen region you want checked
- the terminal size to test
- the success condition, for example "the command exits 0" or "the status bar shows Connected"

The agent should map requests like "test the TUI layout", "run the app and check if the command works", or "verify the menu opens after pressing down arrow" onto the MCP tools below. A separate skill can still help with opinionated workflows, but the MCP should be usable out of the box without one.

## Testing and validation

- Use `stream` mode for line-oriented CLIs, REPL-like tools, and flows where transcript order matters more than screen position.
- Use `buffer` mode for full-screen TUIs, redraw-heavy apps, cursor-sensitive layouts, resize checks, and coordinate assertions.
- Prefer `wait_for_screen_change` and `wait_for_screen_stability` over fixed sleeps when a TUI redraws asynchronously.
- Captured buffer sessions may persist both `screen.txt` and deterministic `screen.html` artifacts for review.

For example workflows, local test commands, MCP validation lanes, and Inspector smoke checks, see [docs/TESTS.md](docs/TESTS.md).

## Example walkthroughs

Two shipped examples under `examples/` cover the two modes. Both are pure Node and self-contained.

### Stream mode: `examples/counter.js`

Line-oriented interaction, transcript assertions.

```text
launch_tui(command="node", args=["./examples/counter.js"], mode="stream")
expect_text(pattern="Counter value: 0")
send_keys(keys="+")
expect_text(pattern="Counter value: 1")
send_keys(keys="q")
close_session()
```

### Buffer mode: `examples/responsive-layout.js`

Full-screen redraw, layout-aware assertions, resize handling.

```text
launch_tui(command="node", args=["./examples/responsive-layout.js"], mode="buffer", cols=100, rows=30)
wait_for_screen_stability(stableForMs=200)
assert_contains(text="layout=wide")
resize_session(cols=40, rows=24)
wait_for_screen_change()
assert_contains(text="layout=compact")
close_session(captureArtifacts=true)
```

The first run exercises the stream-mode value prop: ordered input and text assertions. The second exercises the buffer-mode value prop: a full redraw at a known size, then a resize, then a re-assertion on the settled screen.

## Tools

All tools use `sessionId` and default it to `"default"`.

### Core flow

```text
launch_tui(command="node", args=["./examples/counter.js"], mode="buffer")
wait_for_screen_stability(stableForMs=200)
assert_contains(text="Counter value: 0")
send_keys(keys="+")
wait_for_screen_change()
close_session()
```

### `launch_tui`

This is the main entrypoint. Prefer exact `command` plus `args`. Use `target`
when the workspace has named launch targets. Use `shell: true` only when you
intentionally want shell parsing and your security policy allows it.

Use this first for requests like:

- "run the TUI"
- "open the terminal app in this repo"
- "check whether this command starts"
- "launch the counter example"
- "test the layout in a 100x30 terminal"

| Param     | Type                   | Notes                                                                   |
| --------- | ---------------------- | ----------------------------------------------------------------------- |
| `command` | `string`               | Executable to run. Use with `args`.                                     |
| `args`    | `string[]`             | Exact argv entries. Quotes are not reparsed.                            |
| `target`  | `string`               | Named target from config. Mutually exclusive with `command`.            |
| `shell`   | `boolean`              | Run `command` through the user shell. Disabled unless policy allows it. |
| `cwd`     | `string`               | Working directory. Must stay inside `workspaceRoot`.                    |
| `env`     | `Record<string,string>`| Explicit environment overrides for this session only.                   |
| `isolation` | `object`             | Session-scoped environment shaping and temporary working-directory prep. |
| `mode`    | `"stream" \| "buffer"` | Defaults to `stream`.                                                   |
| `cols`    | `number`               | Defaults to `80`.                                                       |
| `rows`    | `number`               | Defaults to `24`.                                                       |

Common patterns:

```text
launch_tui(command="node", args=["./examples/counter.js"])
launch_tui(command="npm run dev", shell=true)
launch_tui(target="counter", mode="buffer")
launch_tui(
  command="node",
  args=["runner.cjs", "hold"],
  cwd="./fixtures/destructive",
  isolation={
    "environment": {
      "allow": ["SESSION_TOKEN"],
      "set": { "SESSION_TOKEN": "alpha" }
    },
    "workingDirectory": {
      "mode": "copy",
      "copyFrom": "./fixtures/destructive",
      "retain": false
    }
  }
)
```

`isolation.environment` shapes only the launched child process:

* `inherit` defaults to `true`
* `allow` filters the final session environment down to specific keys
* `set` adds or overrides explicit key/value pairs

`isolation.workingDirectory` prepares a session-local temp directory:

* `mode: "temp"` starts in an empty temp directory under `.tui-test/sessions/`
* `mode: "copy"` copies fixture content into that temp directory before launch
* `retain: true` keeps the temp directory after close for debugging

### Tool reference

#### Session driving and waits

| Tool | What it does | Notes |
| ---- | ------------ | ----- |
| `send_keys(keys, delay?)` | Send literal input to the PTY | Supports escapes like `\n`, Ctrl syntax like `^c`, and named keys like `up`, `down`, `left`, `right` |
| `send_ctrl(key)` | Send a single Ctrl combo | Pass lowercase letters like `c`, `d`, `z` |
| `capture_screen(includeAnsi?, useBuffer?)` | Return current output | `stream` returns transcript, `buffer` returns current emulated screen |
| `expect_text(pattern, timeout?, patternMode?)` | Wait until text or regex appears | Timeout errors include a useful excerpt |
| `wait_for_screen_change(timeout?, pollIntervalMs?)` | Wait until the screen changes | Best for redraw-heavy flows where you only need forward progress |
| `wait_for_screen_stability(timeout?, stableForMs?, pollIntervalMs?)` | Wait until the screen stops changing | Prefer this over fixed sleeps before assertions |
| `assert_contains(text)` | Assert text is present right now | Does not wait |

#### Buffer-only inspection

| Tool | What it does | Notes |
| ---- | ------------ | ----- |
| `assert_at_position(text, row, col)` | Assert text at an exact coordinate | Buffer mode only |
| `get_cursor_position()` | Return cursor row and column | Buffer mode only |
| `get_screen_region(rowStart, rowEnd, colStart?, colEnd?)` | Read a rectangular screen region | Buffer mode only |
| `get_line(row)` | Read one rendered line | Buffer mode only |

#### Session management

| Tool | What it does | Notes |
| ---- | ------------ | ----- |
| `close_session(captureArtifacts=true)` | Close a session and optionally persist artifacts | Captured buffer sessions may include `screen.html` |
| `list_sessions()` | List registered sessions | Returns ids, modes, pids, dimensions, exit state |
| `resize_session(cols, rows)` | Resize PTY and buffer together | Important for TUI layout tests |

#### Target and bridge tools

| Tool | What it does | Notes |
| ---- | ------------ | ----- |
| `discover_targets(cwd?)` | Detect launch/test targets | Uses configured and auto-detected runners |
| `build_target(target, cwd?)` | Run a target's build step | For example `cargo build`, `go build`, `npm run build` |
| `run_target_tests(target, cwd?)` | Run a target's test step | For example `cargo test`, `go test`, `npm test` |
| `run_microsoft_tui_test(configFile?, cwd?, pattern?, timeout?, extraArgs?, env?)` | Bridge to Microsoft `tui-test` | Optional bridge, separate from the core PTY session tools |

`discover_targets`, `build_target`, and `run_target_tests` route through the workspace's configured or auto-detected runners.

`run_microsoft_tui_test` is an optional, opt-in bridge to Microsoft's `tui-test`, separate from the core PTY session tools: nothing in `src/core/` depends on it. `@microsoft/tui-test` is not bundled and is not declared as a dependency (or `optionalDependency`) of this server; if the target workspace does not have it installed, the tool returns a structured `missing_dependency` result instead of throwing. Projects that never call this tool pay no runtime cost.

Non-PTY command helpers cap captured `stdout` and `stderr` at 1 MB per stream, add a truncation marker, and terminate the child if it keeps writing.

When `close_session` captures artifacts, it persists a bundle under
`artifacts/tui-test/<sessionId>/<timestamp>/` inside the session workspace and
returns structured metadata with the stored file paths for:

* `metadata.json`
* `trace.json`
* `screen.txt`
* `transcript.ansi`
* `screen.html` for buffer-mode sessions only

When a session used isolation, `metadata.json` also records the isolation mode
and any retained temp-directory path.

`screen.txt` remains the machine-friendly plain-text view of the settled active
screen. `screen.html` is a deterministic rendered snapshot derived from the
buffer state for human review of redraw and resize behavior in CI artifacts or
local debugging. It is not an OS screenshot and is not written for stream-mode
sessions. Oversized rendered snapshots are replaced with a small deterministic
omission page instead of writing arbitrarily large HTML files. `trace.json`
stores a bounded rolling event history, and `input` events record metadata such
as byte length instead of raw typed payloads.

## Config

Project config lives in `tui-test.config.json` or `.tui-test.config.json`.

Use config when you want to:

- define named targets for `launch_tui(target="...")`
- set project-wide security defaults
- configure shell defaults
- set defaults for the optional Microsoft `tui-test` bridge

At a minimum, config typically defines:

- `workspaceRoot`
- `targets`
- `security`

The config is discovered by searching upward from the working directory, then
normalized so `workspaceRoot`, target `cwd`, and isolation `copyFrom` resolve
to absolute paths.

For config examples and field reference, see [docs/CONFIG.md](docs/CONFIG.md).
For security semantics and production guidance, see [docs/SECURITY.md](docs/SECURITY.md).

## Security Considerations

This tool provides **guarded execution**, not a sandbox.

- File and command execution stay scoped to the configured `workspaceRoot`
- Shell execution is explicit and separately gated from shell `-c` evaluation
- Environment inheritance is minimal by default and must be widened intentionally
- Artifacts are redacted and retention can be scoped per session subtree
- There is still no container isolation, process confinement, or network isolation

For the full security model and production recommendations, see [docs/SECURITY.md](docs/SECURITY.md).

## Architecture

* `src/server/` exposes MCP tools
* `src/core/` handles PTY sessions, terminal buffers, key parsing, and assertions
* `src/runners/` resolves language-specific build and launch behavior
* `src/config/` handles config discovery and normalization
* `src/security/` enforces workspace, command, shell, and env policy

## Design goals

* preserve the useful MCP testing surface from the Python version
* make the runtime easier to install and publish through npm
* support real TUIs across languages, not just Node apps
* keep shell execution explicit and bounded
* let agents use named targets instead of inventing commands
* keep stdout clean for stdio MCP transport

## Limitations

* Unix-like systems only for now
* no mouse input
* `buffer` mode uses more memory than `stream`
* shell mode is intentionally restricted
* some higher-level target build and test flows may still expand over time

## Development

```bash
npm install
npm run build
npm run dev
npm run lint
npm run typecheck
```

For test commands, MCP validation lanes, and Inspector smoke testing, see [docs/TESTS.md](docs/TESTS.md).

## Credits

* Original Python MCP TUI test server for the initial tool model
* PTY and terminal-emulation libraries that make the Node port possible
* Playwright for the overall mental model

## License

MIT
