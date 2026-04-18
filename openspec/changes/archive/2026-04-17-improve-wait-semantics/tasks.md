## 1. Wait Primitives

- [x] 1.1 Extend `src/core/assertions.ts` to support literal-text and regular-expression wait conditions through a shared wait implementation.
- [x] 1.2 Add screen-change and screen-stability wait behavior that can observe terminal output without arbitrary client sleeps.
- [x] 1.3 Expose the chosen wait semantics through the existing MCP-facing server tools without bloating the API surface.

## 2. Diagnostics

- [x] 2.1 Update wait timeout results to include the failed condition, timeout, and concise output context.
- [x] 2.2 Ensure wait behavior stays mode-aware across stream and buffer sessions.
- [x] 2.3 Document the intended semantics in code comments or tests where the timing behavior would otherwise be unclear.

## 3. Verification

- [x] 3.1 Add integration tests for redraw-heavy sessions that rely on screen-change or screen-stability waits instead of fixed sleeps.
- [x] 3.2 Add integration tests for successful regex waits and timeout diagnostics.
- [x] 3.3 Run `npm test` and confirm the new wait semantics reduce the need for ad hoc polling in tests.

