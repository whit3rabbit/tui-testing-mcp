## Why

The server already has strong PTY-centric behavior work in flight, but it does not yet have a clear validation split between "does this speak MCP correctly?" and "does this terminal-testing product behave correctly?". That gap makes it too easy to miss protocol regressions such as stdout contamination, initialize-order mistakes, or SDK interoperability drift while focusing only on product behavior tests.

## What Changes

- Add a dedicated MCP validation harness that exercises the stdio JSON-RPC contract directly, including initialize-first behavior, clean stdout transport, and error handling.
- Add an official TypeScript SDK interoperability test harness that validates `tools/list`, `tools/call`, and representative failure paths against the built server.
- Separate protocol validation from product E2E coverage in docs and CI so PTY behavior tests remain focused on waits, artifacts, isolation, and session lifecycle behavior.
- Document Inspector-based manual smoke testing now, and define a future conformance path that stays advisory until the project exposes a URL-based transport suitable for the official conformance runner.

## Capabilities

### New Capabilities
- `mcp-validation-harness`: Define the protocol-validation, interoperability, and validation-lane expectations for this MCP server.

### Modified Capabilities

None.

## Impact

- Affected code: test harnesses under `tests/` or the repo's existing integration-test layout, MCP server startup paths, and CI or test scripts in `package.json` plus repository docs.
- APIs: no user-facing MCP tool behavior is intended to change.
- Dependencies: may add official MCP development tooling such as the SDK client or Inspector helpers if the current dependency set is insufficient.
- Systems: CI will gain an explicit MCP protocol lane separate from the existing product behavior tests.
