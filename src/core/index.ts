/**
 * Core PTY and terminal buffer management.
 * Provides the low-level building blocks for terminal automation.
 */
export { PtyInstance, spawnPty, type PtyOptions, type PtyState } from "./pty.js";
export {
  TerminalBuffer,
  createBuffer,
  type BufferOptions,
  type CursorPosition,
} from "./buffer.js";
export {
  SessionManager,
  defaultSessionManager,
  type SessionMode,
  type SessionConfig,
  type LaunchConfig,
  type SessionInfo,
} from "./session.js";
export {
  assertContains,
  assertAtPosition,
  waitForText,
  waitForOutput,
  waitForScreenChange,
  waitForScreenStability,
  type AssertionResult,
  type WaitMode,
  type PatternMode,
  type WaitForTextOptions,
  type WaitForChangeOptions,
  type WaitForStabilityOptions,
} from "./assertions.js";
export { encodeKeys, ctrlKey, parseKeys, SpecialKeys } from "./keys.js";