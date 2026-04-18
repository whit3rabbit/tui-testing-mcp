import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureNodePtyHelperPermissions, getTerminalName } from "./pty.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureNodePtyHelperPermissions", () => {
  // node-pty on Windows uses ConPTY and does not ship a spawn-helper binary,
  // so the repair path returns [] unconditionally (see src/core/pty.ts).
  it.skipIf(process.platform === "win32")("restores execute bits on spawn-helper binaries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-pty-"));
    tempDirs.push(root);

    const helperPath = path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, "helper");
    fs.chmodSync(helperPath, 0o644);

    const repaired = ensureNodePtyHelperPermissions(root);
    const mode = fs.statSync(helperPath).mode & 0o777;

    expect(repaired).toEqual([helperPath]);
    expect(mode & 0o111).not.toBe(0);
  });
});

describe("getTerminalName", () => {
  it("uses a conservative terminal id on Windows", () => {
    expect(getTerminalName("win32")).toBe("xterm");
  });

  it("keeps the richer xterm profile on POSIX", () => {
    expect(getTerminalName("darwin")).toBe("xterm-256color");
  });
});
