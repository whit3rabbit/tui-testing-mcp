## Why

The repo already supports layout-aware TUI checks through the buffer model, resize synchronization, and screen-stability waits, but its persisted artifacts are still text-only. That makes resize and redraw regressions harder to review in CI because humans cannot inspect a deterministic rendered snapshot of the terminal state.

## What Changes

- Add a deterministic rendered layout artifact for buffer-mode sessions when `close_session` captures artifacts.
- Keep the existing text-first artifact bundle (`screen.txt`, `transcript.ansi`, `trace.json`, `metadata.json`) and extend the metadata contract to describe the rendered artifact when present.
- Strengthen resize-focused engine coverage so shrink, grow, and redraw flows are verified as layout regressions, not just dimension bookkeeping.
- Document the rendered snapshot as a review/debugging aid for TUI layout validation, not as an OS-level screenshot pipeline.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `session-debug-artifacts`: Captured buffer-mode sessions gain a deterministic rendered layout artifact and metadata that points to it.
- `session-engine-semantics`: Resize semantics expand from synchronization-only coverage to explicit layout-regression coverage across representative size changes.

## Impact

- Affected code: artifact capture/persistence, terminal buffer rendering helpers, PTY integration tests, and documentation.
- User-visible behavior: `close_session(captureArtifacts=true)` returns artifact metadata that may include an extra rendered snapshot file for buffer-mode sessions.
- Dependencies: no new dependency is required if the rendered snapshot can be generated from the existing xterm buffer state; otherwise the design must justify one before implementation.
