## Context

The current `expect_text` flow polls for a string with a fixed interval and timeout. That is enough for simple CLI output, but it is not enough for redraw-heavy TUIs or dynamic terminal content where the interesting condition is not only text presence but also whether the screen has changed or settled. This change should build on a stabilized session engine and remain compatible with the existing MCP-first product shape.

## Goals / Non-Goals

**Goals:**
- Add richer wait primitives for text, regex, screen change, and screen stability.
- Keep wait behavior diagnosable and mode-aware.
- Reduce the need for arbitrary sleeps in integration tests and client usage.
- Keep the public tool model small and consistent.

**Non-Goals:**
- Introduce a full Playwright-style locator API.
- Add artifact persistence or bridge integration work.
- Rework the entire assertion surface beyond what wait semantics require.

## Decisions

### Centralize wait logic in the assertion layer
Wait orchestration should live in `src/core/assertions.ts`, with the server exposing the behavior through the existing assertion and wait tools. This keeps timing logic out of individual handlers and avoids multiple polling implementations.

Alternative considered:
- Add separate wait engines in server handlers. Rejected because it would duplicate timeout and diagnostic behavior.

### Treat screen stability as a first-class wait primitive
Redraw-heavy TUIs need more than “contains text”. A stability primitive should detect when the observed output has stopped changing for a configured interval so clients can assert on settled output rather than racing renders.

Alternative considered:
- Only improve text polling. Rejected because it leaves redraw-driven flakiness unsolved.

### Preserve MCP simplicity by extending existing tools carefully
The design should favor small parameter extensions or closely related tools instead of introducing a large new abstraction surface. The value comes from better semantics, not from a bigger API.

Alternative considered:
- Introduce a new test-oriented waiting DSL. Rejected because it would pull the project toward a separate runner model.

## Risks / Trade-offs

- [Additional wait modes may complicate the API] → Keep the number of supported wait concepts small and tied to common terminal-testing needs.
- [Stability detection may behave differently in stream and buffer modes] → Define mode-aware observation rules and cover them with integration tests.
- [Richer diagnostics can become noisy] → Return concise context excerpts instead of full-screen dumps by default.

## Migration Plan

This is an additive change. Existing clients can continue using current text waits while newer wait modes are introduced behind compatible APIs.

## Open Questions

- Should regex waits be supported by extending `expect_text`, by adding a sibling tool, or by allowing pattern mode selection?
- What default stability interval is short enough to be usable without hiding real render churn?
