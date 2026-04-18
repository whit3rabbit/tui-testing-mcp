import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_BUNDLE_VERSION,
  captureAndPersistArtifacts,
  persistArtifacts,
  redactArtifact,
  type SessionArtifactBundle,
} from "./artifacts.js";
import { Session } from "./core/session.js";
import type { PtyInstance } from "./core/pty.js";
import { SecurityPolicyManager } from "./security/manager.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

class FakePty extends EventEmitter {
  pid = 4321;
  exited = false;
  exitCode: number | null = 0;
  write() {}
  resize() {}
  dispose() { this.exited = true; }
}

function buildBundle(workspaceRoot: string, sessionId: string, timestamp: number): SessionArtifactBundle {
  const stamp = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.join(workspaceRoot, "artifacts", "tui-test", sessionId, stamp);
  const files = {
    metadata: path.join(artifactDir, "metadata.json"),
    trace: path.join(artifactDir, "trace.json"),
    screen: path.join(artifactDir, "screen.txt"),
    transcript: path.join(artifactDir, "transcript.ansi"),
  };
  const relativeDir = path.join("artifacts", "tui-test", sessionId, stamp);
  const relativeFiles = {
    metadata: path.join(relativeDir, "metadata.json"),
    trace: path.join(relativeDir, "trace.json"),
    screen: path.join(relativeDir, "screen.txt"),
    transcript: path.join(relativeDir, "transcript.ansi"),
  };

  return {
    metadata: {
      version: ARTIFACT_BUNDLE_VERSION,
      sessionId,
      capturedAt: new Date(timestamp).toISOString(),
      mode: "stream",
      exitCode: 0,
      dimensions: { cols: 80, rows: 24 },
      workspaceRoot,
      artifactDir,
      relativeArtifactDir: relativeDir,
      files,
      relativeFiles,
      traceEventCount: 0,
    },
    trace: [],
    screen: "ok\n",
    transcript: "hello sk-TESTTOKENAAAAAAAAAAAAAAAAAAAAAAAA world\n",
  };
}

function buildBufferBundle(workspaceRoot: string, sessionId: string, timestamp: number): SessionArtifactBundle {
  const bundle = buildBundle(workspaceRoot, sessionId, timestamp);
  bundle.metadata.mode = "buffer";
  bundle.metadata.rendered = {
    format: "html",
    path: path.join(bundle.metadata.artifactDir, "screen.html"),
    relativePath: path.join(bundle.metadata.relativeArtifactDir, "screen.html"),
  };
  bundle.renderedScreen =
    "<!doctype html>\n<pre>secret sk-TESTTOKENAAAAAAAAAAAAAAAAAAAAAAAA world</pre>\n";
  return bundle;
}

describe("redactArtifact", () => {
  it("redacts common token shapes", () => {
    const text = "use sk-TESTTOKENAAAAAAAAAAAAAAAAAAAAAAAA here";
    const out = redactArtifact(text, [/\b(?:sk|ghp)[-_][A-Za-z0-9]{20,}\b/g]);
    expect(out).not.toContain("sk-TESTTOKENAAAA");
    expect(out).toContain("[REDACTED]");
  });

  it("leaves innocuous text untouched", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    expect(redactArtifact(text, [/AKIA[0-9A-Z]{16}/g])).toBe(text);
  });

  it("reuses global regex redactors safely across calls", () => {
    const pattern = /\b(?:sk|ghp)[-_][A-Za-z0-9]{20,}\b/g;

    expect(redactArtifact("use sk-TESTTOKENAAAAAAAAAAAAAAAAAAAAAAAA here", [pattern])).toContain("[REDACTED]");
    expect(redactArtifact("nothing to scrub here", [pattern])).toBe("nothing to scrub here");
    expect(redactArtifact("use sk-TESTTOKENBBBBBBBBBBBBBBBBBBBBBBBB here", [pattern])).toContain("[REDACTED]");
  });
});

describe("persistArtifacts", () => {
  it("writes files with 0o600 perms and redacts default token shapes", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-artifact-mode-"));
    tempDirs.push(workspaceRoot);
    const bundle = buildBundle(workspaceRoot, "session-a", Date.now());
    const security = new SecurityPolicyManager({ workspaceRoot });

    const metadata = persistArtifacts(bundle, security);

    for (const file of Object.values(metadata.files)) {
      const stat = fs.statSync(file);
      expect(stat.mode & 0o777).toBe(0o600);
    }

    const dirStat = fs.statSync(metadata.artifactDir);
    // Directory must be owner-only (mkdir mode interacts with umask, so
    // allow any subset of 0o700 that excludes group/other access).
    expect(dirStat.mode & 0o077).toBe(0);

    const transcript = fs.readFileSync(metadata.files.transcript, "utf-8");
    expect(transcript).not.toMatch(/sk-TESTTOKEN/);
    expect(transcript).toContain("[REDACTED]");
  });

  it("prunes old bundles when retention.maxBundles is configured", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-artifact-retention-"));
    tempDirs.push(workspaceRoot);
    const security = new SecurityPolicyManager({
      workspaceRoot,
      artifactRetention: { maxBundles: 2 },
    });

    const base = Date.now() - 10 * 60 * 60 * 1000;
    persistArtifacts(buildBundle(workspaceRoot, "ret", base + 1_000), security);
    persistArtifacts(buildBundle(workspaceRoot, "ret", base + 2_000), security);
    const latest = persistArtifacts(buildBundle(workspaceRoot, "ret", base + 3_000), security);

    const sessionRoot = path.dirname(latest.artifactDir);
    const remaining = fs.readdirSync(sessionRoot);
    expect(remaining.length).toBe(2);
    // The newest bundle must always survive pruning.
    expect(remaining.some((d) => path.join(sessionRoot, d) === latest.artifactDir)).toBe(true);
  });

  it("throws on invalid artifactRedactions pattern instead of silently skipping", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-artifact-invalid-"));
    tempDirs.push(workspaceRoot);

    // SecurityPolicyManager validates patterns at construction time
    expect(() => {
      new SecurityPolicyManager({
        workspaceRoot,
        artifactRedactions: ["[invalid"], // Invalid regex - missing closing bracket
      });
    }).toThrow(/Invalid artifact redaction pattern/);
  });

  it("writes and redacts rendered buffer snapshots when present", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-artifact-rendered-"));
    tempDirs.push(workspaceRoot);
    const bundle = buildBufferBundle(workspaceRoot, "session-buffer", Date.now());
    const security = new SecurityPolicyManager({ workspaceRoot });

    const metadata = persistArtifacts(bundle, security);

    expect(metadata.rendered).toBeDefined();
    expect(fs.existsSync(metadata.rendered!.path)).toBe(true);
    const html = fs.readFileSync(metadata.rendered!.path, "utf-8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("[REDACTED]");
    expect(html).not.toContain("sk-TESTTOKEN");
  });

  it("replaces oversized rendered buffer snapshots with a bounded omission page", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-artifact-rendered-cap-"));
    tempDirs.push(workspaceRoot);
    const bundle = buildBufferBundle(workspaceRoot, "session-buffer-cap", Date.now());
    bundle.renderedScreen = "<!doctype html>\n<pre>" + "x".repeat(1024 * 1024 + 256) + "</pre>\n";
    const security = new SecurityPolicyManager({ workspaceRoot });

    const metadata = persistArtifacts(bundle, security);
    const html = fs.readFileSync(metadata.rendered!.path, "utf-8");

    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(1024 * 1024);
    expect(html).toContain("Rendered snapshot omitted");
    expect(html).not.toContain("x".repeat(64));
  });

  it("captures and persists a live session without storing raw typed input in trace output", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-artifact-live-"));
    tempDirs.push(workspaceRoot);
    const security = new SecurityPolicyManager({ workspaceRoot });
    const pty = new FakePty();
    const session = new Session(
      "session-live",
      pty as unknown as PtyInstance,
      80,
      24,
      undefined,
      "stream",
      workspaceRoot,
      security
    );

    pty.emit("data", "hello sk-TESTTOKENAAAAAAAAAAAAAAAAAAAAAAAA world\n");
    session.write("typed-secret\n");

    const metadata = captureAndPersistArtifacts(session, security, Date.now());

    const trace = fs.readFileSync(metadata.files.trace, "utf-8");
    const transcript = fs.readFileSync(metadata.files.transcript, "utf-8");

    expect(trace).toContain("\"type\": \"input\"");
    expect(trace).toContain("\"length\": 13");
    expect(trace).not.toContain("typed-secret");
    expect(transcript).toContain("[REDACTED]");
    expect(transcript).not.toContain("sk-TESTTOKEN");
  });
});
