import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMicrosoftTuiTest } from "./resolve.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Create a minimal fake @microsoft/tui-test install under <root>/node_modules
 * and return the project dir a caller should resolve from.
 */
function installFakeBridge(
  root: string,
  opts: { bin?: unknown; missingCli?: boolean; packageJson?: unknown } = {}
): string {
  const pkgDir = path.join(root, "node_modules", "@microsoft", "tui-test");
  fs.mkdirSync(pkgDir, { recursive: true });
  const pkg = opts.packageJson ?? {
    name: "@microsoft/tui-test",
    version: "0.0.0-test",
    bin: opts.bin ?? { "tui-test": "./cli.js" },
  };
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg));
  if (!opts.missingCli) {
    fs.writeFileSync(path.join(pkgDir, "cli.js"), "#!/usr/bin/env node\n");
  }
  return pkgDir;
}

describe("resolveMicrosoftTuiTest", () => {
  it("returns null when @microsoft/tui-test is not installed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-resolve-missing-"));
    tempDirs.push(root);

    expect(resolveMicrosoftTuiTest(root)).toBeNull();
  });

  it("locates a bin entry keyed by the canonical name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-resolve-ok-"));
    tempDirs.push(root);
    const pkgDir = installFakeBridge(root);

    const resolved = resolveMicrosoftTuiTest(root);
    expect(resolved).not.toBeNull();
    expect(resolved!.packageDir).toBe(fs.realpathSync(pkgDir));
    expect(resolved!.cliPath).toBe(path.join(fs.realpathSync(pkgDir), "cli.js"));
    expect(resolved!.version).toBe("0.0.0-test");
  });

  it("accepts a string bin field", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-resolve-str-bin-"));
    tempDirs.push(root);
    installFakeBridge(root, { bin: "./cli.js" });

    expect(resolveMicrosoftTuiTest(root)!.cliPath).toMatch(/cli\.js$/);
  });

  it("returns null when the bin file is missing on disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-resolve-no-cli-"));
    tempDirs.push(root);
    installFakeBridge(root, { missingCli: true });

    expect(resolveMicrosoftTuiTest(root)).toBeNull();
  });

  it("returns null when package.json omits a bin entry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-resolve-no-bin-"));
    tempDirs.push(root);
    installFakeBridge(root, {
      packageJson: { name: "@microsoft/tui-test", version: "0.0.0-test" },
    });

    expect(resolveMicrosoftTuiTest(root)).toBeNull();
  });
});
