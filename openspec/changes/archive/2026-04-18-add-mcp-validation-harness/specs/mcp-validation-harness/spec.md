## ADDED Requirements

### Requirement: The project SHALL provide raw stdio protocol validation
The project SHALL include automated validation that talks to the built stdio server over raw newline-delimited JSON-RPC so wire-level lifecycle and transport failures are caught independently from higher-level client abstractions.

#### Scenario: Initialize is required before normal tool interaction
- **WHEN** the raw stdio validation harness starts the server and sends protocol messages
- **THEN** the harness SHALL verify that initialization occurs before normal MCP tool interaction and that invalid lifecycle ordering fails clearly

#### Scenario: Stdout remains reserved for protocol traffic
- **WHEN** the validation harness exercises the server while logs or diagnostics are emitted
- **THEN** it SHALL verify that protocol messages stay on `stdout` and diagnostics stay off the protocol stream

### Requirement: The project SHALL provide official SDK interoperability coverage
The project SHALL include automated coverage that connects to the stdio server through the official TypeScript MCP client and validates tool discovery, successful tool calls, and representative error paths.

#### Scenario: SDK client can initialize and list tools
- **WHEN** the interoperability harness connects to the built stdio server through the official SDK client
- **THEN** it SHALL complete initialization successfully and retrieve the advertised tool list

#### Scenario: SDK client observes structured failures
- **WHEN** the interoperability harness calls a tool with invalid arguments or against an invalid session state
- **THEN** it SHALL observe a structured MCP error instead of a transport failure or ambiguous process crash

### Requirement: Protocol validation and product E2E coverage SHALL remain separate
The project SHALL maintain a distinct protocol-validation lane and a distinct product-behavior lane so MCP regressions and PTY-behavior regressions can be diagnosed independently.

#### Scenario: Protocol failures are isolated from PTY behavior failures
- **WHEN** automated validation runs in CI or locally
- **THEN** the raw stdio and SDK interoperability suites SHALL run as MCP validation checks separate from the PTY behavior integration suites

#### Scenario: Product E2E continues to cover PTY behavior
- **WHEN** the product-behavior lane runs
- **THEN** it SHALL continue to exercise waits, redraw-heavy behavior, artifacts, isolation, and session lifecycle scenarios using the existing behavioral test approach

### Requirement: The project SHALL document its MCP validation workflow
The project SHALL document how contributors manually smoke-test the server with Inspector and how official conformance fits into the validation strategy while the server remains stdio-only.

#### Scenario: Documentation explains current manual validation
- **WHEN** a contributor reads the validation documentation
- **THEN** it SHALL describe how to launch the built stdio server under Inspector and which MCP smoke checks to perform

#### Scenario: Documentation explains current conformance posture
- **WHEN** a contributor reads the validation documentation
- **THEN** it SHALL state that official conformance is advisory until the project exposes a suitable URL-based transport target
