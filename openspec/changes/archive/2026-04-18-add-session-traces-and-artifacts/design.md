## Context

The current server keeps session state in memory and only returns a minimal artifact object on `close_session`. `Session` already centralizes PTY lifecycle and screen capture, which makes it the right place to accumulate traceable events, while `src/artifacts.ts` is the existing boundary for turning session state into a durable artifact. The change needs to improve debugging without changing the product model, which remains an MCP server with low-level launch, input, capture, and assertion tools.

## Goals / Non-Goals

**Goals:**
- Persist artifact bundles to disk in a deterministic layout instead of returning only transient JSON.
- Record per-session trace events for the operations that matter during debugging.
- Improve `expect_text` timeout messages with current output context.
- Add integration tests that verify artifact persistence on success and failure.

**Non-Goals:**
- Introduce a new high-level `test` runner API.
- Add Windows support or shell abstraction work.
- Add replay tooling beyond saving trace and snapshot data.
- Change security policy behavior outside what is needed to write artifacts within the workspace.

## Decisions

### Persist artifacts under a workspace-local artifact root
Artifacts should be written under a deterministic workspace-local directory such as `artifacts/tui-test/<sessionId>/<timestamp>/`. This keeps output easy to inspect, avoids extra dependencies, and matches the repo's current local-first workflow.

Alternative considered:
- Returning only JSON from `close_session`. Rejected because it does not preserve enough state for flaky or post-mortem debugging.

### Extend `Session` with structured trace event recording
`Session` should own an in-memory trace array because it already receives PTY data, mediates buffer capture, and exposes lifecycle operations like write and resize. Server tool handlers can append higher-level events such as assertions, while `src/artifacts.ts` serializes the final trace bundle.

Alternative considered:
- Logging trace events only in server handlers. Rejected because low-level PTY lifecycle and resize events would become fragmented across modules.

### Keep artifact persistence separate from assertion logic
`src/core/assertions.ts` should stay focused on evaluating output and producing structured failure context, while artifact persistence remains in `src/artifacts.ts`. Assertions can return richer diagnostic fields that the server and artifact layer both consume.

Alternative considered:
- Having assertion helpers write files directly. Rejected because it would mix decision logic, persistence, and output formatting in the same module.

### Make failure diagnostics mode-aware but API-compatible
`expect_text` should keep the same tool shape, but its failure response should include timeout, pattern, and a short excerpt from either stream output or rendered buffer content. This improves usability without breaking the MCP tool contract.

Alternative considered:
- Adding a separate debug-only assertion tool. Rejected because it splits behavior that should be the default for all callers.

## Risks / Trade-offs

- [Artifact directories can grow quickly] → Start with plain-text artifacts and a simple layout, then add retention policy controls later if usage proves heavy.
- [Trace capture may add memory overhead for long-running sessions] → Record concise structured events and keep large PTY output in transcript files rather than duplicating it in every trace event.
- [Tests may become flaky if they assert exact timestamps or file ordering] → Assert file existence and key fields, not full serialized blobs.
- [Workspace-relative artifact writes can conflict with security checks] → Resolve the artifact root inside the configured workspace and verify it through the existing security manager.

## Migration Plan

This is an additive change. Existing callers can continue using `close_session` and `expect_text` without sending new arguments. Rollback is straightforward: revert the new artifact persistence and trace recording paths, which restores the current in-memory-only artifact behavior.

## Open Questions

- Should the artifact root be configurable in project config now, or should the first version use a fixed workspace-local path?
- Should PTY output chunks be represented in the trace as summarized events only, or should the trace reference transcript offsets for large output segments?
