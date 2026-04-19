import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { SessionManager } from "./session.js";
import { ctrlKey, parseKeys } from "./keys.js";
import { sleep } from "../utils.js";

// Real-PTY regression for key byte encoding. The unit tests in keys.test.ts pin
// the parser output; this suite proves the same bytes actually reach a raw-mode
// child over a live PTY, so a future regression in Session.write / PTY plumbing
// can't silently re-break TUI key bindings (see the `enter` -> 0x0D fix).
//
// The child is a tiny inline Node script that sets stdin raw (disabling line
// discipline CR/LF rewrites and ISIG) and echoes each received byte as
// "BYTE:XX" hex. Assertions look at the capture transcript for those markers.

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const echoScript = [
  "process.stdin.setRawMode(true);",
  "process.stdin.resume();",
  "process.stdout.write('READY\\r\\n');",
  "process.stdin.on('data', (buf) => {",
  "  const parts = [];",
  "  for (const b of buf) { parts.push('BYTE:' + b.toString(16).toUpperCase().padStart(2, '0')); }",
  "  process.stdout.write(parts.join(' ') + '\\r\\n');",
  "});",
].join("");

async function waitForText(read: () => string, needle: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (read().includes(needle)) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for "${needle}". Last output:\n${read()}`);
}

async function waitForBytesInOrder(
  read: () => string,
  markers: string[],
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = read();
    let cursor = 0;
    let ok = true;
    for (const m of markers) {
      const idx = text.indexOf(m, cursor);
      if (idx < 0) { ok = false; break; }
      cursor = idx + m.length;
    }
    if (ok) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for byte markers [${markers.join(", ")}]. Last output:\n${read()}`);
}

describe("key byte encoding (real PTY)", () => {
  const manager = new SessionManager();

  afterAll(async () => {
    await manager.closeAll();
  });

  it(
    "named keys, escapes, and ctrl combos arrive as expected bytes at a raw-mode child",
    async () => {
      await manager.launch({
        sessionId: "keys-echo",
        command: process.execPath,
        args: ["-e", echoScript],
        cwd: repoRoot,
        mode: "stream",
      });
      const session = manager.get("keys-echo")!;
      await waitForText(() => session.capture(), "READY");

      // [label, bytes to send, expected BYTE: markers in order within the new capture slice]
      const cases: Array<[string, string, string[]]> = [
        // The original bug: named Enter must arrive as CR (0x0D), never LF (0x0A).
        ["named enter -> CR", parseKeys("enter"), ["BYTE:0D"]],
        ["named <enter> -> CR", parseKeys("<enter>"), ["BYTE:0D"]],
        ["named return alias -> CR", parseKeys("return"), ["BYTE:0D"]],
        // Equivalence: send_ctrl{key:"m"} must match send_keys{keys:"Enter"} byte-for-byte.
        ["ctrl+m -> CR (same byte as Enter)", ctrlKey("m"), ["BYTE:0D"]],
        // CR/LF escape split: literal backslash-n/-r must not collapse.
        ["literal \\n escape -> LF", parseKeys("\\n"), ["BYTE:0A"]],
        ["literal \\r escape -> CR", parseKeys("\\r"), ["BYTE:0D"]],
        // Single-byte named keys.
        ["tab", parseKeys("tab"), ["BYTE:09"]],
        ["escape", parseKeys("escape"), ["BYTE:1B"]],
        ["backspace", parseKeys("backspace"), ["BYTE:7F"]],
        // Multi-byte escape sequences survive the PTY intact.
        ["arrow up", parseKeys("up"), ["BYTE:1B", "BYTE:5B", "BYTE:41"]],
        ["arrow down", parseKeys("down"), ["BYTE:1B", "BYTE:5B", "BYTE:42"]],
        ["f1", parseKeys("f1"), ["BYTE:1B", "BYTE:4F", "BYTE:50"]],
        ["f5", parseKeys("f5"), ["BYTE:1B", "BYTE:5B", "BYTE:31", "BYTE:35", "BYTE:7E"]],
        ["page up", parseKeys("pageup"), ["BYTE:1B", "BYTE:5B", "BYTE:35", "BYTE:7E"]],
        // Ctrl via ^ syntax (raw-mode child sees 0x03, no SIGINT because ISIG is off).
        ["^c -> Ctrl+C byte", parseKeys("^c"), ["BYTE:03"]],
      ];

      for (const [label, bytes, markers] of cases) {
        const before = session.capture().length;
        session.write(bytes);
        await waitForBytesInOrder(() => session.capture().slice(before), markers).catch((err) => {
          throw new Error(`[${label}] ${err.message}`);
        });
      }

      // Sanity check: parseKeys("enter") and ctrlKey("m") resolve to the same byte,
      // which is the core of the original bug report.
      expect(parseKeys("enter")).toBe(ctrlKey("m"));
    },
    15_000
  );
});
