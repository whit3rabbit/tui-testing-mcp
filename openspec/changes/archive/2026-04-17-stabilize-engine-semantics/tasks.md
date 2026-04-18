## 1. Session Lifecycle Contract

- [x] 1.1 Define explicit session lifecycle behavior in `src/core/session.ts` and `src/server/index.ts` for active, exited, closed, and replaced sessions.
- [x] 1.2 Update session replacement and close paths so stale sessions are disposed predictably before relaunch.
- [x] 1.3 Ensure error responses for missing or closed sessions are consistent across input, capture, resize, and assertion tools.

## 2. Mode Consistency And Resize Handling

- [x] 2.1 Align shared capture and metadata behavior across stream and buffer sessions without removing intentional mode differences.
- [x] 2.2 Verify that `resize_session` keeps PTY, buffer, and exposed session dimensions synchronized in all supported modes.
- [x] 2.3 Tighten the current `shell: true` launch path so its engine-level behavior is explicit and testable.

## 3. Verification

- [x] 3.1 Add integration coverage for redraw-heavy terminal flows and resize behavior.
- [x] 3.2 Add integration coverage for shell-backed launches and lifecycle failure cases.
- [x] 3.3 Run `npm test` and confirm the engine semantics are pinned down before later roadmap changes build on them.

