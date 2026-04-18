# Windows Support Evaluation

Date: 2026-04-17

## Decision

Native Windows remains unsupported for this project.

This change does not authorize implementation work for Windows support. It records why support is deferred and what has to be true before that decision should be revisited.

## Why This Is The Decision

Upstream feasibility exists, but this repo is not ready to claim Windows support responsibly.

- `node-pty` does support Windows through ConPTY on Windows 10 1809 and later, which means the dependency is not the main blocker by itself.
- Shell-backed launches now go through an adapter registry in `src/shell/` (`sh`, `bash`, `zsh`, `fish`, `cmd`) resolved via `resolveShell(...)` in `src/core/session-launch.ts`. A `cmd.exe` adapter is wired, but it has never been validated against a real Windows runner.
- The shell abstraction change that centralized shell selection, quoting, login semantics, and failure modes is archived complete in `openspec/changes/archive/2026-04-18-add-shell-abstraction/`. The remaining Windows blocker is validation: the `cmd.exe` adapter has no Windows CI coverage, and ConPTY-backed PTY, buffer, resize, and artifact behavior is not exercised by any test.
- The CI workflow validates macOS and Linux today. There is no Windows build or PTY integration coverage in `.github/workflows/ci.yml`.
- Buffer-mode behavior, resize semantics, transcript capture, and artifact persistence are only exercised on the current Unix-oriented test path. They have not been validated against ConPTY-backed output in this repo.

That combination makes an "experimental" label misleading. The project can evaluate Windows later, but it cannot promise stable or even credible partial support today.

## Assessment

### PTY behavior

- The project launches PTYs through `node-pty` in `src/core/pty.ts`.
- The wrapper sets a fixed terminal name of `xterm-256color`, which is reasonable for Unix-oriented terminals but unverified here against Windows terminal stacks and ConPTY behavior.
- The current implementation does not add Windows-specific launch handling or ConPTY-specific validation. That is acceptable only while Windows remains unsupported.

### Shell behavior

- Direct executable launches (`command` plus `args`) are the safest path for future cross-platform support.
- Shell-backed launches are centralized behind `src/shell/` adapters. Unix shells (`sh`, `bash`, `zsh`, `fish`) are validated by the existing integration tests. The `cmd.exe` adapter ships but has not been exercised on a real Windows runner, so it is effectively unvalidated.
- The centralization work landed via `openspec/changes/archive/2026-04-18-add-shell-abstraction/`. What is left for Windows is validation, a supported Windows shell matrix decision (e.g. whether to add PowerShell / `pwsh`), and real runner coverage.

### Terminal control sequences and snapshot stability

- Buffer mode depends on `@xterm/headless` to interpret PTY output and produce screen-aware assertions.
- The current tests prove redraw-heavy behavior on the existing path, but they do not prove equivalent stability for Windows-native shells or ConPTY output.
- Until the repo runs the buffer and wait integration suite on Windows, snapshot stability on Windows is an unverified assumption.

### CI and ongoing validation

- GitHub Actions does provide Windows-hosted runners, so Windows validation is operationally available.
- This project does not use them yet. The current CI workflow runs only one macOS job.
- Without Windows CI, any Windows claim would regress silently because PTY, shell, and terminal behavior can change across Node, `node-pty`, and runner-image updates.

## Scope

### Supported now

- macOS
- Linux

### Unsupported now

- Native Windows
- PowerShell / `pwsh`
- `cmd.exe`
- Git Bash, MSYS2, or Cygwin as supported environments
- Any implied guarantee that Windows CI is part of the release gate

### Not evaluated enough to support

- WSL2 as a supported environment

WSL2 may be a useful future experiment because it presents a Linux userland, but this change does not verify or support it.

## Prerequisites Before Reconsidering Windows

1. Validate the shipped `cmd.exe` adapter against a real Windows runner and decide whether the supported Windows shell matrix should also include PowerShell / `pwsh`. The underlying shell abstraction already ships Bourne, bash, zsh, fish, and cmd adapters.
2. Add Windows CI that runs build, typecheck, and PTY integration coverage, not just unit tests.
3. Validate buffer-mode redraw handling, resize behavior, wait semantics, and artifact capture on Windows runners.
4. Review isolation and workspace behavior for Windows path semantics, drive letters, and environment filtering edge cases.
5. Decide whether the first support target is native Windows only, WSL2 only, or a narrower experimental slice with a single shell.

## Risks If The Project Skips Those Prerequisites

- Shell-backed launches will fail or behave inconsistently across shells.
- Screen assertions may be flaky because terminal control-sequence handling has not been proven on the Windows path.
- CI will not catch regressions in `node-pty`, GitHub runner images, or Node upgrades.
- Documentation will overpromise relative to the current code.

## Recommendation

Keep Windows unsupported until Windows CI proves the existing PTY and buffer contract on a real Windows runner, and the shipped `cmd.exe` adapter is exercised end to end there.

At that point, the first credible next step would be a narrowly scoped experimental support decision with one validated shell and explicit limitations. This repo is not at that point yet.

## External References

- [`node-pty` README](https://github.com/microsoft/node-pty)
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
