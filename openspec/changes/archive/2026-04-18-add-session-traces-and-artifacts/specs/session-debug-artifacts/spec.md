## ADDED Requirements

### Requirement: Session artifact bundles SHALL be persisted for captured sessions
When a caller requests artifact capture for a session, the server SHALL persist a structured artifact bundle that includes terminal transcript, rendered screen output, and session metadata in a deterministic on-disk layout.

#### Scenario: Close session with artifact capture enabled
- **WHEN** `close_session` is called with `captureArtifacts` enabled for an existing session
- **THEN** the server stores the session transcript, current screen, and metadata in a newly created artifact bundle

#### Scenario: Artifact metadata identifies the stored files
- **WHEN** a session artifact bundle is created
- **THEN** the bundle metadata SHALL include the session identifier, capture timestamp, exit code, mode, dimensions, and file paths for the stored artifacts

### Requirement: Session lifecycle events SHALL be recorded as a trace
The server SHALL record a trace for each artifact-enabled session that captures launch configuration, input events, resize events, assertion attempts, process exit, and session close.

#### Scenario: Trace includes launch and input events
- **WHEN** a session is launched, receives input, and is later closed with artifact capture enabled
- **THEN** the persisted trace SHALL contain ordered events for launch, input, and close with event-specific metadata

#### Scenario: Trace includes assertion outcomes
- **WHEN** an assertion or wait operation runs against a session with artifact capture enabled
- **THEN** the persisted trace SHALL record the assertion type, searched pattern or text, timeout, and whether the assertion succeeded or failed

### Requirement: Assertion timeouts SHALL return actionable diagnostics
When `expect_text` times out, the server SHALL return a failure message that includes useful context from the latest captured output instead of only the missing pattern.

#### Scenario: Stream mode timeout includes current output context
- **WHEN** `expect_text` times out for a stream-mode session
- **THEN** the error message SHALL include the searched pattern, timeout, and a recent excerpt of the session output

#### Scenario: Buffer mode timeout includes rendered screen context
- **WHEN** `expect_text` times out for a buffer-mode session
- **THEN** the error message SHALL include the searched pattern, timeout, and a rendered screen excerpt from the terminal buffer

### Requirement: Artifact capture SHALL be covered by integration tests
The project SHALL include integration tests that verify artifact capture and trace persistence for both successful and failing terminal sessions.

#### Scenario: Successful session produces persisted artifacts
- **WHEN** an integration test drives a terminal session to normal completion with artifact capture enabled
- **THEN** the test SHALL verify that the artifact bundle and trace files were written and contain the expected session data

#### Scenario: Failing assertion produces persisted diagnostics
- **WHEN** an integration test triggers an `expect_text` timeout for a session with artifact capture enabled
- **THEN** the test SHALL verify that the returned error includes diagnostic context and that the artifact bundle contains the failure trace data
