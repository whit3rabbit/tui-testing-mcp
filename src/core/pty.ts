/**
 * PTY (Pseudo-Terminal) abstraction.
 * Wraps node-pty to provide a cleanup-aware process handle.
 */
import pty from "node-pty";
import * as events from "events";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

export interface PtyOptions {
  file: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyState {
  readonly pid: number;
  readonly fd: number;
  readonly isMaster: boolean;
  readonly isChild: boolean;
}

const require = createRequire(import.meta.url);
let helperPermissionsChecked = false;

/**
 * Wraps node-pty to provide PTY process handling.
 * Each PtyInstance manages a single pseudo-terminal process.
 */
export class PtyInstance extends events.EventEmitter {
  private readonly ptyProcess: pty.IPty;
  private _exited = false;
  private _exitCode: number | null = null;

  constructor(options: PtyOptions) {
    super();
    ensureNodePtyHelperPermissions();

    this.ptyProcess = pty.spawn(options.file, options.args ?? [], {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
    });

    this.ptyProcess.onData((data: string) => {
      this.emit("data", data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this._exited = true;
      this._exitCode = exitCode;
      this.emit("exit", exitCode);
    });
  }

  get pid(): number {
    return this.ptyProcess.pid;
  }

  get state(): PtyState {
    return {
      pid: this.ptyProcess.pid,
      fd: 0,
      isMaster: true,
      isChild: false,
    };
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Write data to the PTY (simulates user input).
   */
  write(data: string): void {
    if (!this._exited) {
      this.ptyProcess.write(data);
    }
  }

  /**
   * Resize the PTY terminal.
   */
  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
  }

  /**
   * Kill the PTY process.
   */
  kill(signal?: string): void {
    if (!this._exited) {
      if (process.platform !== "win32") {
        try {
          // Send signal to the negative PID to kill the process group
          process.kill(-this.ptyProcess.pid, signal || "SIGKILL");
        } catch (error: unknown) {
          // Fallback to normal kill if process group kill fails (e.g. ESRCH)
          const errorCode =
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : undefined;
          if (errorCode !== "ESRCH") {
            this.ptyProcess.kill(signal);
          }
        }
      } else {
        this.ptyProcess.kill(signal);
      }
    }
  }

  /**
   * Dispose of the PTY process.
   */
  dispose(): void {
    this.kill();
    this.removeAllListeners();
  }
}

/**
 * Create a new PTY instance with the given options.
 */
export function spawnPty(options: PtyOptions): PtyInstance {
  return new PtyInstance(options);
}

/**
 * Ensure node-pty's macOS spawn helpers are executable.
 * npm installs on some systems can lose the execute bit on these binaries.
 */
export function ensureNodePtyHelperPermissions(packageRoot?: string): string[] {
  if (process.platform === "win32") {
    helperPermissionsChecked = true;
    return [];
  }

  if (helperPermissionsChecked && !packageRoot) {
    return [];
  }

  const root = packageRoot ?? path.dirname(require.resolve("node-pty/package.json"));
  const helpers = [
    path.join(root, "build", "Release", "spawn-helper"),
    path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ];

  const repaired: string[] = [];
  for (const helperPath of helpers) {
    if (!fs.existsSync(helperPath)) {
      continue;
    }

    const stats = fs.statSync(helperPath);
    if ((stats.mode & 0o111) !== 0) {
      continue;
    }

    fs.chmodSync(helperPath, stats.mode | 0o755);
    repaired.push(helperPath);
  }

  if (!packageRoot) {
    helperPermissionsChecked = true;
  }

  return repaired;
}
