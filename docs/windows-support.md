# Windows Support

Date: 2026-04-18

## Status

Native Windows is now supported as an **experimental** platform for this project.

The supported slice is intentionally narrow:

- Windows 10 1809 or newer with ConPTY
- direct `command` plus `args` launches are the preferred path
- `shell: true` is supported for `cmd` only
- stream mode and buffer mode are both in scope
- buffer redraw waits, resize behavior, transcript capture, and artifact capture are covered by CI on `windows-latest`

## Not In Scope

These environments remain unsupported in this milestone:

- PowerShell / `pwsh`
- Git Bash, MSYS2, or Cygwin
- WSL2 as a documented support target
- any claim that alternate Windows shells are interchangeable with `cmd`

## Runtime Notes

### PTY behavior

- PTYs are still launched through `node-pty`
- the Windows path uses ConPTY-backed `node-pty` support
- the PTY terminal name is set conservatively to `xterm` on Windows and remains `xterm-256color` on Unix-like systems

### Shell behavior

- direct executable launches are the most reliable cross-platform path
- shell-backed launches resolve through the shell adapter registry in `src/shell/`
- the only Windows shell adapter included in the support contract is `cmd`
- `shell: true` on supported Windows resolves to `cmd /c`

### Environment and path handling

- minimal-env launches now preserve Windows-critical keys such as `Path`, `ComSpec`, `SystemRoot`, and `PATHEXT`
- workspace checks and path normalization account for drive letters, mixed separators, and case-insensitive Windows path comparisons
- command policy resolution now understands Windows executable suffixes through `PATHEXT`

## Known upstream issues

- **Node 22 + node-pty ConPTY crash.** On `windows-latest` with Node 22 and
  `node-pty@^1.1.0`, spawning a Node.js subprocess through the PTY can trigger
  an internal `ncrypto::CSPRNG` assertion inside the child's startup, killing
  the PTY before any output reaches the buffer. The Windows CI job is pinned
  to Node 20 (see `.github/workflows/ci.yml`) until the upstream interaction is
  resolved. macOS and Linux continue to run Node 22.
- **POSIX permission bits are not enforced by NTFS.** Tests that assert
  `stat.mode & 0o777 === 0o600` on persisted artifacts run only on Unix hosts;
  the equivalent check is skipped on Windows because `fs.writeFileSync` cannot
  set POSIX mode bits on NTFS.
- **ConPTY drops the initial buffer render intermittently.** Two real-PTY
  integration tests are skipped on Windows because ConPTY sometimes fails to
  deliver the child's first render, leaving the terminal buffer as whitespace
  only. `AttachConsole failed` appears in the run log when the race occurs.
  The production redraw-wait code paths (`waitForScreenChange`,
  `waitForScreenStability`) do not actually hang in this state, they just
  never see the expected initial text. Affected tests:
    - `src/core/engine.integration.test.ts` — *reconciles shrink and grow
      redraws without leaving stale active-screen layout behind*
    - `src/core/wait.integration.test.ts` — *drives a redraw-heavy TUI with
      screen-change and stability waits instead of fixed sleeps*
- **Isolated-workdir cleanup races with node-pty handle release.** On
  `windows-latest`, `fs.rmSync` on the isolated working directory after
  `SessionManager.close()` can fail with `EBUSY: resource busy or locked,
  rmdir ...` because node-pty has not fully released its handle on the child
  CWD. The production code (`cleanupIsolation` in
  `src/core/session-isolation.ts`) uses Node's built-in
  `{ maxRetries: 10, retryDelay: 100 }` linear backoff for best-effort
  retry, which is enough for most scenarios but still loses the race in
  `src/core/engine.integration.test.ts` — *cleans isolated working
  directories on close and retains them only when requested*. That test is
  skipped on Windows; the sibling `cleans isolated working directories after
  unexpected process exit` test still runs.

## Validation

The release-significant validation stack now runs on `windows-latest` in CI:

- build
- typecheck
- lint
- `npm test`
- `npm run test:mcp`

That coverage exercises:

- direct PTY launches
- redraw-heavy buffer waits (with the two known-flaky ConPTY initial-render
  tests listed above skipped on Windows)
- resize synchronization
- transcript and artifact persistence
- shell-backed launch through `cmd`
- isolated working-directory copy (the on-close cleanup assertion is
  skipped on Windows; the after-unexpected-exit cleanup path is still
  exercised)

## Recommendation

Treat Windows as usable but still narrower-risk than macOS and Linux:

- prefer direct `command` plus `args`
- use `shell: true` only when `cmd` semantics are acceptable
- avoid documenting or promising behavior for PowerShell, WSL2, or alternate shells until they have their own CI-backed change
