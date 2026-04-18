import { describe, expect, it } from "vitest";
import {
  SUPPORTED_SHELLS,
  buildShellInvocation,
  getShellAdapter,
  inferShellName,
  resolveShell,
} from "./index.js";

describe("shell adapter registry", () => {
  it("exposes the documented supported shells", () => {
    expect([...SUPPORTED_SHELLS].sort()).toEqual(["bash", "cmd", "fish", "sh", "zsh"]);
  });

  it("returns adapters by id", () => {
    for (const id of SUPPORTED_SHELLS) {
      const adapter = getShellAdapter(id);
      expect(adapter?.id).toBe(id);
    }
  });

  it("returns undefined for unsupported shells", () => {
    expect(getShellAdapter("powershell")).toBeUndefined();
    expect(getShellAdapter("")).toBeUndefined();
  });

  it("infers shell name from a SHELL-style path basename", () => {
    expect(inferShellName("/bin/bash")).toBe("bash");
    expect(inferShellName("/usr/local/bin/zsh")).toBe("zsh");
    expect(inferShellName("/usr/bin/fish")).toBe("fish");
    expect(inferShellName("/bin/sh")).toBe("sh");
    expect(inferShellName(undefined)).toBeUndefined();
    expect(inferShellName("")).toBeUndefined();
    expect(inferShellName("/usr/bin/csh")).toBeUndefined();
  });
});

describe("resolveShell", () => {
  it("prefers an explicit shell name over defaults and env", () => {
    const result = resolveShell({ name: "bash" }, "/usr/bin/zsh", { name: "fish" });
    expect(result.adapter.id).toBe("bash");
  });

  it("falls through explicit → defaults → env → platform fallback", () => {
    // Platform fallback is cmd on win32 and sh elsewhere (see DEFAULT_FALLBACK_SHELL in ./index.ts).
    const fallback = process.platform === "win32" ? "cmd" : "sh";
    expect(resolveShell(undefined, undefined, undefined).adapter.id).toBe(fallback);
    expect(resolveShell(undefined, "/bin/zsh", undefined).adapter.id).toBe("zsh");
    expect(resolveShell(undefined, "/bin/zsh", { name: "bash" }).adapter.id).toBe("bash");
  });

  it("uses envShell as the path when it matches the resolved adapter", () => {
    const result = resolveShell(undefined, "/opt/homebrew/bin/zsh", undefined);
    expect(result.adapter.id).toBe("zsh");
    expect(result.path).toBe("/opt/homebrew/bin/zsh");
  });

  it("falls back to adapter.defaultPath when envShell is for a different shell", () => {
    const result = resolveShell({ name: "fish" }, "/bin/bash", undefined);
    expect(result.adapter.id).toBe("fish");
    expect(result.path).toBe("/usr/bin/fish");
  });

  it("honors an explicit shell path override", () => {
    const result = resolveShell({ name: "bash", path: "/opt/local/bin/bash" }, "/bin/bash", undefined);
    expect(result.path).toBe("/opt/local/bin/bash");
  });

  it("defaults login=true to preserve historical behavior", () => {
    expect(resolveShell(undefined, "/bin/bash", undefined).login).toBe(true);
  });

  it("respects explicit login=false even when defaults set login=true", () => {
    const result = resolveShell({ login: false }, "/bin/bash", { login: true });
    expect(result.login).toBe(false);
  });

  it("rejects unsupported shell ids with the supported set in the message", () => {
    expect(() => resolveShell({ name: "powershell" }, "/bin/bash", undefined)).toThrow(
      /Unsupported shell 'powershell'.*sh, bash, zsh, fish, cmd/
    );
  });
});

describe("buildShellInvocation", () => {
  it("builds combined -lc argv for bourne-style shells in login mode", () => {
    const resolution = resolveShell({ name: "bash" }, "/bin/bash", undefined);
    const invocation = buildShellInvocation("echo hi", resolution);
    expect(invocation.command).toBe("/bin/bash");
    expect(invocation.args).toEqual(["-lc", "echo hi"]);
  });

  it("builds -c argv for bourne-style shells in non-login mode", () => {
    const resolution = resolveShell({ name: "zsh", login: false }, "/bin/zsh", undefined);
    const invocation = buildShellInvocation("echo hi", resolution);
    expect(invocation.args).toEqual(["-c", "echo hi"]);
  });

  it("builds separate -l -c argv for fish in login mode", () => {
    const resolution = resolveShell({ name: "fish", login: true }, undefined, undefined);
    const invocation = buildShellInvocation("echo hi", resolution);
    expect(invocation.command).toBe("/usr/bin/fish");
    expect(invocation.args).toEqual(["-l", "-c", "echo hi"]);
  });

  it("rejects empty command strings before any process is spawned", () => {
    const resolution = resolveShell({ name: "bash" }, "/bin/bash", undefined);
    expect(() => buildShellInvocation("   ", resolution)).toThrow(/non-empty/);
    expect(() => buildShellInvocation("", resolution)).toThrow(/non-empty/);
  });

  it("builds cmd /c argv for Windows shell launches", () => {
    const resolution = resolveShell({ name: "cmd" }, undefined, undefined);
    const invocation = buildShellInvocation("echo hi", resolution);
    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args).toEqual(["/c", "echo hi"]);
  });
});
