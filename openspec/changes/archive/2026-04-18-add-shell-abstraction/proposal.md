## Why

Shell-backed launches are currently handled as a narrow special case, which spreads shell behavior across the existing launch path and makes future portability work harder. A dedicated shell abstraction centralizes quoting, login semantics, and shell selection before Windows or broader shell support is considered.

## What Changes

- Introduce a shell abstraction layer separate from runner adapters and plain executable launches.
- Normalize shell-backed launch behavior for supported Unix shells and direct program execution.
- Centralize quoting and login or non-login behavior so shell differences are explicit and testable.
- Add tests for direct exec and shell-backed launch paths.

## Capabilities

### New Capabilities
- `shell-launch-abstraction`: Provide a dedicated abstraction for shell-backed command execution and shell selection.

### Modified Capabilities

None.

## Impact

- Affected code: launch resolution in `src/server/index.ts` and `src/core/session.ts`, shell handling helpers, config schema, and tests.
- APIs: shell-related launch behavior becomes more explicit and may gain a shell selector or adapter configuration.
- Dependencies: no new external dependency is required for the abstraction itself.
- Systems: this change creates the boundary that later Windows evaluation will use.
