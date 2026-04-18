## ADDED Requirements

### Requirement: Session lifecycle states SHALL be explicit and deterministic
The session engine SHALL define deterministic behavior for the transitions between launched, ready, exited, closed, and relaunched session states so that callers and follow-on features can rely on consistent runtime semantics.

#### Scenario: Relaunch replaces an existing session cleanly
- **WHEN** `launch_tui` is called with a `sessionId` that already exists
- **THEN** the existing session SHALL be closed before the replacement session is created

#### Scenario: Closed sessions reject further interaction
- **WHEN** a caller invokes input, capture, resize, or assertion behavior for a closed or missing session
- **THEN** the server SHALL return a clear error instead of acting on stale state

### Requirement: Shared capture behavior SHALL be consistent across modes
For behaviors exposed in both stream and buffer modes, the session engine SHALL provide consistent semantics for screen capture, session metadata, and failure handling while preserving each mode's intentional differences.

#### Scenario: Capture reports current output for both modes
- **WHEN** a caller captures the screen of an active session in either stream mode or buffer mode
- **THEN** the returned output SHALL represent the current terminal state for that mode

#### Scenario: Session metadata reflects active dimensions
- **WHEN** a session is launched or resized
- **THEN** the reported session metadata SHALL match the PTY dimensions and, when present, the buffer dimensions

### Requirement: Resize behavior SHALL keep PTY and buffer state aligned
The session engine SHALL update PTY state, buffer state, and exposed session metadata together when a session is resized.

#### Scenario: Buffer-backed session resize stays synchronized
- **WHEN** `resize_session` is called for a buffer-mode session
- **THEN** the PTY, terminal buffer, and reported session dimensions SHALL all reflect the new size

#### Scenario: Stream-backed session resize updates session metadata
- **WHEN** `resize_session` is called for a stream-mode session
- **THEN** the PTY and reported session dimensions SHALL reflect the new size

### Requirement: Engine semantics SHALL be covered by integration tests
The project SHALL include integration tests for redraw-heavy flows, resize behavior, shell launches, and failure handling so regressions in engine behavior are caught before higher-level features build on top of it.

#### Scenario: Redraw-heavy TUI flow is captured reliably
- **WHEN** an integration test drives a full-screen TUI that redraws its output repeatedly
- **THEN** the test SHALL verify that the engine captures and asserts against the expected terminal state

#### Scenario: Shell-backed launch path is verified
- **WHEN** an integration test launches a command through `shell: true`
- **THEN** the test SHALL verify that the session launches successfully and reports expected output or expected policy errors
