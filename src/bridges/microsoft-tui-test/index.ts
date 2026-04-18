/**
 * Bridge for Microsoft's tui-test.
 * Provides compatibility with the tui-test schema and execution model.
 */

export { runMicrosoftTuiTestBridge } from "./bridge.js";
export type { RunBridgeOptions } from "./bridge.js";
export { resolveMicrosoftTuiTest } from "./resolve.js";
export type { ResolvedBridge } from "./resolve.js";
export type {
  BridgeArtifacts,
  BridgeCommand,
  BridgeError,
  BridgeErrorKind,
  BridgeResult,
  BridgeStatus,
  BridgeSummary,
} from "./types.js";
