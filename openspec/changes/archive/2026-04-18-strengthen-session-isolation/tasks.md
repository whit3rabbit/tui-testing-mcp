## 1. Launch-Time Isolation Controls

- [x] 1.1 Extend launch configuration and config schema to express session-scoped environment and working-directory isolation options.
- [x] 1.2 Implement environment shaping so sessions can inherit, override, or restrict environment variables without leaking across sessions.
- [x] 1.3 Implement isolated working-directory preparation, including optional fixture-copy behavior for destructive tests.

## 2. Cleanup And Integration

- [x] 2.1 Ensure isolated session resources are cleaned up on normal close and failure paths, with an explicit retain-for-debug option.
- [x] 2.2 Integrate isolation behavior with existing security checks and artifact metadata where relevant.
- [x] 2.3 Keep default launch behavior unchanged for sessions that do not request isolation.

## 3. Verification

- [x] 3.1 Add integration tests for parallel sessions with distinct environment overrides.
- [x] 3.2 Add integration tests for isolated working-directory lifecycle and cleanup behavior.
- [x] 3.3 Run `npm test` and confirm isolated sessions are reproducible without leaking filesystem or environment state.
