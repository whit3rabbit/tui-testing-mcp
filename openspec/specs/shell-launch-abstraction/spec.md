# shell-launch-abstraction Specification

## Purpose
Define a dedicated abstraction for shell-backed launches so that shell-specific behavior (quoting, login mode, invocation flags) is centralized and testable rather than embedded in the generic launch path. Direct executable launches remain unchanged and continue to bypass any shell wrapping, while shell-backed launches are routed through explicit per-shell adapters with defined semantics and clear errors for unsupported shells.

## Requirements
### Requirement: Shell-backed launches SHALL use a dedicated shell abstraction
The server SHALL route shell-backed launches through a dedicated shell abstraction instead of embedding shell-specific behavior directly in the generic launch path.

#### Scenario: Direct executable launch bypasses shell abstraction
- **WHEN** a caller launches a command without shell execution
- **THEN** the server SHALL execute the program directly without shell-specific quoting or wrapping

#### Scenario: Shell-backed launch resolves a shell adapter
- **WHEN** a caller launches a command through shell execution
- **THEN** the server SHALL resolve a shell adapter for the configured or default shell before spawning the process

### Requirement: Supported shells SHALL define explicit quoting and login behavior
Each supported shell SHALL define how commands are quoted and whether they run in login or non-login mode so shell behavior is centralized and testable.

#### Scenario: Configured shell runs with defined login mode
- **WHEN** a session is launched with a supported shell and an explicit login-mode preference
- **THEN** the shell adapter SHALL construct the launch command according to that shell's documented invocation rules

#### Scenario: Unsupported shell selection fails clearly
- **WHEN** a caller selects a shell that the abstraction does not support
- **THEN** the server SHALL return a clear error instead of falling back silently

### Requirement: Shell abstraction SHALL be covered by integration tests
The project SHALL include integration tests that verify both direct executable launches and shell-backed launches through supported shell adapters.

#### Scenario: Direct executable launch remains unchanged
- **WHEN** an integration test launches a program without shell execution
- **THEN** the test SHALL verify that launch behavior matches the direct exec path

#### Scenario: Shell-backed launch is normalized through the abstraction
- **WHEN** an integration test launches a command through a supported shell adapter
- **THEN** the test SHALL verify that the command runs with the configured shell semantics and expected output
