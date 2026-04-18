## Why

Some users may eventually want to run native `@microsoft/tui-test` suites or reuse its traces and snapshots without giving up the MCP server's ad hoc PTY tools. An optional bridge can make the two systems complementary, but only if it stays opt-in and does not redefine the product around Microsoft’s runner model.

## What Changes

- Add an optional MCP-facing bridge that can invoke `@microsoft/tui-test` when a project explicitly opts into it.
- Return structured execution results, trace or snapshot locations, and failure summaries through MCP.
- Preserve the existing PTY session tools as the primary interaction model.
- Fail clearly when the bridge is not configured, the dependency is missing, or the target project is incompatible.

## Capabilities

### New Capabilities
- `microsoft-tui-test-bridge`: Provide an opt-in MCP integration path for running native `@microsoft/tui-test` workflows.

### Modified Capabilities

None.

## Impact

- Affected code: new bridge module, MCP server tool registration, result translation, configuration schema, and tests.
- APIs: one or more bridge-specific MCP tools or tool modes may be added.
- Dependencies: the bridge may rely on an optional project dependency on `@microsoft/tui-test`, but the core server should not require it.
- Systems: bridge execution must coexist with the existing PTY-driven workflow rather than replacing it.
