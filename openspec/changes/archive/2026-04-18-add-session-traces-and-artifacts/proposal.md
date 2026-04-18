## Why

The server can drive TUIs today, but failures are hard to debug because artifact capture is minimal and assertion timeouts provide little context. This change adds durable session traces and richer failure artifacts now, before the engine grows more features and flakiness becomes harder to diagnose.

## What Changes

- Add structured per-session debug artifacts that persist transcript, screen, metadata, and trace events in a stable layout.
- Extend session lifecycle handling so launch, input, resize, assertion, exit, and close operations can be recorded as trace events.
- Improve `expect_text` failure output so timeouts include actionable context instead of only reporting that a pattern was not found.
- Add integration coverage for artifact capture on successful and failing sessions.

## Capabilities

### New Capabilities
- `session-debug-artifacts`: Persist structured session traces and failure artifacts for MCP-driven TUI test sessions.

### Modified Capabilities

None.

## Impact

- Affected code: `src/core/session.ts`, `src/core/assertions.ts`, `src/artifacts.ts`, `src/server/index.ts`, and integration tests under `src/core/`.
- APIs: `close_session` artifact output becomes more structured, and assertion failures return richer messages.
- Dependencies: no new external dependency is required for this change.
- Systems: local artifact storage layout will be introduced under the project workspace.
