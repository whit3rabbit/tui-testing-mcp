/**
 * Runner adapters index.
 */

import { spawn } from "child_process";

const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024; // 1MB per stream

interface OutputAccumulator {
  bytes: number;
  text: string;
  truncated: boolean;
}

export type { RunnerAdapter, ProjectTarget, CommandSpec } from "./types.js";
export { BinaryRunner } from "./binary.js";
export { CargoRunner } from "./cargo.js";
export { GoRunner } from "./go.js";
export { NodeRunner } from "./node.js";
export { PythonRunner } from "./python.js";

import { BinaryRunner } from "./binary.js";
import { CargoRunner } from "./cargo.js";
import { GoRunner } from "./go.js";
import { NodeRunner } from "./node.js";
import { PythonRunner } from "./python.js";
import type { RunnerAdapter } from "./types.js";

/**
 * Spawn a command and return a promise with the result.
 */
export async function runCommand(
  spec: { command: string; args: string[]; cwd?: string; env?: Record<string, string> },
  timeoutMs?: number,
  maxOutputBytes: number = MAX_COMMAND_OUTPUT_BYTES
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
    });

    const stdoutState: OutputAccumulator = { bytes: 0, text: "", truncated: false };
    const stderrState: OutputAccumulator = { bytes: 0, text: "", truncated: false };
    let outputLimitExceeded = false;

    child.stdout?.on("data", (data) => {
      if (appendChunk(stdoutState, data, maxOutputBytes, "stdout")) {
        outputLimitExceeded = true;
        child.kill("SIGTERM");
      }
    });

    child.stderr?.on("data", (data) => {
      if (appendChunk(stderrState, data, maxOutputBytes, "stderr")) {
        outputLimitExceeded = true;
        child.kill("SIGTERM");
      }
    });

    const timeout = timeoutMs ? setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs) : undefined;

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        stdout: stdoutState.text,
        stderr: stderrState.text,
        exitCode: code ?? (outputLimitExceeded ? 1 : 0),
      });
    });

    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
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

/**
 * Registry of runner adapters.
 */
class RunnerRegistry {
  private runners = new Map<string, RunnerAdapter>();

  /**
   * Register a runner adapter.
   */
  register(adapter: RunnerAdapter): void {
    this.runners.set(adapter.id, adapter);
  }

  /**
   * Get a runner by ID.
   */
  get(id: string): RunnerAdapter | undefined {
    return this.runners.get(id);
  }

  /**
   * List all registered runner IDs.
   */
  list(): string[] {
    return Array.from(this.runners.keys());
  }

  /**
   * Auto-detect suitable runners for a project root.
   */
  async detect(root: string): Promise<RunnerAdapter[]> {
    const detected: RunnerAdapter[] = [];
    for (const runner of this.runners.values()) {
      if (await runner.detect(root)) {
        detected.push(runner);
      }
    }
    return detected;
  }
}

/**
 * Global runner registry.
 */
export const runnerRegistry = new RunnerRegistry();

// Register built-in runners
runnerRegistry.register(new BinaryRunner());
runnerRegistry.register(new CargoRunner());
runnerRegistry.register(new GoRunner());
runnerRegistry.register(new NodeRunner());
runnerRegistry.register(new PythonRunner());
