import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { SessionManager } from "./session.js";
import { sleep } from "../utils.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

async function waitForMatch(read: () => string, pattern: string, timeoutMs: number = 5000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (read().includes(pattern)) {
      return;
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for "${pattern}". Last output:\n${read()}`);
}

describe("PTY integration", () => {
  const manager = new SessionManager();

  afterAll(async () => {
    await manager.closeAll();
  });

  it(
    "launches and drives the counter example over a real PTY",
    async () => {
      const info = await manager.launch({
        sessionId: "counter-live",
        command: process.execPath,
        args: [path.join(repoRoot, "examples/counter.js")],
        cwd: repoRoot,
        mode: "buffer",
      });

      const session = manager.get("counter-live");
      expect(info.pid).toBeGreaterThan(0);
      expect(session).toBeDefined();

      await waitForMatch(() => session!.capture(), "Counter value: 0");
      session!.write("+");
      await waitForMatch(() => session!.capture(), "Counter value: 1");

      session!.write("q");
      const exitStart = Date.now();
      while (!session!.pty.exited && Date.now() - exitStart < 3000) {
        await sleep(50);
      }

      expect(session!.pty.exited).toBe(true);
    },
    10000
  );
});
