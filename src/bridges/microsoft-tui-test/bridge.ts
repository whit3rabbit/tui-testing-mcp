/**
 * Microsoft TUI Test bridge: runs `@microsoft/tui-test` on behalf of the MCP
 * server and translates its output into a stable, structured MCP result.
 *
 * Why CLI, not programmatic API
 * -----------------------------
 * `@microsoft/tui-test` ships a `tui-test` CLI plus internal JS modules.
 * We spawn the CLI via Node because:
 *   - The CLI's exit code and artifact layout are the most stable public
 *     surface. Internal modules are not versioned for external consumers.
 *   - A programmatic adapter would couple us to framework internals and
 *     would break across upstream refactors.
 * Tradeoff: we must scrape stdout for summary counts and walk known
 * artifact directories. Summary parsing is intentionally lenient; the
 * exit code is authoritative and summary may be null when unparseable.
 *
 * The bridge stays isolated from the core PTY session engine: nothing in
 * src/core/ imports from here. Projects that do not invoke the bridge pay
 * zero runtime or dependency cost.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveMicrosoftTuiTest, type ResolvedBridge } from "./resolve.js";
import type {
  BridgeArtifacts,
  BridgeError,
  BridgeResult,
  BridgeSummary,
} from "./types.js";

const CONFIG_CANDIDATES = [
  "tui-test.config.ts",
  "tui-test.config.mts",
  "tui-test.config.cts",
  "tui-test.config.js",
  "tui-test.config.mjs",
  "tui-test.config.cjs",
] as const;

const ARTIFACT_SOURCES: ReadonlyArray<{ kind: "traces" | "snapshots"; dir: string }> = [
  { kind: "traces", dir: "test-results" },
  { kind: "traces", dir: "playwright-report" },
  { kind: "traces", dir: "tui-test-results" },
  { kind: "snapshots", dir: "__snapshots__" },
  { kind: "snapshots", dir: "snapshots" },
];
const MAX_BRIDGE_OUTPUT_BYTES = 1024 * 1024; // 1MB per stream

interface OutputAccumulator {
  bytes: number;
  text: string;
  truncated: boolean;
}

export interface RunBridgeOptions {
  cwd: string;
  configFile?: string;
  pattern?: string;
  timeoutMs?: number;
  extraArgs?: string[];
  /**
   * Required. The bridge does NOT fall back to `process.env` because doing
   * so bypasses the caller's security policy (envAllowlist, minimal env
   * default, etc.). The server tool builds this via `mergeEnv(security, ...)`.
   */
  env: NodeJS.ProcessEnv;
  /**
   * Optional signal to abort the bridge execution.
   */
  signal?: AbortSignal;
  /**
   * Injection seam for tests; production callers should not pass these.
   */
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  resolveFn?: (fromDir: string) => ResolvedBridge | null;
  maxOutputBytes?: number;
}

export async function runMicrosoftTuiTestBridge(
  options: RunBridgeOptions
): Promise<BridgeResult> {
  const started = Date.now();
  const cwd = path.resolve(options.cwd);
  const resolveFn = options.resolveFn ?? resolveMicrosoftTuiTest;
  const resolved = resolveFn(cwd);

  if (!resolved) {
    return errorResult(
      {
        kind: "missing_dependency",
        message:
          `@microsoft/tui-test is not installed or cannot be resolved from ${cwd}. ` +
          `Install it in the target project (for example: npm install --save-dev @microsoft/tui-test).`,
      },
      started
    );
  }

  const configPath = resolveConfigFile(cwd, options.configFile);
  if (!configPath && !options.pattern) {
    return errorResult(
      {
        kind: "incompatible_project",
        message:
          `No @microsoft/tui-test config found in ${cwd} and no explicit pattern was provided. ` +
          `Expected one of: ${CONFIG_CANDIDATES.join(", ")}.`,
      },
      started
    );
  }

  const cliArgs: string[] = [resolved.cliPath];
  if (configPath) cliArgs.push("--config", configPath);
  if (options.pattern) cliArgs.push(options.pattern);
  if (options.extraArgs?.length) cliArgs.push(...options.extraArgs);

  const executable = process.execPath;
  const spawnFn = options.spawnFn ?? spawn;

  return new Promise<BridgeResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(executable, cliArgs, {
        cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      resolve(
        errorResult(
          {
            kind: "execution_failed",
            message: `Failed to spawn bridge CLI: ${err instanceof Error ? err.message : String(err)}`,
          },
          started,
          { command: { executable, args: cliArgs, cwd } }
        )
      );
      return;
    }

    const stdoutState: OutputAccumulator = { bytes: 0, text: "", truncated: false };
    const stderrState: OutputAccumulator = { bytes: 0, text: "", truncated: false };
    let timedOut = false;
    let outputLimitExceeded = false;
    const maxOutputBytes = options.maxOutputBytes ?? MAX_BRIDGE_OUTPUT_BYTES;

    child.stdout?.on("data", (d: Buffer | string) => {
      if (appendChunk(stdoutState, d, maxOutputBytes, "stdout")) {
        outputLimitExceeded = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr?.on("data", (d: Buffer | string) => {
      if (appendChunk(stderrState, d, maxOutputBytes, "stderr")) {
        outputLimitExceeded = true;
        child.kill("SIGTERM");
      }
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve(
        errorResult(
          {
            kind: "execution_failed",
            message: `Bridge CLI failed to start: ${err.message}`,
          },
          started,
          { stdout: stdoutState.text, stderr: stderrState.text, command: { executable, args: cliArgs, cwd } }
        )
      );
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolve(
          errorResult(
            {
              kind: "execution_failed",
              message: `Bridge CLI timed out after ${options.timeoutMs}ms`,
            },
            started,
            { stdout: stdoutState.text, stderr: stderrState.text, command: { executable, args: cliArgs, cwd } }
          )
        );
        return;
      }
      if (outputLimitExceeded) {
        resolve(
          errorResult(
            {
              kind: "execution_failed",
              message: `Bridge CLI exceeded the ${maxOutputBytes}-byte per-stream output limit`,
            },
            started,
            {
              stdout: stdoutState.text,
              stderr: stderrState.text,
              command: { executable, args: cliArgs, cwd },
            }
          )
        );
        return;
      }

      const exitCode = code ?? null;
      const status = exitCode === 0 ? "success" : "failure";
      resolve({
        status,
        exitCode,
        summary: parseSummary(stdoutState.text),
        artifacts: collectArtifacts(cwd),
        stdout: stdoutState.text,
        stderr: stderrState.text,
        durationMs: Date.now() - started,
        command: { executable, args: cliArgs, cwd },
      });
    });
  });
}

function errorResult(
  error: BridgeError,
  started: number,
  extras: Partial<BridgeResult> = {}
): BridgeResult {
  return {
    status: "error",
    exitCode: null,
    summary: null,
    artifacts: { traces: [], snapshots: [] },
    stdout: "",
    stderr: "",
    durationMs: Date.now() - started,
    error,
    ...extras,
  };
}

function resolveConfigFile(cwd: string, explicit?: string): string | null {
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    return fs.existsSync(resolved) ? resolved : null;
  }
  for (const name of CONFIG_CANDIDATES) {
    const candidate = path.join(cwd, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Best-effort textual parse of "N passed", "N failed", "N skipped" counters.
 * Returns null when no recognizable counts are present.
 */
function parseSummary(output: string): BridgeSummary | null {
  const passed = matchCount(output, /(\d+)\s+passed\b/i);
  const failed = matchCount(output, /(\d+)\s+failed\b/i);
  const skipped = matchCount(output, /(\d+)\s+skipped\b/i);

  if (passed === null && failed === null && skipped === null) return null;

  const p = passed ?? 0;
  const f = failed ?? 0;
  const s = skipped ?? 0;
  return { passed: p, failed: f, skipped: s, total: p + f + s };
}

function matchCount(text: string, regex: RegExp): number | null {
  const m = regex.exec(text);
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

function collectArtifacts(cwd: string): BridgeArtifacts {
  const traces: string[] = [];
  const snapshots: string[] = [];
  for (const src of ARTIFACT_SOURCES) {
    const dir = path.join(cwd, src.dir);
    if (!fs.existsSync(dir)) continue;
    const files = walk(dir, 0, 3);
    if (src.kind === "traces") traces.push(...files);
    else snapshots.push(...files);
  }
  return { traces, snapshots };
}

function walk(dir: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, depth + 1, maxDepth));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function appendChunk(
  state: OutputAccumulator,
  data: Buffer | string,
  maxBytes: number,
  label: "stdout" | "stderr"
): boolean {
  if (state.truncated) {
    return false;
  }

  const chunk = typeof data === "string" ? data : data.toString("utf8");
  const chunkBytes = Buffer.byteLength(chunk, "utf8");
  const remaining = maxBytes - state.bytes;
  if (chunkBytes <= remaining) {
    state.text += chunk;
    state.bytes += chunkBytes;
    return false;
  }

  if (remaining > 0) {
    state.text += Buffer.from(chunk, "utf8").subarray(0, remaining).toString("utf8");
    state.bytes = maxBytes;
  }

  state.text += `\n[${label} truncated after ${maxBytes} bytes, process terminated]\n`;
  state.truncated = true;
  return true;
}
