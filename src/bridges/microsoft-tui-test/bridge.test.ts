import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMicrosoftTuiTestBridge } from "./bridge.js";
import type { ResolvedBridge } from "./resolve.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Writes a tiny JS "CLI" into a temp package and returns a stub that mimics
 * resolveMicrosoftTuiTest. The CLI runs on the real Node binary so the
 * integration exercise covers spawn, stdout capture, and exit handling.
 */
function installFakeCli(cwd: string, body: string): ResolvedBridge {
  const pkgDir = path.join(cwd, ".fake-tui-test");
  fs.mkdirSync(pkgDir, { recursive: true });
  const cliPath = path.join(pkgDir, "cli.js");
  fs.writeFileSync(cliPath, body);
  return {
    packageDir: pkgDir,
    packageJsonPath: path.join(pkgDir, "package.json"),
    cliPath,
    version: "0.0.0-test",
  };
}

function writeConfig(cwd: string, name = "tui-test.config.js") {
  fs.writeFileSync(path.join(cwd, name), "module.exports = { testDir: 'tests' };\n");
}

describe("runMicrosoftTuiTestBridge", () => {
  it("returns missing_dependency when the package cannot be resolved", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-missing-"));
    tempDirs.push(cwd);

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      resolveFn: () => null,
    });

    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("missing_dependency");
    expect(result.error?.message).toContain("@microsoft/tui-test");
    expect(result.exitCode).toBeNull();
  });

  it("returns incompatible_project when no config file and no pattern are provided", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-incompat-"));
    tempDirs.push(cwd);

    const resolved = installFakeCli(cwd, "process.exit(0);\n");

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      resolveFn: () => resolved,
    });

    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("incompatible_project");
    expect(result.error?.message).toContain("tui-test.config");
  });

  it("translates a successful CLI run into a structured result with summary and artifacts", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-ok-"));
    tempDirs.push(cwd);
    writeConfig(cwd);

    // Fake CLI: print Playwright-style counters and a trace artifact, then exit 0.
    const body = [
      `const fs = require('node:fs');`,
      `const path = require('node:path');`,
      `process.stdout.write('Running 7 tests using 1 worker\\n');`,
      `process.stdout.write('5 passed, 1 failed, 1 skipped (3.2s)\\n');`,
      `const dir = path.join(process.cwd(), 'test-results');`,
      `fs.mkdirSync(dir, { recursive: true });`,
      `fs.writeFileSync(path.join(dir, 'trace.zip'), 'fake');`,
      `process.exit(0);`,
    ].join("\n");
    const resolved = installFakeCli(cwd, body);

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      resolveFn: () => resolved,
    });

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toEqual({ passed: 5, failed: 1, skipped: 1, total: 7 });
    expect(result.artifacts.traces.some((p) => p.endsWith("trace.zip"))).toBe(true);
    expect(result.stdout).toContain("5 passed");
    expect(result.command?.args[0]).toBe(resolved.cliPath);
    // Ensure --config was passed through the resolved config file.
    expect(result.command?.args).toContain("--config");
  });

  it("marks the result as failure when the CLI exits non-zero", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-fail-"));
    tempDirs.push(cwd);
    writeConfig(cwd);

    const body = [
      `process.stderr.write('boom\\n');`,
      `process.stdout.write('0 passed, 2 failed\\n');`,
      `process.exit(2);`,
    ].join("\n");
    const resolved = installFakeCli(cwd, body);

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      resolveFn: () => resolved,
    });

    expect(result.status).toBe("failure");
    expect(result.exitCode).toBe(2);
    expect(result.summary?.failed).toBe(2);
    expect(result.stderr).toContain("boom");
    expect(result.error).toBeUndefined();
  });

  it("accepts an explicit pattern without a config file", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-pattern-"));
    tempDirs.push(cwd);

    const body = `process.stdout.write('1 passed\\n'); process.exit(0);`;
    const resolved = installFakeCli(cwd, body);

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      pattern: "tests/smoke.test.ts",
      resolveFn: () => resolved,
    });

    expect(result.status).toBe("success");
    expect(result.command?.args).toContain("tests/smoke.test.ts");
    expect(result.command?.args).not.toContain("--config");
  });

  it("treats timeouts as execution_failed", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-timeout-"));
    tempDirs.push(cwd);
    writeConfig(cwd);

    // Sleep longer than the bridge timeout.
    const body = `setTimeout(() => process.exit(0), 5000);`;
    const resolved = installFakeCli(cwd, body);

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      timeoutMs: 100,
      resolveFn: () => resolved,
    });

    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("execution_failed");
    expect(result.error?.message).toMatch(/timed out/i);
  });

  it("fails with partial output when the bridge exceeds the output cap", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tui-bridge-output-cap-"));
    tempDirs.push(cwd);
    writeConfig(cwd);

    const body = `process.stdout.write('z'.repeat(256)); setTimeout(() => process.exit(0), 5000);`;
    const resolved = installFakeCli(cwd, body);

    const result = await runMicrosoftTuiTestBridge({
      cwd,
      env: process.env,
      maxOutputBytes: 128,
      resolveFn: () => resolved,
    });

    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("execution_failed");
    expect(result.error?.message).toMatch(/output limit/i);
    expect(result.stdout).toContain("[stdout truncated after 128 bytes, process terminated]");
  });
});
