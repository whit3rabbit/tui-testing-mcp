## MODIFIED Requirements

### Requirement: Session artifact bundles SHALL be persisted for captured sessions
When a caller requests artifact capture for a session, the server SHALL persist a structured artifact bundle that includes terminal transcript, rendered screen output, and session metadata in a deterministic on-disk layout. Buffer-mode sessions SHALL also persist a deterministic rendered layout snapshot that is suitable for human review of terminal structure after redraws and resizes.

#### Scenario: Close session with artifact capture enabled
- **WHEN** `close_session` is called with `captureArtifacts` enabled for an existing session
- **THEN** the server stores the session transcript, current screen, and metadata in a newly created artifact bundle
- **AND** buffer-mode sessions also store a rendered layout snapshot derived from the active terminal buffer

#### Scenario: Artifact metadata identifies the stored files
- **WHEN** a session artifact bundle is created
- **THEN** the bundle metadata SHALL include the session identifier, capture timestamp, exit code, mode, dimensions, and file paths for the stored artifacts
- **AND** the metadata SHALL identify the rendered layout snapshot path and format when one is written

### Requirement: Artifact capture SHALL be covered by integration tests
The project SHALL include integration tests that verify artifact capture and trace persistence for both successful and failing terminal sessions. Buffer-mode artifact tests SHALL also verify that the rendered layout snapshot is written and references the same settled terminal state as the plain-text screen artifact.

#### Scenario: Successful session produces persisted artifacts
- **WHEN** an integration test drives a terminal session to normal completion with artifact capture enabled
- **THEN** the test SHALL verify that the artifact bundle and trace files were written and contain the expected session data

#### Scenario: Failing assertion produces persisted diagnostics
- **WHEN** an integration test triggers an `expect_text` timeout for a session with artifact capture enabled
- **THEN** the test SHALL verify that the returned error includes diagnostic context and that the artifact bundle contains the failure trace data

#### Scenario: Buffer-mode capture writes a rendered layout snapshot
- **WHEN** an integration test closes a buffer-mode session with artifact capture enabled after the screen has settled
- **THEN** the test SHALL verify that the artifact bundle contains a rendered layout snapshot
- **AND** the metadata SHALL point to that snapshot
