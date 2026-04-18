## Why

Windows support is an obvious user-facing gap, but treating it as implementation work before the engine, waits, isolation, and shell boundaries are settled would be reckless. The project needs a concrete compatibility assessment and explicit support decision before any cross-platform commitment is made.

## What Changes

- Investigate Windows feasibility across PTY behavior, shell behavior, terminal rendering, snapshot stability, and CI coverage.
- Produce a written support matrix and explicit project decision for Windows support.
- Document required prerequisites and blockers if Windows support is deferred.
- Update project docs so the support stance is explicit instead of implied.

## Capabilities

### New Capabilities
- `windows-support-evaluation`: Define and document the project's Windows support decision and the constraints behind it.

### Modified Capabilities

None.

## Impact

- Affected code: likely docs and planning artifacts first, with prototype code only if needed to validate feasibility.
- APIs: no required user-facing API change in the evaluation phase.
- Dependencies: may require exploratory use of Windows CI or prototype scripts, but no committed runtime dependency is assumed.
- Systems: this change sets the boundary for whether later Windows implementation work should exist at all.
