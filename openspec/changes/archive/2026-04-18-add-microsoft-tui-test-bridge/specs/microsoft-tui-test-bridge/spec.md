## ADDED Requirements

### Requirement: The Microsoft bridge SHALL be opt-in
The server SHALL expose Microsoft TUI Test bridge behavior only when the project explicitly configures or invokes the bridge, and the core PTY session tools SHALL remain available independently.

#### Scenario: Core PTY tools remain usable without the bridge
- **WHEN** a caller uses existing PTY-driven MCP tools in a project that does not configure the bridge
- **THEN** the server SHALL continue to operate without requiring `@microsoft/tui-test`

#### Scenario: Bridge execution requires explicit opt-in
- **WHEN** a caller requests bridge execution
- **THEN** the server SHALL require explicit bridge configuration or a bridge-specific invocation path

### Requirement: Bridge execution SHALL return structured results
When the bridge runs a Microsoft TUI Test workflow, the server SHALL return structured execution results that include success or failure, summary output, and trace or snapshot artifact locations when available.

#### Scenario: Successful bridge run returns artifacts
- **WHEN** the bridge runs a compatible Microsoft TUI Test workflow successfully
- **THEN** the server SHALL return a structured result with run status and any available trace or snapshot artifact references

#### Scenario: Failed bridge run returns failure summary
- **WHEN** the bridge run fails
- **THEN** the server SHALL return a structured failure result with diagnostic summary information and any available artifact references

### Requirement: Bridge failures SHALL be explicit and non-destructive
If the bridge is unavailable because configuration is missing, dependencies are not installed, or the project is incompatible, the server SHALL fail clearly without breaking core MCP functionality.

#### Scenario: Missing dependency fails clearly
- **WHEN** a caller invokes the bridge but `@microsoft/tui-test` is not installed or cannot be resolved
- **THEN** the server SHALL return a clear error explaining that the optional bridge dependency is unavailable

#### Scenario: Incompatible project fails without affecting core tools
- **WHEN** a caller invokes the bridge in a project that does not expose the expected Microsoft TUI Test workflow
- **THEN** the server SHALL return a clear compatibility error and existing PTY tools SHALL remain usable
