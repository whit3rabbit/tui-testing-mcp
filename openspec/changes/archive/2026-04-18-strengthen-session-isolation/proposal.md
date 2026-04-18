## Why

Multiple sessions can run today, but reproducibility is still weak because sessions can inherit ambient environment, work directly in the project tree, and leave behind state after failures. Stronger isolation reduces cross-test interference and makes MCP-driven terminal sessions safer to run in parallel.

## What Changes

- Add explicit per-session isolation controls for environment shaping and working-directory handling.
- Support optional temporary workspace or fixture-copy execution modes for destructive or stateful tests.
- Strengthen cleanup behavior so sessions release resources and temporary state on success and failure.
- Define how artifact and config inheritance work within isolated sessions.

## Capabilities

### New Capabilities
- `session-isolation`: Provide reproducible, session-scoped execution boundaries for MCP-driven terminal sessions.

### Modified Capabilities

None.

## Impact

- Affected code: `src/core/session.ts`, `src/server/index.ts`, config schema and loading code, security policy integration, and integration tests.
- APIs: launch behavior gains session-isolation options or config-driven defaults.
- Dependencies: no new external dependency is required.
- Systems: this change affects filesystem behavior, environment shaping, and cleanup guarantees.
