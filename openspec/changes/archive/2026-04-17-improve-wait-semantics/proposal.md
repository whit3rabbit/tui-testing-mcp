## Why

The current wait behavior is mostly a simple polling loop around text presence, which forces clients to compensate with arbitrary sleeps and makes failures harder to interpret. Smarter wait semantics reduce flakiness and make the MCP tools easier to use for redraw-heavy terminal flows.

## What Changes

- Expand wait behavior beyond naive text polling to support readiness around text visibility, regex matching, screen change, and screen stability.
- Make wait behavior consistent across stream and buffer modes where the concepts overlap.
- Improve timeout diagnostics so wait failures explain what was observed and why the wait failed.
- Add tests that cover stable and unstable terminal render flows.

## Capabilities

### New Capabilities
- `session-wait-semantics`: Provide deterministic and diagnosable waiting behavior for MCP-driven terminal sessions.

### Modified Capabilities

None.

## Impact

- Affected code: `src/core/assertions.ts`, `src/core/session.ts`, `src/server/index.ts`, and integration tests.
- APIs: waiting behavior becomes richer while keeping the core wait and assertion tool surface MCP-friendly.
- Dependencies: no new external dependency is required.
- Systems: this change builds on stabilized engine semantics and can later feed trace artifacts with richer wait events.
