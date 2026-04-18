## Context

`@xterm/headless` already gives the project an authoritative terminal grid for buffer-mode sessions. The current artifact pipeline persists that state as plain text via `screen.txt`, which is useful for assertions but weak for human review because it cannot preserve visual structure beyond bare text layout. The project also already treats resize as a first-class contract, so the missing piece is not raw terminal state, but a deterministic way to render that state into a reviewable artifact and test it across resize scenarios.

## Goals / Non-Goals

**Goals:**
- Produce a reviewable rendered snapshot artifact for captured buffer-mode sessions.
- Preserve the existing text artifacts and additive compatibility for current callers.
- Make resize regressions testable as layout behavior, especially shrink and grow flows after redraw-heavy updates.
- Keep the artifact deterministic enough for CI and local debugging.

**Non-Goals:**
- Native desktop screenshots or any OS window capture.
- Pixel-perfect font or theme fidelity across platforms.
- PNG export in the first implementation.
- New assertion tools beyond the current buffer inspection surface.

## Decisions

### Emit a deterministic `screen.html` artifact from the terminal buffer

The first rendered artifact should be an HTML snapshot generated from buffer-mode terminal state. HTML is easy to persist, inspect in CI artifacts, and keep deterministic with inline styles and a fixed-width layout.

Alternatives considered:
- OS screenshots: rejected because they require a GUI surface, are brittle in CI, and test the host environment more than the terminal state.
- `screen.svg`: viable, but more work for little practical gain in the first cut.
- Transcript replay only: rejected because it does not solve the human-review problem.

### Keep rendered snapshots buffer-only in the first cut

The rendered artifact should be created only when a session has a live terminal buffer. Stream mode should keep its current text-first behavior because replaying raw transcript into a faithful rendered snapshot would add a second rendering path and more failure modes.

Alternatives considered:
- Render stream sessions by replaying the transcript: rejected for scope and determinism risk.
- Require all sessions to use buffer mode for artifacts: rejected because stream mode remains a valid capture mode.

### Extend artifact metadata additively

The bundle should keep the existing file layout and metadata fields, then add rendered-artifact metadata only when the rendered file exists. This keeps current callers working while exposing the richer artifact to new consumers.

Alternatives considered:
- Replace `screen.txt` with the rendered artifact: rejected because the plain-text screen remains the best machine-readable assertion/debug artifact.
- Introduce a separate artifact command: rejected because it splits one debugging workflow into multiple steps.

### Cover resize regressions with representative size transitions

Implementation should add PTY integration coverage that launches buffer-mode sessions, drives redraws, resizes through a small matrix of dimensions, waits for stability, and verifies the active screen reflects only the latest layout state. The tests should assert both structural output (`screen.txt` or region reads) and rendered artifact presence when capture is enabled.

Alternatives considered:
- Golden-file baselines for every supported size: deferred because the first cut should prove the rendering path and resize semantics before committing to baseline-management tooling.
- Metadata-only resize tests: rejected because they miss the actual layout-regression risk.

## Risks / Trade-offs

- Deterministic rendering may still differ from a human terminal theme, mitigation: document that `screen.html` is a debugging aid derived from buffer state, not a native screenshot.
- HTML generation can expose more sensitive terminal content, mitigation: apply the existing artifact redaction path to rendered output before writing it.
- Richer artifacts add bundle size, mitigation: keep the first artifact to a single HTML file and preserve existing retention policy behavior.
- Resize coverage can become flaky with redraw-heavy examples, mitigation: use the existing screen-change and screen-stability waits instead of sleep-heavy tests.

## Migration Plan

This change is additive. Existing artifact consumers can continue reading `screen.txt`, `trace.json`, `metadata.json`, and `transcript.ansi`. New consumers can check metadata for the rendered artifact path when it is present.

Rollback is straightforward: stop writing the rendered artifact and remove the extra metadata field, while leaving the text artifacts untouched.

## Open Questions

- None that block proposal approval. If implementation reveals missing buffer style data for a useful HTML snapshot, the fallback should still ship a structurally rendered HTML view before considering a new dependency.
