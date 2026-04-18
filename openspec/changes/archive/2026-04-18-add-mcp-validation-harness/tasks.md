## 1. Raw Stdio Protocol Harness

- [x] 1.1 Add a raw stdio MCP test harness that spawns the built server, writes newline-delimited JSON-RPC messages, and captures `stdout` and `stderr` separately.
- [x] 1.2 Add protocol tests that verify initialize-first behavior, clean stdout transport, and representative malformed-request or invalid-lifecycle failures.
- [x] 1.3 Expose a dedicated test command or script for the raw stdio protocol lane so it can run independently in local workflows and CI.

## 2. SDK Interoperability Lane

- [x] 2.1 Add an interoperability test suite that connects to the stdio server through the official TypeScript MCP SDK client.
- [x] 2.2 Cover `tools/list`, at least one happy-path tool call, and at least one structured failure case through the SDK client harness.
- [x] 2.3 Separate protocol-lane execution from the existing PTY behavior integration suites so MCP validation and product E2E results are reported independently.

## 3. Documentation And Verification

- [x] 3.1 Update the contributor-facing docs with the MCP validation workflow, including Inspector smoke testing for the stdio server.
- [x] 3.2 Document the current conformance posture as advisory until the project exposes a suitable URL-based transport target.
- [x] 3.3 Run the relevant test commands and confirm the raw protocol lane, SDK interoperability lane, and existing PTY behavior lane all pass with the new structure.
