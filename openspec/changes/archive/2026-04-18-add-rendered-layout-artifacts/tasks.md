## 1. Rendered Artifact Pipeline

- [x] 1.1 Add a deterministic buffer renderer that can serialize the active screen into a reviewable `screen.html` artifact.
- [x] 1.2 Extend artifact metadata and persistence so captured buffer-mode sessions write the rendered artifact alongside the existing text bundle, with redaction applied before disk writes.

## 2. Resize Regression Coverage

- [x] 2.1 Add PTY integration coverage for shrink and grow flows that wait for screen stability and verify the active screen does not retain stale layout state after redraws.
- [x] 2.2 Add representative size-matrix coverage for buffer-mode layout assertions and verify rendered artifacts are produced for captured sessions.

## 3. Documentation And Validation

- [x] 3.1 Update `README.md` and any artifact-related docs/examples to describe `screen.html`, its scope, and how it complements `screen.txt`.
- [x] 3.2 Run `npm run test:pty`, targeted artifact tests, and `openspec validate add-rendered-layout-artifacts --strict`.
