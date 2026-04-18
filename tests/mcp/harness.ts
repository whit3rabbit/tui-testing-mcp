import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type JsonRpcId = string | number;

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const serverEntry = path.join(repoRoot, "dist", "index.js");

export class RawStdioMcpHarness {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutLines: string[] = [];
  private readonly stderrChunks: string[] = [];
  private readonly responses = new Map<JsonRpcId, JsonRpcResponse>();
  private readonly waiters = new Map<JsonRpcId, (response: JsonRpcResponse) => void>();
  private stdoutBuffer = "";

  constructor() {
    this.child = spawn(process.execPath, [serverEntry], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        this.stdoutLines.push(line);
        const response = JSON.parse(line) as JsonRpcResponse;
        this.responses.set(response.id, response);
        const waiter = this.waiters.get(response.id);
        if (waiter) {
          this.waiters.delete(response.id);
          waiter(response);
        }
      }
    });

    this.child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });
  }

  getStdoutLines(): string[] {
    return [...this.stdoutLines];
  }

  getStderr(): string {
    return this.stderrChunks.join("");
  }

  send(message: Record<string, unknown>): void {
    this.sendLine(JSON.stringify(message));
  }

  sendLine(line: string): void {
    this.child.stdin.write(`${line}\n`);
  }

  async request(
    id: JsonRpcId,
    method: string,
    params?: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    return this.waitForResponse(id);
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async initialize(id: JsonRpcId = 1): Promise<JsonRpcResponse> {
    const response = await this.request(id, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "raw-protocol-test",
        version: "0.0.0",
      },
    });
    this.notify("notifications/initialized", {});
    await delay(25);
    return response;
  }

  async waitForResponse(id: JsonRpcId, timeoutMs: number = 2000): Promise<JsonRpcResponse> {
    const existing = this.responses.get(id);
    if (existing) {
      return existing;
    }

    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`Timed out waiting for JSON-RPC response ${String(id)}`));
      }, timeoutMs);

      this.waiters.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) {
      return;
    }

    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
    });
  }
}

export function getBuiltServerParams() {
  return {
    command: process.execPath,
    args: [serverEntry],
    cwd: repoRoot,
    stderr: "pipe" as const,
  };
}
