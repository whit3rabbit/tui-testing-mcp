# Security Model

This document describes the security model of tui-testing-mcp, an MCP server for driving terminal programs.

## Important Disclaimer

**tui-testing-mcp provides guarded execution, not a sandbox.** It does not provide container-level isolation, process confinement, or VM-level security. For untrusted callers, additional external sandboxing (Docker, gVisor) is required.

## Security Features

### Workspace Isolation

All operations are scoped to within the configured `workspaceRoot`. This includes:
- File paths referenced in config
- Working directories for spawned processes
- Artifact storage locations

The workspace check uses `path.relative` to ensure no `..` traversal escapes the root.

### Command Policy

Commands can be restricted via:
- `allowedCommands` — allowlist of permitted executables
- `deniedCommands` — denylist of blocked executables

Rules without a path separator (`/`, `\`) are matched against the basename of the resolved executable path. This means a rule `"bash"` catches `/bin/bash`, `/usr/bin/bash`, and symlinked aliases.

Rules with a path separator use `realpath` resolution for exact matching.

### Argv Validation

High-risk commands have additional argv validation that blocks dangerous flag combinations:

| Command | Blocked Flags |
|---------|---------------|
| node, deno | `-e`, `--eval`, `--check` |
| python, python3 | `-c`, `--command`, `-m` |
| git | `--upload-pack`, `--receive-pack`, `-c` with `.git` |
| bash, sh, zsh | `-c` |
| npm | `exec`, `run-script`, `--script` |
| cargo, go | `run`, `test`, `build` |

This prevents allowed commands like `python` from being used to execute arbitrary code via `-c`.
The same guard also rejects execution-modifying env overrides for risky tools,
such as `NODE_OPTIONS`, `PYTHONSTARTUP`, `BASH_ENV`, and injected `GIT_CONFIG_*`
entries, when an active command policy is present.

### Shell Gating

Two separate flags control shell behavior:

1. `allowShell` — permits resolving a shell binary for shell-backed launches
2. `allowShellEval` — permits `shell: true` to forward arbitrary command strings through the resolved shell adapter (`-c`, `/c`, and similar)

`allowShellEval` requires `allowShell` to also be true. This separation allows policy to permit a shell binary for adapter/tools that need it without granting universal command execution.

### Environment Shaping

By default, only a minimal safe env allowlist is passed to child processes.
On Unix-like systems this includes:
- `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_*`, `TMPDIR`, `TMP`, `TEMP`

On Windows this includes:
- `Path`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `USERNAME`, `ComSpec`, `SystemRoot`, `PATHEXT`, `TERM`, `LANG`, `LC_*`, `TMP`, `TEMP`

Full parent environment inheritance requires explicit opt-in via `security.inheritEnv: true` or `isolation.environment.inherit: true`.

### Artifact Redaction

Transcripts and screen captures are scanned for obvious secret patterns:
- Token shapes: `sk-*`, `AKIA*`, `Bearer <…>`, `ghp_*`, `gho_*`
- Key-value secrets: `password=…`, `secret=…`, `token=…`, `api_key=…`

Custom patterns can be added via `security.artifactRedactions`. Invalid
patterns fail validation and reject the configuration instead of being ignored.

Trace artifacts keep a bounded rolling history. Input trace events store
metadata such as length and control-character presence, not the raw typed
payload. Oversized rendered `screen.html` snapshots are replaced with a small
omission page instead of writing arbitrarily large HTML artifacts.

## Limitations

- **No process confinement** — spawned processes run with the same user privileges as the MCP server
- **No container isolation** — no namespace or cgroup isolation
- **No network isolation** — spawned processes can make network requests
- **No OS-level resource limits** — there are bounded in-process transcript,
  trace, and command-output buffers, but no CPU quotas, cgroups, or file size
  limits

## Recommendations for Production

1. **For untrusted callers**: Run the MCP server in an isolated environment (container, VM)
2. **Command policy**: Use allowlists rather than denylists for high-risk interpreters
3. **Environment**: Keep `inheritEnv: false` (the default) and explicitly add needed vars
4. **Shell eval**: Avoid enabling `allowShellEval` for untrusted callers
5. **Monitoring**: Review artifacts for potential secret leakage before exposing to other systems
