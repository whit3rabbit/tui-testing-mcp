import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep } from "../utils.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const tempDirs: string[] = [];
const spawnCalls: PtyOptions[] = [];
const fakePtys: FakePty[] = [];

interface PtyOptions {
  file: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

class FakePty extends EventEmitter {
  private static nextPid = 1000;
  private _exited = false;
  private _exitCode: number | null = null;
  readonly pid = FakePty.nextPid++;
  readonly writes: string[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  disposed = false;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  dispose(): void {
    this.disposed = true;
    this._exited = true;
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  pushOutput(data: string): void {
    this.emit("data", data);
  }
}

vi.mock("./pty.js", () => ({
  spawnPty: (options: PtyOptions) => {
    spawnCalls.push(options);
    const pty = new FakePty();
    fakePtys.push(pty);
    return pty;
  },
}));

const { SessionManager } = await import("./session.js");

afterEach(async () => {
  spawnCalls.length = 0;
  fakePtys.length = 0;

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkShellConfigRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-shell-"));
  tempDirs.push(tempRoot);
  fs.writeFileSync(
    path.join(tempRoot, "tui-test.config.json"),
    JSON.stringify(
      { workspaceRoot: ".", security: { allowShell: true, allowShellEval: true } },
      null,
      2
    )
  );
  return tempRoot;
}

describe("SessionManager", () => {
  it("preserves explicit argv without reparsing spaces", async () => {
    const manager = new SessionManager();

    try {
      await manager.launch({
        sessionId: "argv",
        command: process.execPath,
        args: ["script.js", "hello world", "two"],
        cwd: repoRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe(process.execPath);
      expect(spawnCalls[0]?.args).toEqual(["script.js", "hello world", "two"]);
    } finally {
      await manager.closeAll();
    }
  });

  it("captures stream output in stream mode", async () => {
    const manager = new SessionManager();

    try {
      await manager.launch({
        sessionId: "stream",
        command: process.execPath,
        args: ["counter.js"],
        cwd: repoRoot,
        mode: "stream",
      });

      const session = manager.get("stream");
      expect(session).toBeDefined();

      fakePtys[0]?.pushOutput("\u001b[2JCounter value: 0\n");
      await sleep(0);

      expect(session?.capture()).toContain("Counter value: 0");
      expect(session?.capture(true)).toContain("\u001b[2J");
    } finally {
      await manager.closeAll();
    }
  });

  it("serializes concurrent launches for the same sessionId without orphaning PTYs", async () => {
    const manager = new SessionManager();

    try {
      // Fire two launches with the same sessionId on the same tick. Without
      // the launching-map guard, both could pass the `has()` check and both
      // would spawn a PTY, leaking the first.
      const [first, second] = await Promise.all([
        manager.launch({
          sessionId: "race",
          command: process.execPath,
          args: ["-e", "process.stdout.write('first')"],
          cwd: repoRoot,
          mode: "stream",
        }),
        manager.launch({
          sessionId: "race",
          command: process.execPath,
          args: ["-e", "process.stdout.write('second')"],
          cwd: repoRoot,
          mode: "stream",
        }),
      ]);

      // Exactly two PTYs were spawned (one per launch), and the earlier one
      // was disposed by the replacement logic rather than left orphaned.
      expect(fakePtys).toHaveLength(2);
      expect(fakePtys[0]?.disposed).toBe(true);
      expect(fakePtys[1]?.disposed).toBe(false);

      // Only one session is registered, and it corresponds to the second
      // launch. Both promises report the same id.
      expect(first.id).toBe("race");
      expect(second.id).toBe("race");
      expect(manager.get("race")).toBeDefined();
    } finally {
      await manager.closeAll();
    }
  });

  it("closes reused session ids and keeps resize metadata in sync", async () => {
    const manager = new SessionManager();

    try {
      await manager.launch({
        sessionId: "reuse",
        command: process.execPath,
        args: [path.join(repoRoot, "examples/counter.js")],
        cwd: repoRoot,
        mode: "buffer",
      });

      const firstPty = fakePtys[0];
      const session = manager.get("reuse");
      expect(session).toBeDefined();

      firstPty?.pushOutput("Counter value: 0\n");
      await sleep(0);

      session?.resize(100, 40);
      expect(session?.info.cols).toBe(100);
      expect(session?.info.rows).toBe(40);
      expect(session?.buffer?.cols).toBe(100);
      expect(session?.buffer?.rows).toBe(40);
      expect(firstPty?.resizeCalls).toEqual([{ cols: 100, rows: 40 }]);

      await manager.launch({
        sessionId: "reuse",
        command: process.execPath,
        args: ["-e", "console.log('replacement session')"],
        cwd: repoRoot,
        mode: "stream",
      });

      expect(firstPty?.disposed).toBe(true);
      expect(fakePtys).toHaveLength(2);
    } finally {
      await manager.closeAll();
    }
  });

  it("honors capture() branches on a buffered session", async () => {
    const manager = new SessionManager();

    try {
      await manager.launch({
        sessionId: "cap",
        command: process.execPath,
        args: ["-e", "process.stdout.write('noop')"],
        cwd: repoRoot,
        mode: "buffer",
        cols: 20,
        rows: 5,
      });

      const session = manager.get("cap");
      expect(session).toBeDefined();
      expect(session?.buffer).toBeDefined();

      // Mix ANSI + text so we can distinguish "buffer text" from "raw stream".
      fakePtys[0]?.pushOutput("\u001b[31mHELLO\u001b[0m");
      await sleep(0);

      // Auto path, no ANSI: xterm buffer text, stripped.
      const bufText = session?.capture(false) ?? "";
      expect(bufText).toContain("HELLO");
      expect(bufText).not.toContain("\u001b[");

      // Auto path, ANSI requested: falls back to raw streamOutput so ANSI
      // actually comes through (the buffer serializer can't emit it).
      const bufAnsi = session?.capture(true) ?? "";
      expect(bufAnsi).toContain("\u001b[31m");
      expect(bufAnsi).toContain("HELLO");

      // Explicit useBuffer=false: raw stream readback regardless of mode.
      const forcedStream = session?.capture(false, false) ?? "";
      expect(forcedStream).toContain("HELLO");
      expect(forcedStream).not.toContain("\u001b[");

      const forcedStreamAnsi = session?.capture(true, false) ?? "";
      expect(forcedStreamAnsi).toContain("\u001b[31m");

      // Explicit useBuffer=true with includeAnsi still falls back to raw
      // stream, since the buffer can't provide ANSI. Document that branch.
      const explicitBufAnsi = session?.capture(true, true) ?? "";
      expect(explicitBufAnsi).toContain("\u001b[31m");

      // Explicit useBuffer=true without ANSI: plain buffer text.
      const explicitBuf = session?.capture(false, true) ?? "";
      expect(explicitBuf).toContain("HELLO");
      expect(explicitBuf).not.toContain("\u001b[");
    } finally {
      await manager.closeAll();
    }
  });

  it("keeps stream-mode session dimensions synced on resize", async () => {
    const manager = new SessionManager();

    try {
      await manager.launch({
        sessionId: "stream-resize",
        command: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
        cwd: repoRoot,
        mode: "stream",
        cols: 80,
        rows: 24,
      });

      const session = manager.get("stream-resize");
      expect(session).toBeDefined();
      expect(session?.buffer).toBeUndefined();
      expect(session?.info.cols).toBe(80);
      expect(session?.info.rows).toBe(24);

      session?.resize(132, 50);

      expect(session?.info.cols).toBe(132);
      expect(session?.info.rows).toBe(50);
      expect(fakePtys[0]?.resizeCalls).toEqual([{ cols: 132, rows: 50 }]);
    } finally {
      await manager.closeAll();
    }
  });

  it("reports lifecycle status through SessionInfo", async () => {
    const manager = new SessionManager();

    await manager.launch({
      sessionId: "status",
      command: process.execPath,
      args: ["-e", "process.stdout.write('ok')"],
      cwd: repoRoot,
      mode: "stream",
    });

    const session = manager.get("status");
    expect(session?.info.status).toBe("active");

    await manager.close("status");
    expect(session?.status).toBe("closed");
    expect(session?.info.status).toBe("closed");
    expect(manager.get("status")).toBeUndefined();
  });

  it("rejects resize after the session is closed", async () => {
    const manager = new SessionManager();

    await manager.launch({
      sessionId: "closed-resize",
      command: process.execPath,
      args: ["-e", "process.stdout.write('ok')"],
      cwd: repoRoot,
      mode: "stream",
    });

    const session = manager.get("closed-resize");
    expect(session).toBeDefined();
    await manager.close("closed-resize");

    expect(() => session?.resize(100, 40)).toThrow(/closed/);
  });

  it("rejects empty shell commands before spawning", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();

    await expect(
      manager.launch({
        sessionId: "shell-empty",
        command: "   ",
        shell: true,
        cwd: tempRoot,
      })
    ).rejects.toThrow(/non-empty/);

    expect(spawnCalls).toHaveLength(0);
  });

  it("builds a deterministic argv for shell-mode launches", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();
    const originalShell = process.env.SHELL;
    process.env.SHELL = "/bin/bash";

    try {
      await manager.launch({
        sessionId: "shell-argv",
        command: "echo hello",
        shell: true,
        cwd: tempRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe("/bin/bash");
      expect(spawnCalls[0]?.args).toEqual(["-lc", "echo hello"]);
    } finally {
      process.env.SHELL = originalShell;
      await manager.closeAll();
    }
  });

  it("routes explicit argv launches around the shell abstraction", async () => {
    const manager = new SessionManager();
    const originalShell = process.env.SHELL;
    // Force a non-default shell so any accidental adapter use would be visible.
    process.env.SHELL = "/bin/zsh";

    try {
      await manager.launch({
        sessionId: "direct-exec",
        command: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
        cwd: repoRoot,
        mode: "stream",
      });

      // Direct exec must spawn the requested binary verbatim, with no shell
      // wrapping flag in argv.
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe(process.execPath);
      expect(spawnCalls[0]?.args).toEqual(["-e", "process.stdout.write('ok')"]);
      expect(spawnCalls[0]?.args).not.toContain("-lc");
      expect(spawnCalls[0]?.args).not.toContain("-c");
    } finally {
      process.env.SHELL = originalShell;
      await manager.closeAll();
    }
  });

  it("honors explicit shellOptions for non-login bash", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();

    try {
      await manager.launch({
        sessionId: "shell-bash-noprofile",
        command: "echo hi",
        shell: true,
        shellOptions: { name: "bash", login: false },
        cwd: tempRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe("/bin/bash");
      expect(spawnCalls[0]?.args).toEqual(["-c", "echo hi"]);
    } finally {
      await manager.closeAll();
    }
  });

  it("honors explicit shellOptions for fish (separate -l -c argv)", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();

    try {
      await manager.launch({
        sessionId: "shell-fish",
        command: "echo hi",
        shell: true,
        shellOptions: { name: "fish", login: true },
        cwd: tempRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe("/usr/bin/fish");
      expect(spawnCalls[0]?.args).toEqual(["-l", "-c", "echo hi"]);
    } finally {
      await manager.closeAll();
    }
  });

  it("honors explicit shellOptions for cmd", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();

    try {
      await manager.launch({
        sessionId: "shell-cmd",
        command: "echo hi",
        shell: true,
        shellOptions: { name: "cmd", login: false },
        cwd: tempRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe("cmd.exe");
      expect(spawnCalls[0]?.args).toEqual(["/c", "echo hi"]);
    } finally {
      await manager.closeAll();
    }
  });

  it("rejects unsupported shell selections before spawning", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();

    await expect(
      manager.launch({
        sessionId: "shell-unsupported",
        command: "echo hi",
        shell: true,
        shellOptions: { name: "powershell" },
        cwd: tempRoot,
      })
    ).rejects.toThrow(/Unsupported shell 'powershell'/);

    expect(spawnCalls).toHaveLength(0);
  });

  it("rejects shell: true when allowShellEval is false even if allowShell is true", async () => {
    const manager = new SessionManager();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-shelleval-"));
    tempDirs.push(tempRoot);
    fs.writeFileSync(
      path.join(tempRoot, "tui-test.config.json"),
      JSON.stringify(
        { workspaceRoot: ".", security: { allowShell: true, allowShellEval: false } },
        null,
        2
      )
    );

    await expect(
      manager.launch({
        sessionId: "shell-eval-denied",
        command: "echo hi",
        shell: true,
        cwd: tempRoot,
        mode: "stream",
      })
    ).rejects.toThrow(/Inline shell eval is disabled/);

    expect(spawnCalls).toHaveLength(0);
  });

  it("rejects shell+target combinations", async () => {
    const manager = new SessionManager();
    const tempRoot = mkShellConfigRoot();

    await expect(
      manager.launch({
        sessionId: "shell-and-target",
        target: "anything",
        shell: true,
        cwd: tempRoot,
      })
    ).rejects.toThrow(/shell mode is not compatible with target/);

    expect(spawnCalls).toHaveLength(0);
  });

  it("rejects shellOptions when shell is not enabled", async () => {
    const manager = new SessionManager();

    await expect(
      manager.launch({
        sessionId: "shell-options-without-shell",
        command: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
        shellOptions: { name: "bash" },
        cwd: repoRoot,
      })
    ).rejects.toThrow(/shellOptions requires shell: true/);

    expect(spawnCalls).toHaveLength(0);
  });

  it("uses project-level shell defaults when shellOptions are not provided", async () => {
    const manager = new SessionManager();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-shell-defaults-"));
    tempDirs.push(tempRoot);
    fs.writeFileSync(
      path.join(tempRoot, "tui-test.config.json"),
      JSON.stringify(
        {
          workspaceRoot: ".",
          security: { allowShell: true, allowShellEval: true },
          // Project default that should override the env-derived shell.
          shell: { name: "zsh", login: false },
        },
        null,
        2
      )
    );

    const originalShell = process.env.SHELL;
    process.env.SHELL = "/bin/bash";

    try {
      await manager.launch({
        sessionId: "shell-defaults",
        command: "echo hi",
        shell: true,
        cwd: tempRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe("/bin/zsh");
      expect(spawnCalls[0]?.args).toEqual(["-c", "echo hi"]);
    } finally {
      process.env.SHELL = originalShell;
      await manager.closeAll();
    }
  });

  it("resolves configured targets into runner launch specs", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-target-"));
    tempDirs.push(tempRoot);

    fs.writeFileSync(
      path.join(tempRoot, "tui-test.config.json"),
      JSON.stringify(
        {
          workspaceRoot: ".",
          targets: {
            counter: {
              runner: "node",
              cwd: ".",
              launch: [process.execPath, path.join(repoRoot, "examples/counter.js")],
            },
          },
        },
        null,
        2
      )
    );

    const manager = new SessionManager();

    try {
      await manager.launch({
        sessionId: "target",
        target: "counter",
        cwd: tempRoot,
        mode: "stream",
      });

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.file).toBe(process.execPath);
      expect(spawnCalls[0]?.args).toEqual([path.join(repoRoot, "examples/counter.js")]);
      expect(spawnCalls[0]?.cwd).toBe(tempRoot);
    } finally {
      await manager.closeAll();
    }
  });
});
