## Context

The project's core value is an MCP server that drives terminal programs directly. Microsoft’s `@microsoft/tui-test` is a separate test framework with its own execution model. A bridge only makes sense if it stays optional, returns results in MCP-friendly form, and does not leak the runner model into the rest of the server.

## Goals / Non-Goals

**Goals:**
- Provide an explicit opt-in path for invoking Microsoft TUI Test workflows.
- Translate bridge results into structured MCP-friendly output.
- Keep the core PTY-driven product model intact.

**Non-Goals:**
- Replace the session engine with Microsoft TUI Test.
- Make `@microsoft/tui-test` a required runtime dependency of the server.
- Mirror every upstream feature in the bridge surface.

## Decisions

### Keep the bridge in a separate module and tool path
The bridge should live behind dedicated server wiring so projects that do not use it pay minimal complexity cost. Core session code should not depend on Microsoft-specific runtime concepts.

Alternative considered:
- Fold the bridge into existing launch and assertion tools. Rejected because it would blur two different execution models and complicate error handling.

### Treat Microsoft TUI Test as an optional external integration
The bridge should resolve and invoke the external framework only when explicitly requested. If the dependency is missing or the project is incompatible, the failure should be isolated to the bridge path.

Alternative considered:
- Add `@microsoft/tui-test` as a core dependency. Rejected because the product is not fundamentally that framework.

### Return translated results instead of raw process output only
Bridge results should be normalized into a structured response that can include status, summary, and artifact references. This gives MCP clients something stable to consume.

Alternative considered:
- Stream raw CLI output from the bridge command only. Rejected because it gives up the structured value of the MCP layer.

## Risks / Trade-offs

- [The bridge may drift from upstream framework behavior] → Keep the bridge surface narrow and tied to stable execution outcomes.
- [Optional dependency handling can be messy] → Fail early and clearly when bridge prerequisites are missing.
- [Users may treat the bridge as the new default path] → Keep docs explicit that the bridge is complementary and opt-in.

## Migration Plan

This is additive and optional. Projects that do not use the bridge should see no behavior change.

## Resolved Questions

### First implementation uses CLI invocation
The bridge spawns `@microsoft/tui-test`'s CLI entry via Node. The CLI exit code and artifact layout are the closest thing upstream offers to a stable public contract; internal JS modules are not versioned for external consumers and would couple us to framework internals.

Tradeoff: the bridge cannot consume structured results from the runner directly. It scrapes stdout for counts and walks known artifact directories. Summary parsing is best-effort and may be null when the format drifts; the exit code is authoritative. A programmatic adapter may be introduced later if upstream exposes a stable API, without changing the MCP tool surface.

### Minimum result schema
`status` (success/failure/error), `exitCode`, `summary` (passed/failed/skipped/total, nullable), `artifacts` (trace and snapshot file paths from known output directories), `stdout`, `stderr`, `durationMs`, and, on error, a `{ kind, message }` pair where `kind` ∈ { missing_dependency, incompatible_project, execution_failed }. This is enough for MCP clients to distinguish "tests ran and failed" from "bridge could not run" and to surface traces without overfitting to the runner's internals.
