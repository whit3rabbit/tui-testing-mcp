import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Session, SessionManager } from "./session.js";
import { waitForScreenChange, waitForScreenStability } from "./assertions.js";
import { closeSessionWithArtifacts, expectTextInSession } from "../server/index.js";
import { sleep } from "../utils.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const counterPath = path.join(repoRoot, "examples/counter.js");
const responsiveLayoutPath = path.join(repoRoot, "examples/responsive-layout.js");

function mkShellConfigRoot(tempDirs: string[]): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-engine-shell-"));
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

function mkWorkspaceRoot(tempDirs: string[], prefix: string): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempRoot);
  return tempRoot;
}

function mkFixtureRoot(tempDirs: string[], prefix: string): string {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(fixtureRoot);
  fs.writeFileSync(path.join(fixtureRoot, "fixture.txt"), "seed\n");
  fs.writeFileSync(
    path.join(fixtureRoot, "runner.cjs"),
    [
      "const fs = require('fs');",
      "const payload = { cwd: process.cwd(), fixture: fs.readFileSync('fixture.txt', 'utf8').trim() };",
      "fs.writeFileSync('created.txt', 'created\\n');",
      "console.log(JSON.stringify(payload));",
      "const mode = process.argv[2];",
      "if (mode === 'hold') { setInterval(() => {}, 1000); }",
      "if (mode === 'fail') { setTimeout(() => process.exit(1), 50); }",
    ].join("\n")
  );
  return fixtureRoot;
}

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

async function waitForExit(session: Session, timeoutMs: number = 5000): Promise<void> {
  const start = Date.now();
  while (!session.pty.exited && Date.now() - start < timeoutMs) {
    await sleep(50);
  }

  if (!session.pty.exited) {
    throw new Error(`Timed out waiting for session "${session.id}" to exit`);
  }
}

async function waitForStableBuffer(session: Session, timeoutMs: number = 3000): Promise<string> {
  const read = () => session.buffer!.getScreenText();
  const settled = await waitForScreenStability(read, {
    timeoutMs,
    pollIntervalMs: 20,
    stableForMs: 120,
    mode: "buffer",
  });

  if (!settled.success) {
    throw new Error(settled.message);
  }

  return read();
}

function parseJsonLine(output: string): { cwd: string; fixture?: string; token?: string | null; secret?: string | null } {
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("{") && entry.endsWith("}"));

  if (!line) {
    throw new Error(`No JSON line found in output:\n${output}`);
  }

  return JSON.parse(line) as { cwd: string; fixture?: string; token?: string | null; secret?: string | null };
}

describe("engine semantics (real PTY)", () => {
  const managers: SessionManager[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const m of managers.splice(0)) {
      await m.closeAll();
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function newManager(): SessionManager {
    const m = new SessionManager();
    managers.push(m);
    return m;
  }

  it(
    "captures redraw-heavy TUI output reliably in buffer mode",
    async () => {
      const manager = newManager();
      await manager.launch({
        sessionId: "redraw",
        command: process.execPath,
        args: [counterPath],
        cwd: repoRoot,
        mode: "buffer",
      });
      const session = manager.get("redraw");
      expect(session).toBeDefined();

      await waitForMatch(() => session!.capture(), "Counter value: 0");

      // Counter redraws the full screen on every keypress via console.clear().
      // Drive several increments so the buffer has to reconcile repeated
      // clears + rewrites and still report the latest state. A short sleep
      // between writes keeps the child's stdin loop in lockstep.
      for (let i = 0; i < 5; i++) {
        session!.write("+");
        await waitForMatch(() => session!.capture(), `Counter value: ${i + 1}`);
      }

      const screen = session!.capture();
      // Only the latest counter value should be visible on the active screen;
      // earlier values belong to scrollback, not the xterm active buffer.
      expect(screen).toContain("Counter value: 5");
      expect(screen).not.toContain("Counter value: 0");
      expect(screen).not.toContain("Counter value: 4");
    },
    10000
  );

  it(
    "synchronizes PTY, buffer, and reported dimensions on resize",
    async () => {
      const manager = newManager();
      await manager.launch({
        sessionId: "resize-live",
        command: process.execPath,
        args: [counterPath],
        cwd: repoRoot,
        mode: "buffer",
        cols: 80,
        rows: 24,
      });
      const session = manager.get("resize-live");
      expect(session).toBeDefined();
      await waitForMatch(() => session!.capture(), "Counter value");

      session!.resize(120, 40);
      expect(session!.info.cols).toBe(120);
      expect(session!.info.rows).toBe(40);
      expect(session!.buffer?.cols).toBe(120);
      expect(session!.buffer?.rows).toBe(40);
    },
    10000
  );

  // Skipped on Windows: ConPTY intermittently drops the initial buffer render,
  // leaving an all-newline screen. See docs/windows-support.md "Known upstream
  // issues".
  it.skipIf(process.platform === "win32")(
    "reconciles shrink and grow redraws without leaving stale active-screen layout behind",
    async () => {
      const manager = newManager();
      await manager.launch({
        sessionId: "resize-layout",
        command: process.execPath,
        args: [responsiveLayoutPath],
        cwd: repoRoot,
        mode: "buffer",
        cols: 96,
        rows: 20,
      });
      const session = manager.get("resize-layout");
      expect(session).toBeDefined();

      let screen = await waitForStableBuffer(session!);
      expect(screen).toContain("layout=wide cols=96 rows=20");
      expect(screen).toContain("pane=split");
      expect(screen).toContain("wide-only");

      let baseline = screen;
      session!.resize(44, 12);
      const shrunk = await waitForScreenChange(() => session!.buffer!.getScreenText(), {
        timeoutMs: 2000,
        pollIntervalMs: 20,
        baseline,
        mode: "buffer",
      });
      expect(shrunk.success).toBe(true);

      screen = await waitForStableBuffer(session!);
      expect(screen).toContain("layout=compact cols=44 rows=12");
      expect(screen).toContain("pane=stack");
      expect(screen).toContain("compact-only");
      expect(screen).not.toContain("wide-only");

      baseline = screen;
      session!.resize(88, 18);
      const grown = await waitForScreenChange(() => session!.buffer!.getScreenText(), {
        timeoutMs: 2000,
        pollIntervalMs: 20,
        baseline,
        mode: "buffer",
      });
      expect(grown.success).toBe(true);

      screen = await waitForStableBuffer(session!);
      expect(screen).toContain("layout=wide cols=88 rows=18");
      expect(screen).toContain("pane=split");
      expect(screen).toContain("wide-only");
      expect(screen).not.toContain("compact-only");

      session!.write("q");
      await waitForExit(session!);
    },
    15000
  );

  it(
    "launches shell-backed commands and captures their output",
    async () => {
      const manager = newManager();
      const shellRoot = mkShellConfigRoot(tempDirs);
      const info = await manager.launch({
        sessionId: "shell-launch",
        command: "echo hello-shell",
        shell: true,
        cwd: shellRoot,
        mode: "stream",
      });
      expect(info.pid).toBeGreaterThan(0);

      const session = manager.get("shell-launch");
      await waitForMatch(() => session!.capture(), "hello-shell");
      expect(session!.capture()).toContain("hello-shell");

      const exitStart = Date.now();
      while (!session!.pty.exited && Date.now() - exitStart < 3000) {
        await sleep(50);
      }
      expect(session!.pty.exited).toBe(true);
      expect(session!.status).toBe("exited");
    },
    10000
  );

  it("rejects shell-backed launches when policy disallows shell", async () => {
    const manager = newManager();
    // No config => default policy has allowShell=false, so this must fail
    // before a PTY is spawned.
    await expect(
      manager.launch({
        sessionId: "shell-denied",
        command: "echo blocked",
        shell: true,
        cwd: repoRoot,
        mode: "stream",
      })
    ).rejects.toThrow(/shell/i);
    expect(manager.get("shell-denied")).toBeUndefined();
  });

  it("rejects interaction with a closed session", async () => {
    const manager = newManager();
    await manager.launch({
      sessionId: "lifecycle-fail",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: repoRoot,
      mode: "stream",
    });

    const session = manager.get("lifecycle-fail");
    expect(session?.status).toBe("active");

    await manager.close("lifecycle-fail");

    expect(manager.get("lifecycle-fail")).toBeUndefined();
    expect(session?.status).toBe("closed");
    expect(() => session?.resize(100, 40)).toThrow(/closed/);
  });

  it(
    "persists artifact bundles and trace contents for a successful captured session",
    async () => {
      const manager = newManager();
      const workspaceRoot = mkWorkspaceRoot(tempDirs, "tui-engine-artifacts-success-");

      await manager.launch({
        sessionId: "artifact-success",
        command: process.execPath,
        args: [counterPath],
        cwd: workspaceRoot,
        mode: "buffer",
        cols: 80,
        rows: 24,
      });

      const session = manager.get("artifact-success");
      expect(session).toBeDefined();

      await waitForMatch(() => session!.capture(), "Counter value: 0");
      session!.resize(100, 30);
      session!.write("+");
      await waitForMatch(() => session!.capture(), "Counter value: 1");

      const waitResult = await expectTextInSession(session!, "Counter value: 1", 3);
      expect(waitResult.isError).not.toBe(true);

      session!.write("q");
      const exitStart = Date.now();
      while (!session!.pty.exited && Date.now() - exitStart < 3000) {
        await sleep(50);
      }
      expect(session!.pty.exited).toBe(true);

      const artifact = await closeSessionWithArtifacts(manager, "artifact-success", true);
      expect(artifact).not.toBeNull();
      expect(artifact?.version).toBe(1);
      expect(artifact?.relativeArtifactDir.startsWith(path.join("artifacts", "tui-test", "artifact-success"))).toBe(true);

      const metadataPath = artifact!.files.metadata;
      const tracePath = artifact!.files.trace;
      const screenPath = artifact!.files.screen;
      const transcriptPath = artifact!.files.transcript;
      const renderedPath = artifact!.rendered?.path;

      expect(fs.existsSync(metadataPath)).toBe(true);
      expect(fs.existsSync(tracePath)).toBe(true);
      expect(fs.existsSync(screenPath)).toBe(true);
      expect(fs.existsSync(transcriptPath)).toBe(true);
      expect(renderedPath).toBeDefined();
      expect(fs.existsSync(renderedPath!)).toBe(true);

      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      const trace = JSON.parse(fs.readFileSync(tracePath, "utf-8")) as Array<{ type: string; details: Record<string, unknown> }>;

      expect(metadata.sessionId).toBe("artifact-success");
      expect(metadata.traceEventCount).toBe(trace.length);
      expect(metadata.rendered).toMatchObject({
        format: "html",
        path: renderedPath,
      });
      expect(fs.readFileSync(screenPath, "utf-8")).toContain("Counter value: 1");
      expect(fs.readFileSync(renderedPath!, "utf-8")).toContain("Counter value: 1");
      expect(fs.readFileSync(transcriptPath, "utf-8")).toContain("Counter value: 1");

      expect(trace.map((event) => event.type)).toEqual(
        expect.arrayContaining(["launch", "input", "resize", "wait", "exit", "close"])
      );
      expect(trace.find((event) => event.type === "wait")?.details).toMatchObject({
        pattern: "Counter value: 1",
        success: true,
        mode: "buffer",
      });
      expect(trace.find((event) => event.type === "close")?.details).toMatchObject({
        captureArtifacts: true,
        closedBy: "close_session",
      });
    },
    15000
  );

  it(
    "covers representative resize dimensions and captures rendered artifacts for settled buffer sessions",
    async () => {
      const manager = newManager();
      const workspaceRoot = mkWorkspaceRoot(tempDirs, "tui-engine-artifacts-layout-");

      await manager.launch({
        sessionId: "artifact-layout",
        command: process.execPath,
        args: [responsiveLayoutPath],
        cwd: workspaceRoot,
        mode: "buffer",
        cols: 72,
        rows: 16,
      });

      const session = manager.get("artifact-layout");
      expect(session).toBeDefined();

      const sizes = [
        { cols: 44, rows: 12, layout: "compact", pane: "stack" },
        { cols: 72, rows: 16, layout: "medium", pane: "split" },
        { cols: 96, rows: 20, layout: "wide", pane: "split" },
      ];

      for (const size of sizes) {
        const baseline = session!.buffer!.getScreenText();
        session!.resize(size.cols, size.rows);
        const changed = await waitForScreenChange(() => session!.buffer!.getScreenText(), {
          timeoutMs: 2000,
          pollIntervalMs: 20,
          baseline,
          mode: "buffer",
        });
        expect(changed.success).toBe(true);

        const screen = await waitForStableBuffer(session!);
        expect(screen).toContain(`layout=${size.layout} cols=${size.cols} rows=${size.rows}`);
        expect(screen).toContain(`pane=${size.pane}`);
        expect(session!.buffer!.getRegion(0, 2)).toContain(`layout=${size.layout}`);
      }

      session!.write("q");
      await waitForExit(session!);

      const artifact = await closeSessionWithArtifacts(manager, "artifact-layout", true);
      expect(artifact).not.toBeNull();
      expect(artifact?.rendered).toBeDefined();
      expect(fs.existsSync(artifact!.rendered!.path)).toBe(true);

      const rendered = fs.readFileSync(artifact!.rendered!.path, "utf-8");
      const metadata = JSON.parse(fs.readFileSync(artifact!.files.metadata, "utf-8"));
      const screen = fs.readFileSync(artifact!.files.screen, "utf-8");

      expect(metadata.rendered).toMatchObject({
        format: "html",
        path: artifact!.rendered!.path,
        relativePath: artifact!.rendered!.relativePath,
      });
      expect(screen).toContain("layout=wide cols=96 rows=20");
      expect(rendered).toContain("layout=wide cols=96 rows=20");
      expect(rendered).toContain("<!doctype html>");
    },
    15000
  );

  it(
    "returns timeout diagnostics and persists failure artifacts for a captured session",
    async () => {
      const manager = newManager();
      const workspaceRoot = mkWorkspaceRoot(tempDirs, "tui-engine-artifacts-failure-");

      await manager.launch({
        sessionId: "artifact-failure",
        command: process.execPath,
        args: [counterPath],
        cwd: workspaceRoot,
        mode: "buffer",
      });

      const session = manager.get("artifact-failure");
      expect(session).toBeDefined();
      await waitForMatch(() => session!.capture(), "Counter value: 0");

      const waitResult = await expectTextInSession(session!, "Missing text", 1);
      expect(waitResult.isError).toBe(true);
      expect(waitResult.text).toContain('Timeout after 1000ms waiting for text "Missing text"');
      expect(waitResult.text).toContain("Current buffer excerpt:");
      expect(waitResult.text).toContain("Counter value: 0");

      session!.write("q");
      const exitStart = Date.now();
      while (!session!.pty.exited && Date.now() - exitStart < 3000) {
        await sleep(50);
      }

      const artifact = await closeSessionWithArtifacts(manager, "artifact-failure", true);
      expect(artifact).not.toBeNull();
      expect(artifact?.relativeArtifactDir.startsWith(path.join("artifacts", "tui-test", "artifact-failure"))).toBe(true);

      const trace = JSON.parse(fs.readFileSync(artifact!.files.trace, "utf-8")) as Array<{ type: string; details: Record<string, unknown> }>;
      const waitEvent = trace.find((event) => event.type === "wait");

      expect(waitEvent?.details).toMatchObject({
        pattern: "Missing text",
        success: false,
        mode: "buffer",
      });
      expect(typeof waitEvent?.details.excerpt).toBe("string");
      expect(String(waitEvent?.details.excerpt)).toContain("Counter value: 0");
      expect(fs.readFileSync(artifact!.files.screen, "utf-8")).toContain("Counter value: 0");
      expect(fs.readFileSync(artifact!.files.metadata, "utf-8")).toContain("artifact-failure");
    },
    15000
  );

  it(
    "keeps parallel session environment overrides isolated",
    async () => {
      const manager = newManager();
      const previousSecret = process.env.TUI_TEST_SECRET;
      process.env.TUI_TEST_SECRET = "host-secret";

      try {
        await Promise.all([
          manager.launch({
            sessionId: "env-alpha",
            command: process.execPath,
            args: [
              "-e",
              "console.log(JSON.stringify({ token: process.env.SESSION_TOKEN ?? null, secret: process.env.TUI_TEST_SECRET ?? null })); setInterval(() => {}, 1000);",
            ],
            cwd: repoRoot,
            mode: "stream",
            isolation: {
              environment: {
                allow: ["SESSION_TOKEN"],
                set: { SESSION_TOKEN: "alpha" },
              },
            },
          }),
          manager.launch({
            sessionId: "env-beta",
            command: process.execPath,
            args: [
              "-e",
              "console.log(JSON.stringify({ token: process.env.SESSION_TOKEN ?? null, secret: process.env.TUI_TEST_SECRET ?? null })); setInterval(() => {}, 1000);",
            ],
            cwd: repoRoot,
            mode: "stream",
            isolation: {
              environment: {
                allow: ["SESSION_TOKEN"],
                set: { SESSION_TOKEN: "beta" },
              },
            },
          }),
        ]);

        const alpha = manager.get("env-alpha");
        const beta = manager.get("env-beta");

        expect(alpha).toBeDefined();
        expect(beta).toBeDefined();

        await waitForMatch(() => alpha!.capture(), '"token":"alpha"');
        await waitForMatch(() => beta!.capture(), '"token":"beta"');

        expect(parseJsonLine(alpha!.capture())).toMatchObject({
          token: "alpha",
          secret: null,
        });
        expect(parseJsonLine(beta!.capture())).toMatchObject({
          token: "beta",
          secret: null,
        });
      } finally {
        if (previousSecret === undefined) {
          delete process.env.TUI_TEST_SECRET;
        } else {
          process.env.TUI_TEST_SECRET = previousSecret;
        }
      }
    },
    15000
  );

  // Skipped on Windows: rmdir of the isolated working directory races with
  // node-pty/ConPTY releasing its handle on the child CWD, producing EBUSY
  // even with Node's fs.rmSync maxRetries/retryDelay backoff. See
  // docs/windows-support.md "Known upstream issues".
  it.skipIf(process.platform === "win32")(
    "cleans isolated working directories on close and retains them only when requested",
    async () => {
      const manager = newManager();
      const fixtureRoot = mkFixtureRoot(tempDirs, "tui-engine-isolation-");

      await manager.launch({
        sessionId: "copy-cleanup",
        command: process.execPath,
        args: ["runner.cjs", "hold"],
        cwd: fixtureRoot,
        mode: "stream",
        isolation: {
          workingDirectory: {
            mode: "copy",
            copyFrom: fixtureRoot,
          },
        },
      });

      const cleanupSession = manager.get("copy-cleanup");
      expect(cleanupSession).toBeDefined();
      await waitForMatch(() => cleanupSession!.capture(), '"fixture":"seed"');

      const cleanedPayload = parseJsonLine(cleanupSession!.capture());
      expect(cleanedPayload.cwd).not.toBe(fixtureRoot);
      expect(fs.existsSync(path.join(cleanedPayload.cwd, "created.txt"))).toBe(true);
      expect(fs.existsSync(path.join(fixtureRoot, "created.txt"))).toBe(false);

      await manager.close("copy-cleanup");
      expect(fs.existsSync(cleanedPayload.cwd)).toBe(false);

      await manager.launch({
        sessionId: "copy-retain",
        command: process.execPath,
        args: ["runner.cjs", "hold"],
        cwd: fixtureRoot,
        mode: "stream",
        isolation: {
          workingDirectory: {
            mode: "copy",
            copyFrom: fixtureRoot,
            retain: true,
          },
        },
      });

      const retainSession = manager.get("copy-retain");
      expect(retainSession).toBeDefined();
      await waitForMatch(() => retainSession!.capture(), '"fixture":"seed"');

      const retainedPayload = parseJsonLine(retainSession!.capture());
      const artifact = await closeSessionWithArtifacts(manager, "copy-retain", true);
      const retainedWorkingDirectory = artifact?.isolation?.workingDirectory;

      expect(retainedWorkingDirectory?.mode).toBe("copy");
      expect(retainedWorkingDirectory?.retain).toBe(true);
      expect(fs.realpathSync(retainedWorkingDirectory!.path)).toBe(fs.realpathSync(retainedPayload.cwd));
      expect(fs.realpathSync(retainedWorkingDirectory!.sourcePath!)).toBe(fs.realpathSync(fixtureRoot));
      expect(fs.existsSync(retainedPayload.cwd)).toBe(true);
      expect(fs.existsSync(path.join(retainedPayload.cwd, "created.txt"))).toBe(true);
    },
    15000
  );

  it(
    "cleans isolated working directories after unexpected process exit",
    async () => {
      const manager = newManager();
      const fixtureRoot = mkFixtureRoot(tempDirs, "tui-engine-isolation-fail-");

      await manager.launch({
        sessionId: "copy-failure-cleanup",
        command: process.execPath,
        args: ["runner.cjs", "fail"],
        cwd: fixtureRoot,
        mode: "stream",
        isolation: {
          workingDirectory: {
            mode: "copy",
            copyFrom: fixtureRoot,
          },
        },
      });

      const session = manager.get("copy-failure-cleanup");
      expect(session).toBeDefined();
      await waitForMatch(() => session!.capture(), '"fixture":"seed"');

      const payload = parseJsonLine(session!.capture());
      await waitForExit(session!);

      expect(session!.pty.exitCode).toBe(1);
      expect(fs.existsSync(payload.cwd)).toBe(false);
    },
    15000
  );
});
