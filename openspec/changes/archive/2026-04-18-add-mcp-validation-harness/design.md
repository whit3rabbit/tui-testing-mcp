## Context

The project is a stdio MCP server built on `@modelcontextprotocol/sdk`, with the runtime entrypoint in `src/index.ts`, tool registration in `src/server/index.ts`, and PTY behavior coverage already concentrated in `src/core/*.test.ts` and `src/core/*.integration.test.ts`. Existing OpenSpec work defines product behaviors such as session lifecycle, waits, artifacts, isolation, and shell launching, but the repo still lacks a first-class validation lane for the MCP transport itself and for official-client interoperability.

This change needs to add protocol confidence without diluting the product test suites. The repo is still stdio-first, and the current official conformance runner is only useful once the server exposes a URL-based transport or a dedicated bridge, so this design needs to improve validation now without pretending HTTP support already exists.

## Goals / Non-Goals

**Goals:**
- Add a raw stdio protocol harness that black-box tests JSON-RPC framing, initialize-first behavior, stdout cleanliness, and representative error handling against the built server.
- Add an official SDK interoperability harness that uses the TypeScript client against the stdio server to validate `tools/list`, `tools/call`, and common failure paths.
- Keep protocol validation separate from the existing PTY product integration tests in scripts, docs, and CI so failures are easier to localize.
- Document Inspector-based smoke testing and the project's conformance posture while the server remains stdio-only.

**Non-Goals:**
- Add a Streamable HTTP transport in this change.
- Replace or redesign the existing PTY behavior tests for waits, artifacts, isolation, or shell launching.
- Introduce new MCP tools or change the published MCP tool contract.
- Make third-party community testing packages part of the required release gate.

## Decisions

### Add a raw stdio black-box harness alongside the existing Vitest suites
The repo should add a low-level harness that spawns `node dist/index.js`, writes newline-delimited JSON-RPC to `stdin`, and inspects `stdout` and `stderr` separately. This is the only reliable way to catch transport corruption issues such as accidental stdout logging, malformed message framing, or lifecycle ordering mistakes that a higher-level client can mask.

Alternative considered:
- Testing only through the official SDK client. Rejected because SDK abstractions can hide wire-level failures that still break real hosts.

### Add a second interoperability suite that uses the official TypeScript SDK client
The validation stack should include a higher-level suite that talks to the server through the official SDK client over stdio. This covers real client interoperability and gives the repo a stable way to verify initialization, tool discovery, successful tool calls, and representative error paths without hand-encoding every interaction.

Alternative considered:
- Keeping only the raw harness. Rejected because raw JSON-RPC coverage does not prove the server interoperates cleanly with the official client library used by many MCP ecosystems.

### Keep behavioral E2E coverage in the existing product-oriented integration suites
The current `src/core/*.integration.test.ts` layout already matches the product's real value: PTY behavior, waits, redraw handling, artifacts, and isolation. This change should strengthen that lane by naming it clearly as product E2E coverage, not by moving those tests into a protocol suite or duplicating their assertions under a new harness.

Alternative considered:
- Collapsing protocol and product validation into one broad integration bucket. Rejected because it blurs failure ownership and makes it harder to see whether a regression is in MCP framing or PTY semantics.

### Treat official conformance as documented future work until a URL transport exists
The design should document a conformance path, but the current implementation remains stdio-only. The repo should mark conformance as advisory and non-blocking for now, then promote it to a required gate when the project exposes a URL-based transport or a dedicated bridge that matches the conformance runner's expectations.

Alternative considered:
- Expanding this change to add HTTP transport only to satisfy conformance immediately. Rejected because it mixes transport-surface expansion with validation infrastructure and would be hard to justify as the smallest reversible change.

### Reuse the existing dependency set where possible
`@modelcontextprotocol/sdk` is already a project dependency, so the SDK interoperability suite can reuse it without adding a new runtime library. Inspector should be documented as a recommended debugging tool, but it does not need to become a required dependency for the core automated gate in this change.

Alternative considered:
- Adding third-party MCP testing frameworks as required infrastructure. Rejected because the official SDK and the repo's existing Vitest setup are enough for the initial gate, and extra tools would add maintenance risk before proving their value.

## Risks / Trade-offs

- [Built-server protocol tests increase test runtime] -> Keep the raw and SDK suites targeted at handshake, tool discovery, and a few representative calls instead of replaying full PTY scenarios there.
- [Raw stdio tests can be brittle if they over-assert exact JSON formatting] -> Assert protocol semantics and message boundaries, not serializer-specific key order.
- [Separate validation lanes can drift if scripts and docs are not kept aligned] -> Add explicit npm scripts and documentation that map each lane to a small, stable responsibility.
- [Conformance may remain aspirational if HTTP work never happens] -> Document the current limitation plainly and keep the future hook narrow so later work can adopt it without rewriting the earlier suites.

## Migration Plan

This is an additive testing and documentation change. Implement the new harnesses and scripts beside the existing Vitest suites, update CI and docs to call out the two validation lanes, and keep the published stdio transport unchanged. Rollback is straightforward: remove the new harness files and scripts, which restores the current single-lane test posture without affecting runtime behavior.

## Open Questions

- Should the raw stdio harness live under `src/server/` with other MCP-facing tests, or under a new top-level test directory once the suite grows?
- Which tool call should serve as the canonical happy-path interoperability smoke test: a lightweight screen capture flow or a simpler launch/close sequence?
- Do we want a dedicated CI job name for advisory conformance now, even if it only documents a skipped or future state?
