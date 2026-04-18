## MODIFIED Requirements

### Requirement: Resize behavior SHALL keep PTY and buffer state aligned
The session engine SHALL update PTY state, buffer state, and exposed session metadata together when a session is resized. After a resize-triggered redraw settles, buffer-backed captures and region reads SHALL reflect only the latest active layout for the new dimensions.

#### Scenario: Buffer-backed session resize stays synchronized
- **WHEN** `resize_session` is called for a buffer-mode session
- **THEN** the PTY, terminal buffer, and reported session dimensions SHALL all reflect the new size

#### Scenario: Stream-backed session resize updates session metadata
- **WHEN** `resize_session` is called for a stream-mode session
- **THEN** the PTY and reported session dimensions SHALL reflect the new size

#### Scenario: Buffer reads reflect the settled post-resize layout
- **WHEN** a buffer-mode session redraws after a resize and the UI has reached screen stability
- **THEN** screen capture and region reads SHALL reflect the latest layout for the resized dimensions
- **AND** stale content from the pre-resize active screen SHALL not remain visible in the resized active screen

### Requirement: Engine semantics SHALL be covered by integration tests
The project SHALL include integration tests for redraw-heavy flows, resize behavior, shell launches, and failure handling so regressions in engine behavior are caught before higher-level features build on top of it. Resize coverage SHALL include representative size changes that exercise shrink, grow, and redraw recovery for buffer-mode sessions.

#### Scenario: Redraw-heavy TUI flow is captured reliably
- **WHEN** an integration test drives a full-screen TUI that redraws its output repeatedly
- **THEN** the test SHALL verify that the engine captures and asserts against the expected terminal state

#### Scenario: Shell-backed launch path is verified
- **WHEN** an integration test launches a command through `shell: true`
- **THEN** the test SHALL verify that the session launches successfully and reports expected output or expected policy errors

#### Scenario: Resize recovery is verified across representative dimensions
- **WHEN** an integration test drives a buffer-mode session through a representative set of width and height changes
- **THEN** the test SHALL verify that the settled active screen matches the latest layout after each resize
- **AND** the test SHALL verify that shrink and grow transitions do not leave stale active-screen content behind
