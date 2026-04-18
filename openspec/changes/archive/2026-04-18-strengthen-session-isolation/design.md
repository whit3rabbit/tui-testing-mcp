## Context

The current launch flow focuses on command execution and workspace security, not full session reproducibility. Sessions can already be separated by `sessionId`, but that is only identifier-level isolation. Real test isolation also needs environment boundaries, working-directory strategies, and reliable cleanup so sessions do not influence each other through files or inherited process state.

## Goals / Non-Goals

**Goals:**
- Add explicit, session-scoped environment shaping.
- Support isolated working-directory strategies for destructive or stateful tests.
- Guarantee cleanup behavior for isolated session resources.
- Keep isolation compatible with existing security policy checks and artifact capture.

**Non-Goals:**
- Introduce containerization or VM-level isolation.
- Expand to Windows-specific filesystem behavior.
- Replace existing workspace security policy with a new sandbox model.

## Decisions

### Treat isolation as launch-time configuration
Isolation choices should be made at session launch so the server can prepare environment, working-directory state, and cleanup hooks before the process starts. This keeps the behavior deterministic and avoids mid-session mutations.

Alternative considered:
- Add isolation toggles that can change after launch. Rejected because filesystem and environment isolation must be established before process creation.

### Use temporary working directories rooted inside approved workspace boundaries
Temporary execution directories should resolve under a server-controlled location inside the allowed workspace or system temp area that still satisfies security checks. This keeps the isolation feature compatible with existing path policy.

Alternative considered:
- Reuse the project root directly with cleanup heuristics. Rejected because it defeats the purpose for destructive tests.

### Make cleanup the default and debugging retention explicit
Temporary state should be removed automatically unless the caller opts into retaining it for inspection. Cleanup must run for both normal close and failure paths.

Alternative considered:
- Leave cleanup to the caller. Rejected because it would make isolation unreliable in the common case.

## Risks / Trade-offs

- [Fixture-copy mode can be slow for large projects] → Scope the first version to targeted fixture directories rather than full workspace copies.
- [Cleanup on failure may mask useful debugging state] → Support an explicit retain-for-debug option instead of keeping everything by default.
- [Isolation options may complicate launch APIs] → Prefer a small launch configuration object or config defaults over many unrelated flags.

## Migration Plan

This is additive. Existing launches keep current behavior unless isolation options are requested or configured as defaults.

## Open Questions

- Should isolated working directories be configured per session, per target, or both?
- Should artifact bundles for isolated sessions record the retained temporary path when cleanup is disabled for debugging?
