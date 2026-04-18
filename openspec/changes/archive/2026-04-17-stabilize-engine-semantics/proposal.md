## Why

The current session engine works for basic flows, but its core semantics are still implicit and uneven across stream mode, buffer mode, resize handling, and session lifecycle transitions. Stabilizing those semantics first reduces flaky behavior and gives later changes a dependable foundation.

## What Changes

- Define explicit session lifecycle semantics for launch, readiness, exit, close, and relaunch behavior.
- Align shared capture and assertion behavior across stream and buffer modes where the API surface overlaps.
- Tighten resize and shell-launch behavior so PTY state, buffer state, and reported session metadata stay consistent.
- Expand integration coverage for redraw-heavy TUIs, resize events, shell mode, and failure cases.

## Capabilities

### New Capabilities
- `session-engine-semantics`: Define and verify the core runtime behavior of TUI sessions across modes and lifecycle transitions.

### Modified Capabilities

None.

## Impact

- Affected code: `src/core/session.ts`, `src/core/buffer.ts`, `src/core/pty.ts`, `src/server/index.ts`, and integration tests under `src/core/`.
- APIs: lifecycle-related session behavior becomes explicit and more consistent, without adding a new top-level tool.
- Dependencies: no new external dependency is required.
- Systems: this change sets the behavioral base for later artifact, wait, isolation, and shell work.
