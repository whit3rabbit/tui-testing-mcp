import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandPathCandidates,
  isArgvSafe,
  isCommandAllowed,
  isShellAllowed,
  isShellEvalAllowed,
  isWithinWorkspace,
} from "./policy.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("isWithinWorkspace", () => {
  it("accepts nested paths inside the workspace", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tui-policy-"));
    tempDirs.push(workspaceRoot);
    const nestedPath = path.join(workspaceRoot, "nested", "file.txt");

    expect(isWithinWorkspace({ workspaceRoot }, nestedPath)).toBe(true);
  });

  it("rejects sibling paths that share the same prefix", () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-policy-parent-"));
    tempDirs.push(parentDir);

    const workspaceRoot = path.join(parentDir, "workspace");
    const siblingRoot = path.join(parentDir, "workspace-evil");
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(siblingRoot);

    expect(isWithinWorkspace({ workspaceRoot }, siblingRoot)).toBe(false);
  });
});

describe("isCommandAllowed", () => {
  const workspaceRoot = process.cwd();

  it("treats a bare name as a basename rule matching every resolved location", () => {
    // /bin/bash and /usr/bin/bash both have basename "bash"; the rule
    // must catch both without listing every absolute path explicitly.
    expect(
      isCommandAllowed({ workspaceRoot, deniedCommands: ["bash"] }, "/bin/bash")
    ).toBe(false);
    expect(
      isCommandAllowed({ workspaceRoot, deniedCommands: ["bash"] }, "/usr/bin/bash")
    ).toBe(false);
  });

  it("treats a path-containing rule as an exact realpath rule", () => {
    // "/bin/bash" blocks /bin/bash but not /usr/bin/bash unless they
    // happen to symlink to the same binary.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-cmd-"));
    tempDirs.push(dir);
    const real = path.join(dir, "real-bin");
    fs.writeFileSync(real, "#!/bin/sh\n", { mode: 0o755 });

    expect(isCommandAllowed({ workspaceRoot, deniedCommands: [real] }, real)).toBe(false);
    const other = path.join(dir, "other-bin");
    fs.writeFileSync(other, "#!/bin/sh\n", { mode: 0o755 });
    expect(isCommandAllowed({ workspaceRoot, deniedCommands: [real] }, other)).toBe(true);
  });

  it("resolves symlinks so a renamed symlink to bash still matches a bash rule", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-cmd-symlink-"));
    tempDirs.push(dir);
    const target = path.join(dir, "bash");
    fs.writeFileSync(target, "#!/bin/sh\n", { mode: 0o755 });
    const link = path.join(dir, "sh-alias");
    fs.symlinkSync(target, link);

    // The rule is "bash" - the basename of the realpath of sh-alias
    // resolves to bash, so the rule catches it.
    expect(
      isCommandAllowed({ workspaceRoot, deniedCommands: ["bash"] }, link)
    ).toBe(false);
  });

  it("enforces allowlist: unlisted commands are denied when allowedCommands is non-empty", () => {
    expect(
      isCommandAllowed({ workspaceRoot, allowedCommands: ["node"] }, "/bin/sh")
    ).toBe(false);
    expect(
      isCommandAllowed({ workspaceRoot, allowedCommands: ["node"] }, process.execPath)
    ).toBe(true);
  });

  it("returns true when no policy is configured", () => {
    expect(isCommandAllowed({ workspaceRoot }, "/bin/sh")).toBe(true);
  });

  it("matches bare Windows command rules case-insensitively and without requiring .exe", () => {
    expect(
      isCommandAllowed(
        { workspaceRoot, deniedCommands: ["node"] },
        "C:\\Tools\\Node.EXE",
        { PATHEXT: ".COM;.EXE;.BAT;.CMD" }
      )
    ).toBe(false);
    expect(
      isCommandAllowed(
        { workspaceRoot, deniedCommands: ["npm.cmd"] },
        "C:\\Tools\\NPM.CMD",
        { PATHEXT: ".COM;.EXE;.BAT;.CMD" }
      )
    ).toBe(false);
  });

  it("treats absolute Windows path rules as exact matches even across case differences", () => {
    expect(
      isCommandAllowed(
        { workspaceRoot, deniedCommands: ["C:\\TOOLS\\Node.EXE"] },
        "c:\\tools\\node.exe",
        { PATHEXT: ".COM;.EXE;.BAT;.CMD" }
      )
    ).toBe(false);
  });
});

describe("commandPathCandidates", () => {
  it("expands bare Windows commands through PATHEXT", () => {
    expect(
      commandPathCandidates("node", { PATHEXT: ".EXE;.CMD" }, "win32")
    ).toEqual(["node", "node.EXE", "node.CMD"]);
  });

  it("keeps explicit Windows executable names unchanged", () => {
    expect(commandPathCandidates("npm.cmd", undefined, "win32")).toEqual(["npm.cmd"]);
  });
});

describe("shell gating predicates", () => {
  const workspaceRoot = process.cwd();

  it("isShellAllowed reflects allowShell only", () => {
    expect(isShellAllowed({ workspaceRoot })).toBe(false);
    expect(isShellAllowed({ workspaceRoot, allowShell: true })).toBe(true);
  });

  it("isShellEvalAllowed requires both allowShell and allowShellEval", () => {
    expect(isShellEvalAllowed({ workspaceRoot, allowShell: true })).toBe(false);
    expect(
      isShellEvalAllowed({ workspaceRoot, allowShell: false, allowShellEval: true })
    ).toBe(false);
    expect(
      isShellEvalAllowed({ workspaceRoot, allowShell: true, allowShellEval: true })
    ).toBe(true);
  });
});

describe("isArgvSafe", () => {
  const workspaceRoot = process.cwd();

  // Test with a policy that has active command restrictions
  const allowlistPolicy = { workspaceRoot, allowedCommands: ["node", "python", "python3", "git", "bash", "sh"] };
  const _denylistPolicy = { workspaceRoot, deniedCommands: ["node", "python"] };

  it("returns true for non-risky commands regardless of args", () => {
    expect(isArgvSafe(allowlistPolicy, "/bin/ls", ["-la"])).toBe(true);
    expect(isArgvSafe(allowlistPolicy, "/bin/cat", ["file.txt"])).toBe(true);
  });

  it("blocks dangerous node flags", () => {
    expect(isArgvSafe(allowlistPolicy, "node", ["-e", "console.log(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["-econsole.log(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--eval", "console.log(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--eval=console.log(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["-r", "child_process"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["-rchild_process"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--require", "child_process"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--require=child_process"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["-pe", "process.pid"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--experimental-vm-modules"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--inspect=9229"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "node", ["--import", "data:..."])).toBe(false);
  });

  it("blocks dangerous python flags", () => {
    expect(isArgvSafe(allowlistPolicy, "python", ["-c", "print(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python", ["-cprint(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python3", ["--command", "print(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python3", ["--command=print(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python3", ["-i"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python", ["-m", "http.server"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python", ["-mhttp.server"])).toBe(false);
  });

  it("blocks dangerous git flags", () => {
    expect(isArgvSafe(allowlistPolicy, "git", ["--upload-pack=/bin/sh"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "git", ["--upload-pack=foo"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "git", ["--receive-pack=/bin/sh"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "git", ["--exec=/bin/sh"])).toBe(false);
  });

  it("blocks shell -c invocation", () => {
    expect(isArgvSafe(allowlistPolicy, "bash", ["-c", "ls"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "bash", ["-cls"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "sh", ["-c", "ls"])).toBe(false);
    // On Debian/Ubuntu `/bin/sh` symlinks to `dash`, so the realpath-based
    // lookup resolves to `dash`. That must not leave shell -c unguarded.
    expect(isArgvSafe(allowlistPolicy, "dash", ["-c", "ls"])).toBe(false);
    // If the input resolves to a basename we don't recognize, the check
    // still blocks based on the input-basename lookup alone.
    expect(isArgvSafe(allowlistPolicy, "/nonexistent/path/to/sh", ["-c", "ls"])).toBe(false);
  });

  it("does not let dangerous flags hide behind --", () => {
    expect(isArgvSafe(allowlistPolicy, "node", ["--", "--eval=console.log(1)"])).toBe(false);
    expect(isArgvSafe(allowlistPolicy, "python", ["--", "-cprint(1)"])).toBe(false);
  });

  it("blocks interpreter loader env tricks when an active policy exists", () => {
    expect(
      isArgvSafe(allowlistPolicy, "node", ["script.js"], { NODE_OPTIONS: "--require ./evil.js" })
    ).toBe(false);
    expect(
      isArgvSafe(allowlistPolicy, "python", ["script.py"], { PYTHONSTARTUP: "./evil.py" })
    ).toBe(false);
    expect(
      isArgvSafe(allowlistPolicy, "bash", ["script.sh"], { BASH_ENV: "./evil.sh" })
    ).toBe(false);
    expect(
      isArgvSafe(allowlistPolicy, "git", ["status"], { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.pager", GIT_CONFIG_VALUE_0: "sh -c id" })
    ).toBe(false);
  });

  it("allows safe node usage", () => {
    expect(isArgvSafe(allowlistPolicy, "node", ["--version"])).toBe(true);
    expect(isArgvSafe(allowlistPolicy, "node", ["script.js"])).toBe(true);
  });

  it("allows safe python usage", () => {
    expect(isArgvSafe(allowlistPolicy, "python", ["--version"])).toBe(true);
    expect(isArgvSafe(allowlistPolicy, "python", ["script.py"])).toBe(true);
  });

  it("allows safe git usage", () => {
    expect(isArgvSafe(allowlistPolicy, "git", ["status"])).toBe(true);
    expect(isArgvSafe(allowlistPolicy, "git", ["log", "--oneline"])).toBe(true);
  });

  it("handles Windows interpreter names when checking dangerous flags", () => {
    expect(
      isArgvSafe(
        allowlistPolicy,
        "C:\\Python\\PYTHON.EXE",
        ["-c", "print(1)"],
        { PATHEXT: ".COM;.EXE;.BAT;.CMD" }
      )
    ).toBe(false);
  });

  it("returns true when no policy is configured (allows legitimate test invocations)", () => {
    // This is important: without a policy, dangerous flags are allowed
    // because the command itself would be allowed anyway
    const noPolicy = { workspaceRoot };
    expect(isArgvSafe(noPolicy, "node", ["-e", "console.log(1)"])).toBe(true);
    expect(isArgvSafe(noPolicy, "python", ["-c", "print(1)"])).toBe(true);
  });
});
