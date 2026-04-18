# TUI Testing MCP Roadmap

This roadmap breaks the broader terminal-testing plan into separate OpenSpec changes so each implementation slice stays small and reversible.

## Execution Order

1. `stabilize-engine-semantics`
2. `add-session-traces-and-artifacts`
3. `improve-wait-semantics`
4. `strengthen-session-isolation`
5. `add-shell-abstraction`
6. `evaluate-windows-support`
7. `add-microsoft-tui-test-bridge`

## Apply Guidance

Apply now:
- `stabilize-engine-semantics`

Apply after engine semantics are stable:
- `add-session-traces-and-artifacts`
- `improve-wait-semantics`

Apply after traces and waits are in place:
- `strengthen-session-isolation`
- `add-shell-abstraction`

Apply only after the earlier architecture changes are complete:
- `evaluate-windows-support`
- `add-microsoft-tui-test-bridge`

## Notes

- The existing product remains an MCP server.
- `add-microsoft-tui-test-bridge` is optional and must not replace the core PTY-driven workflow.
- `evaluate-windows-support` is a decision and documentation change, not a promise to implement Windows support immediately.
