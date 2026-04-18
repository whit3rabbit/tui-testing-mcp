# session-isolation Specification

## Purpose
TBD - created by archiving change strengthen-session-isolation. Update Purpose after archive.
## Requirements
### Requirement: Sessions SHALL support scoped environment configuration
The server SHALL support session-scoped environment configuration so one session can override or limit environment variables without mutating the process-wide environment used by other sessions.

#### Scenario: Session-specific environment values are applied
- **WHEN** a session is launched with explicit environment overrides
- **THEN** the spawned process SHALL receive those values without changing other active sessions

#### Scenario: Session environment allowlists are enforced
- **WHEN** a session is launched with restricted environment inheritance
- **THEN** only allowed environment variables SHALL be passed to the spawned process

### Requirement: Sessions SHALL support isolated working-directory execution
The server SHALL support running a session in an isolated working directory, including an optional temporary copy of fixture content for tests that mutate local files.

#### Scenario: Session launches in a temporary working directory
- **WHEN** a caller requests isolated working-directory execution
- **THEN** the session SHALL run in a temporary directory prepared for that session

#### Scenario: Fixture content is copied for destructive tests
- **WHEN** a caller requests a fixture-copy execution mode
- **THEN** the configured fixture content SHALL be copied into the isolated working directory before launch

### Requirement: Session cleanup SHALL remove isolated state
The server SHALL clean up isolated working directories and other temporary session-scoped state when a session closes or fails.

#### Scenario: Normal close removes temporary state
- **WHEN** an isolated session closes successfully
- **THEN** the server SHALL remove the session's temporary working directory unless configured otherwise for debugging

#### Scenario: Failure path still triggers cleanup
- **WHEN** an isolated session exits unexpectedly or an operation fails
- **THEN** the server SHALL still attempt to remove the session's temporary working directory and release session resources

### Requirement: Isolation behavior SHALL be covered by integration tests
The project SHALL include integration tests that verify environment isolation, isolated working-directory behavior, and cleanup after success and failure.

#### Scenario: Parallel sessions do not leak environment state
- **WHEN** integration tests launch parallel sessions with different environment overrides
- **THEN** each session SHALL observe only its own configured values

#### Scenario: Temporary working directories are cleaned up
- **WHEN** an integration test launches an isolated session and then closes it
- **THEN** the test SHALL verify that the temporary working directory is removed or retained only when explicitly configured

