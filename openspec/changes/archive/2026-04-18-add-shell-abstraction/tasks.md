## 1. Shell Adapter Model

- [x] 1.1 Define a shell adapter interface that is distinct from runner adapters and direct executable launches.
- [x] 1.2 Implement supported Unix shell adapters with explicit quoting and login-mode semantics.
- [x] 1.3 Update launch resolution so shell-backed requests use the shell abstraction while direct executable launches bypass it.

## 2. Configuration And Errors

- [x] 2.1 Extend launch configuration or project config to allow explicit shell selection and login-mode preferences.
- [x] 2.2 Return clear errors for unsupported shells or invalid shell-launch combinations.
- [x] 2.3 Keep security checks aligned with the new shell invocation path.

## 3. Verification

- [x] 3.1 Add integration tests for direct executable launches to confirm existing behavior remains unchanged.
- [x] 3.2 Add integration tests for supported shell-backed launches and unsupported-shell failures.
- [x] 3.3 Run `npm test` and confirm shell behavior is centralized before starting Windows evaluation work.
