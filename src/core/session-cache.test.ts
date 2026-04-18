import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import type { PtyInstance } from "./pty.js";

const stripAnsiMock = vi.fn<(value: string) => string>();

class FakePty extends EventEmitter {
  pid = 1234;
  exited = false;
  exitCode: number | null = null;
  write() {}
  resize() {}
  dispose() { this.exited = true; }
}

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  stripAnsiMock.mockImplementation(actual.stripAnsi);
  return {
    ...actual,
    stripAnsi: stripAnsiMock,
  };
});

vi.mock("./pty.js", () => ({
  PtyInstance: class {},
  spawnPty: () => new FakePty(),
}));

const { Session } = await import("./session.js");

describe("Session transcript caches", () => {
  it("reuses stripped transcript reads until new PTY data arrives", () => {
    const pty = new FakePty();
    const session = new Session("cache", pty as unknown as PtyInstance, 80, 24);

    pty.emit("data", "\u001b[31mhello\u001b[0m");

    expect(session.capture(false, false)).toBe("hello");
    expect(session.capture(false, false)).toBe("hello");
    expect(stripAnsiMock).toHaveBeenCalledTimes(1);

    pty.emit("data", "\u001b[32m!\u001b[0m");

    expect(session.capture(false, false)).toBe("hello!");
    expect(stripAnsiMock).toHaveBeenCalledTimes(2);
  });
});
