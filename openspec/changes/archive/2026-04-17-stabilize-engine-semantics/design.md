## Context

The current runtime already centralizes PTY and buffer handling in `Session`, but several engine-level behaviors are still implicit. Session replacement happens opportunistically, readiness is inferred rather than modeled, and overlapping features such as capture and resize depend on mode-specific code paths that are not yet described as a formal contract. Later work on traces, waits, and isolation will be fragile if those base semantics remain loose.

## Goals / Non-Goals

**Goals:**
- Define explicit lifecycle semantics for session creation, replacement, exit, and closure.
- Make overlapping stream and buffer behaviors predictable and testable.
- Keep resize behavior synchronized across PTY, buffer, and reported metadata.
- Add integration tests that pin down redraw, resize, shell, and failure behavior.

**Non-Goals:**
- Introduce artifact persistence or trace recording.
- Add new high-level assertion APIs.
- Add shell abstraction beyond stabilizing the current `shell: true` path.
- Expand support to Windows.

## Decisions

### Model session lifecycle as a first-class engine concern
The engine should treat session lifecycle semantics as a defined contract rather than an incidental side effect of PTY creation and disposal. `Session` and `SessionManager` should expose the conditions under which a session is active, replaced, exited, or unavailable.

Alternative considered:
- Keep lifecycle implicit and rely on current error branches. Rejected because later features need stable lifecycle hooks and predictable failures.

### Preserve a single session abstraction across modes
Stream and buffer sessions should continue sharing the same `Session` abstraction, with explicit documentation of where behavior is shared and where it intentionally differs. This avoids bifurcating the runtime too early.

Alternative considered:
- Split stream and buffer into separate session types. Rejected because it would increase code surface before the contract is stable.

### Verify semantics with integration tests before layering features on top
The engine contract should be pinned down with integration tests that exercise real PTY behavior, not just unit-level mocks. This is the cheapest place to catch regressions before traces and waits add more moving parts.

Alternative considered:
- Rely on existing unit tests and defer more integration coverage. Rejected because the important behaviors are cross-module and PTY-driven.

## Risks / Trade-offs

- [Lifecycle modeling may expose edge cases not previously tested] → Add tests first for current behavior, then tighten semantics with confidence.
- [Mode consistency work can accidentally erase intentional stream or buffer differences] → Specify only shared semantics and leave mode-specific behavior explicit.
- [Shell-mode coverage may be sensitive to local environment differences] → Keep tests narrow and assert stable outcomes rather than shell-specific formatting.

## Migration Plan

This change is internal and additive. Existing tools keep the same names and core parameters. Rollback is straightforward because the work lives in engine internals and tests.

## Open Questions

- Should readiness remain inferred from output availability, or should the engine expose an explicit ready flag once the lifecycle contract is formalized?
- Do any current callers rely on undocumented replacement behavior that should be preserved exactly?
