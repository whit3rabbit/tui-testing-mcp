import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "./session.js";
import {
  waitForOutput,
  waitForScreenChange,
  waitForScreenStability,
} from "./assertions.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const counterPath = path.join(repoRoot, "examples/counter.js");

describe("wait semantics (real PTY)", () => {
  const managers: SessionManager[] = [];

  afterEach(async () => {
    for (const m of managers.splice(0)) {
      await m.closeAll();
    }
  });

  function newManager(): SessionManager {
    const m = new SessionManager();
    managers.push(m);
    return m;
  }

  it(
    "drives a redraw-heavy TUI with screen-change and stability waits instead of fixed sleeps",
    async () => {
      const manager = newManager();
      await manager.launch({
        sessionId: "wait-redraw",
        command: process.execPath,
        args: [counterPath],
        cwd: repoRoot,
        mode: "buffer",
      });

      const session = manager.get("wait-redraw")!;
      const read = () => session.buffer!.getScreenText();

      // Initial render settles before we start issuing input.
      const settled = await waitForScreenStability(read, {
        timeoutMs: 2000,
        pollIntervalMs: 20,
        stableForMs: 100,
        mode: "buffer",
      });
      expect(settled.success).toBe(true);
      expect(read()).toContain("Counter value: 0");

      // Each keypress clears the screen and rewrites it; screen-change waits
      // prove that the redraw landed without the test polling for specific
      // text first.
      for (let i = 1; i <= 3; i++) {
        const baseline = read();
        session.write("+");
        const changed = await waitForScreenChange(read, {
          timeoutMs: 2000,
          pollIntervalMs: 10,
          baseline,
          mode: "buffer",
        });
        expect(changed.success).toBe(true);

        // After the redraw lands, let it settle and confirm the counter moved.
        const stable = await waitForScreenStability(read, {
          timeoutMs: 2000,
          pollIntervalMs: 10,
          stableForMs: 80,
          mode: "buffer",
        });
        expect(stable.success).toBe(true);
        expect(read()).toContain(`Counter value: ${i}`);
      }
    },
    15000
  );

  it(
    "matches regex patterns against dynamic session output",
    async () => {
      const manager = newManager();
      await manager.launch({
        sessionId: "wait-regex",
        command: process.execPath,
        args: [counterPath],
        cwd: repoRoot,
        mode: "buffer",
      });

      const session = manager.get("wait-regex")!;
      const read = () => session.buffer!.getScreenText();

      const first = await waitForOutput(read, "Counter value:\\s+\\d+", {
        timeoutMs: 2000,
        pollIntervalMs: 20,
        patternMode: "regex",
        mode: "buffer",
      });
      expect(first.success).toBe(true);
      expect(first.found).toMatch(/Counter value:\s+0/);

      session.write("+");
      const after = await waitForOutput(read, /Counter value:\s+1/, {
        timeoutMs: 2000,
        pollIntervalMs: 20,
        mode: "buffer",
      });
      expect(after.success).toBe(true);
      expect(after.found).toMatch(/Counter value:\s+1/);
    },
    10000
  );

  it(
    "returns actionable diagnostics when a text wait times out",
    async () => {
      const manager = newManager();
      await manager.launch({
        sessionId: "wait-timeout",
        command: process.execPath,
        args: [counterPath],
        cwd: repoRoot,
        mode: "buffer",
      });

      const session = manager.get("wait-timeout")!;
      const read = () => session.buffer!.getScreenText();

      const result = await waitForOutput(read, "never-appears", {
        timeoutMs: 200,
        pollIntervalMs: 20,
        mode: "buffer",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Timeout after 200ms");
      expect(result.message).toContain('text "never-appears"');
      // Excerpt should include something from the counter screen so callers
      // can see what the session was actually showing.
      expect(result.message).toContain("Counter Demo");
      expect(result.excerpt).toBeDefined();
      expect(result.excerpt).toContain("Counter");
    },
    10000
  );

  it(
    "explains when a stability wait fails because the screen keeps changing",
    async () => {
      const manager = newManager();
      // Each emitted line is unique, so the rendered buffer never settles and
      // the stability wait is forced into its timeout diagnostic path.
      await manager.launch({
        sessionId: "wait-unstable",
        command: process.execPath,
        args: [
          "-e",
          "setInterval(() => process.stdout.write(Date.now() + ' churn\\n'), 10)",
        ],
        cwd: repoRoot,
        mode: "buffer",
      });

      const session = manager.get("wait-unstable")!;
      const read = () => session.buffer!.getScreenText();

      const result = await waitForScreenStability(read, {
        timeoutMs: 200,
        pollIntervalMs: 10,
        stableForMs: 150,
        mode: "buffer",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("screen stability");
      expect(result.message).toContain("required 150ms stable");
    },
    10000
  );
});
