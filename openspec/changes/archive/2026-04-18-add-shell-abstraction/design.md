## Context

The current code supports `shell: true`, but shell behavior is not abstracted as a first-class concern. That is acceptable for basic Unix usage, but it becomes a problem once shell differences, quoting rules, and platform boundaries need to be reasoned about explicitly. This change is the architectural boundary before any serious Windows support decision.

## Goals / Non-Goals

**Goals:**
- Separate shell-backed launch logic from direct executable launch logic.
- Centralize shell selection, quoting, and login semantics.
- Keep supported shells explicit and testable.
- Preserve existing non-shell execution behavior.

**Non-Goals:**
- Add Windows support.
- Build a full runner framework on top of shells.
- Automatically support every installed shell on the system.

## Decisions

### Introduce shell adapters distinct from runner adapters
Runner adapters choose project targets, while shell adapters describe how to invoke commands through a shell. Keeping these concepts separate avoids mixing project discovery with process-launch mechanics.

Alternative considered:
- Fold shell behavior into runner adapters. Rejected because shell concerns apply to arbitrary commands, not only project targets.

### Make shell support explicit rather than inferred
The first version should support a narrow set of Unix shells with explicit adapter implementations and predictable behavior. Unsupported shells should fail clearly.

Alternative considered:
- Pass through any shell path and hope the flags work. Rejected because it creates untestable behavior.

### Preserve direct executable launch as the default path
Direct executable launches should remain the simplest and preferred path when shell parsing is not required. The abstraction should only engage when shell execution is explicitly requested.

Alternative considered:
- Route all launches through a shell. Rejected because it would weaken security and introduce unnecessary quoting complexity.

## Risks / Trade-offs

- [Adapter support can drift from real shell behavior] → Start with a small shell matrix and verify it in tests.
- [Extra abstraction can feel heavyweight for the current codebase] → Keep adapters small and focused on invocation rules only.
- [Login shells can introduce environment variability] → Require explicit login-mode selection and test the narrow supported behavior.

## Migration Plan

This is additive. Existing direct launches remain unchanged. Existing `shell: true` flows migrate internally onto the shell abstraction.

## Open Questions

- Which Unix shells should be first-class in the initial adapter set: `sh`, `bash`, `zsh`, and `fish`, or a smaller subset?
- Should shell selection be a launch parameter, a config default, or both?
