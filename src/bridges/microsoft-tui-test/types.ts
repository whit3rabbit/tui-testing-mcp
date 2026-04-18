/**
 * Structured result types for the Microsoft TUI Test bridge.
 *
 * `status` is the top-level verdict:
 *   - "success": bridge ran and the underlying CLI exited 0
 *   - "failure": bridge ran but the CLI reported test failures (non-zero exit)
 *   - "error":   bridge could not run at all (missing dep, incompatible
 *                project, spawn failure, timeout)
 *
 * `summary` is best-effort and nullable because the CLI's textual output
 * format is not part of a stable contract. `exitCode` is authoritative.
 */

export type BridgeStatus = "success" | "failure" | "error";

export type BridgeErrorKind =
  | "missing_dependency"
  | "incompatible_project"
  | "execution_failed";

export interface BridgeSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface BridgeArtifacts {
  traces: string[];
  snapshots: string[];
}

export interface BridgeError {
  kind: BridgeErrorKind;
  message: string;
}

export interface BridgeCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export interface BridgeResult {
  status: BridgeStatus;
  exitCode: number | null;
  summary: BridgeSummary | null;
  artifacts: BridgeArtifacts;
  stdout: string;
  stderr: string;
  durationMs: number;
  command?: BridgeCommand;
  error?: BridgeError;
}
