## 1. Artifact Model And Persistence

- [x] 1.1 Extend `src/artifacts.ts` to define a versioned artifact bundle shape with metadata, trace file references, and deterministic workspace-local output paths.
- [x] 1.2 Implement artifact persistence helpers that write `metadata.json`, `trace.json`, `screen.txt`, and `transcript.ansi` for a captured session.
- [x] 1.3 Update `close_session` in `src/server/index.ts` to persist the artifact bundle and return structured artifact metadata to the caller.

## 2. Session Trace Recording And Diagnostics

- [x] 2.1 Extend `Session` in `src/core/session.ts` to record structured trace events for launch, input, resize, exit, and close.
- [x] 2.2 Update server tool handlers to append assertion and wait events with pattern, timeout, and success or failure details.
- [x] 2.3 Refactor `expect_text` and related assertion helpers in `src/core/assertions.ts` to return mode-aware diagnostic excerpts for timeout failures.

## 3. Verification

- [x] 3.1 Add integration tests that verify persisted artifact bundles and trace contents for a successful captured session.
- [x] 3.2 Add integration tests that verify `expect_text` timeout diagnostics and persisted failure artifacts for a failing captured session.
- [x] 3.3 Run `npm test` and confirm the new artifact files are created under the expected workspace-local path during the integration coverage.
