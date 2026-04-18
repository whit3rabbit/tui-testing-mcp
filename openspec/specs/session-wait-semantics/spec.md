# session-wait-semantics Specification

## Purpose
Provide deterministic and diagnosable waiting behavior for MCP-driven terminal sessions. Wait primitives SHALL cover literal text, regular expressions, screen changes, and screen stability so redraw-heavy TUIs can be driven without arbitrary client-side sleeps, and wait failures SHALL return actionable diagnostics that explain what condition was attempted and what the session was showing at timeout.

## Requirements
### Requirement: Wait operations SHALL support text and regular-expression matching
The session wait behavior SHALL support both literal text and regular-expression matching so callers can wait for dynamic terminal output without reimplementing polling logic themselves.

#### Scenario: Wait for literal text succeeds
- **WHEN** a caller waits for literal text that appears in the session output before timeout
- **THEN** the wait SHALL succeed without requiring additional client-side sleeps

#### Scenario: Wait for regular expression succeeds
- **WHEN** a caller waits for a regular expression that matches dynamic session output before timeout
- **THEN** the wait SHALL succeed and report the matched content

### Requirement: Wait operations SHALL support screen-change and screen-stability semantics
The session wait behavior SHALL provide primitives for waiting until the screen changes and until the screen settles so redraw-heavy TUIs can be tested without arbitrary sleep values.

#### Scenario: Wait for screen change observes a redraw
- **WHEN** the session output changes after a wait begins
- **THEN** the screen-change wait SHALL succeed once new output is observed

#### Scenario: Wait for screen stability detects settling
- **WHEN** the session output stops changing for the configured stability interval before timeout
- **THEN** the screen-stability wait SHALL succeed

### Requirement: Wait timeouts SHALL include actionable diagnostics
When a wait operation times out, the server SHALL return diagnostics that include the wait condition, timeout, and relevant output context from the session.

#### Scenario: Text wait timeout includes recent output
- **WHEN** a text or regex wait times out
- **THEN** the failure SHALL include the attempted condition, timeout, and a recent output excerpt

#### Scenario: Stability wait timeout includes observed change state
- **WHEN** a screen-stability wait times out because the screen keeps changing or never reaches the stability interval
- **THEN** the failure SHALL explain that the screen did not settle within the timeout

### Requirement: Wait semantics SHALL be covered by integration tests
The project SHALL include integration tests that verify successful waits and timeout diagnostics for redraw-heavy and slowly updating terminal sessions.

#### Scenario: Redraw-heavy flow passes without arbitrary sleeps
- **WHEN** an integration test exercises a session that redraws multiple times before reaching a stable state
- **THEN** the test SHALL use the wait semantics to complete without fixed sleeps

#### Scenario: Timeout diagnostics are verified in tests
- **WHEN** an integration test triggers a wait timeout
- **THEN** the test SHALL verify that the returned diagnostics describe the failed wait condition and current output context
