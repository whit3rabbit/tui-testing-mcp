import { PtyInstance, spawnPty, PtyOptions } from "./pty.js";
import { TerminalBuffer, createBuffer } from "./buffer.js";
import { loadConfig } from "../config/load.js";
import type { SessionIsolationConfig, WorkingDirectoryIsolationConfig } from "../config/schema.js";
import { SecurityPolicyManager } from "../security/manager.js";
import type { ShellLaunchOptions } from "../shell/index.js";
import { resolveLaunch } from "./session-launch.js";
import {
  cleanupIsolation,
  cloneIsolationState,
  prepareSessionIsolation,
} from "./session-isolation.js";
import { stripAnsi } from "../utils.js";

const MAX_TRANSCRIPT_LENGTH = 1024 * 1024; // 1MB rolling buffer
const MAX_TRACE_EVENTS = 4096; // rolling event history

/** Session capture mode: stream (raw transcript) or buffer (grid snapshot). */
export type SessionMode = "stream" | "buffer";

/** Current lifecycle state of a session. */
export type SessionStatus = "active" | "exited" | "closed";

/** Internal configuration used to spawn a PTY. */
export interface SessionConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  mode: SessionMode;
}

/** Parameters for launching or re-registering a session. */
export interface LaunchConfig {
  sessionId: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  isolation?: SessionIsolationConfig;
  cols?: number;
  rows?: number;
  mode?: SessionMode;
  target?: string;
  shell?: boolean;
  /**
   * Optional overrides for shell-backed launches. Ignored when `shell` is
   * not `true`.
   */
  shellOptions?: ShellLaunchOptions;
}

/** Resolved environment isolation state. */
export interface SessionEnvironmentState {
  inherit: boolean;
  allow?: string[];
  setKeys: string[];
}

/** Status of temporary directory cleanup. */
export type WorkingDirectoryCleanupStatus = "pending" | "cleaned" | "retained" | "failed";

/** Resolved working directory isolation state. */
export interface SessionWorkingDirectoryState {
  mode: NonNullable<WorkingDirectoryIsolationConfig["mode"]>;
  path: string;
  sourcePath?: string;
  retain: boolean;
  cleanup: WorkingDirectoryCleanupStatus;
  cleanupError?: string;
}

/** Combined isolation state for environment and filesystem. */
export interface SessionIsolationState {
  environment?: SessionEnvironmentState;
  workingDirectory?: SessionWorkingDirectoryState;
}

/** Public metadata for an active or exited session. */
export interface SessionInfo {
  id: string;
  mode: SessionMode;
  pid: number;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number | null;
  status: SessionStatus;
}

/** Types of events recorded in the session trace. */
export type SessionTraceEventType =
  | "launch"
  | "input"
  | "resize"
  | "assert"
  | "wait"
  | "exit"
  | "close";

/** A single trace event with timestamp and structured details. */
export interface SessionTraceEvent {
  type: SessionTraceEventType;
  timestamp: string;
  details: Record<string, unknown>;
}

interface StoredTraceEvent {
  type: SessionTraceEventType;
  timestampMs: number;
  detailsJson: string;
}

/** Trace details recorded during session launch. */
export interface SessionLaunchTrace {
  requestedCommand?: string;
  requestedArgs: string[];
  resolvedCommand: string;
  resolvedArgs: string[];
  cwd?: string;
  baseCwd?: string;
  target?: string;
  shell: boolean;
  cols: number;
  rows: number;
  mode: SessionMode;
  isolation?: SessionIsolationState;
}

/**
 * Manages TUI sessions, each with a PTY and optional buffer.
 * Sessions are identified by sessionId for parallel execution.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  // Serializes concurrent launch() calls for the same sessionId. Without
  // this, two launches could both pass the `has(sessionId)` check, both
  // spawn a PTY, and the second `set()` would orphan the first PTY.
  private launching = new Map<string, Promise<SessionInfo>>();

  /**
   * Launch a new TUI session.
   *
   * Lifecycle contract:
   *   - Policy and launch argv are resolved before any existing session with
   *     the same id is touched, so a bad launch does not destroy a live one.
   *   - When the id is already registered, the existing session is disposed
   *     first; its `status` transitions to `closed` before the replacement
   *     PTY is spawned.
   *   - Concurrent launches for the same sessionId are serialized so the
   *     close-then-spawn-then-register sequence cannot interleave.
   */
  async launch(config: LaunchConfig): Promise<SessionInfo> {
    const sessionId = config.sessionId ?? "default";
    const pending = this.launching.get(sessionId);
    if (pending) {
      // Swallow the prior error: a prior failed launch must not abort this caller.
      await pending.catch(() => undefined);
    }
    const promise = this.doLaunch(sessionId, config);
    this.launching.set(sessionId, promise);
    try {
      return await promise;
    } finally {
      if (this.launching.get(sessionId) === promise) {
        this.launching.delete(sessionId);
      }
    }
  }

  private async doLaunch(sessionId: string, config: LaunchConfig): Promise<SessionInfo> {
    const mode = config.mode ?? "stream";
    const cols = config.cols ?? 80;
    const rows = config.rows ?? 24;
    const projectConfig = loadConfig(config.cwd);
    const policy = {
      workspaceRoot: projectConfig.workspaceRoot,
      ...projectConfig.security,
    };
    const security = new SecurityPolicyManager(policy);

    const resolved = resolveLaunch(config, projectConfig, security);

    security.checkCommand(resolved.command, resolved.args, resolved.env);
    if (resolved.cwd) {
      security.checkWorkspace(resolved.cwd);
    }
    if (resolved.isolation?.workingDirectory?.copyFrom) {
      security.checkWorkspace(resolved.isolation.workingDirectory.copyFrom);
    }

    const prepared = prepareSessionIsolation(
      sessionId,
      resolved.cwd,
      resolved.isolation,
      projectConfig.workspaceRoot
    );

    if (prepared.cwd) {
      security.checkWorkspace(prepared.cwd);
    }

    if (this.sessions.has(sessionId)) {
      await this.close(sessionId);
    }

    let pty: PtyInstance | undefined;
    try {
      const ptyOptions: PtyOptions = {
        file: resolved.command,
        args: resolved.args,
        cwd: prepared.cwd,
        env: resolved.env,
        cols,
        rows,
      };

      pty = spawnPty(ptyOptions);

      let buffer: TerminalBuffer | undefined;
      if (mode === "buffer") {
        buffer = createBuffer({ cols, rows });
      }

      const session = new Session(
        sessionId,
        pty,
        cols,
        rows,
        buffer,
        mode,
        projectConfig.workspaceRoot,
        security,
        {
          requestedCommand: config.command,
          requestedArgs: config.args ?? [],
          resolvedCommand: resolved.command,
          resolvedArgs: resolved.args,
          cwd: prepared.cwd,
          baseCwd: resolved.cwd,
          target: config.target,
          shell: config.shell ?? false,
          cols,
          rows,
          mode,
          isolation: cloneIsolationState(prepared.isolation),
        },
        prepared.isolation
      );
      this.sessions.set(sessionId, session);

      return session.info;
    } catch (error) {
      if (pty) {
        try {
          pty.dispose();
        } catch {
          // ignore double-dispose
        }
      }
      cleanupIsolation(prepared.isolation);
      throw error;
    }
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Close a session.
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * List all active sessions.
   */
  list(): SessionInfo[] {
    const results: SessionInfo[] = [];
    for (const [_, session] of this.sessions) {
      results.push(session.info);
    }
    return results;
  }

  /**
   * Close all sessions.
   */
  async closeAll(): Promise<void> {
    // Wait for all in-flight launches to finish first to prevent orphaned PTYs
    await Promise.allSettled(Array.from(this.launching.values()));

    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }
}

/**
 * A single TUI session with PTY and optional buffer.
 */
export class Session {
  public readonly pty: PtyInstance;
  public readonly buffer?: TerminalBuffer;
  public readonly id: string;
  public readonly mode: SessionMode;
  public readonly workspaceRoot: string;
  public readonly security: SecurityPolicyManager;
  private transcriptChunks: string[] = [];
  private transcriptBytes = 0;
  private transcriptCache: string | null = "";
  private strippedTranscriptCache: string | null = "";
  private cols: number;
  private rows: number;
  private _closed = false;
  private closeRecorded = false;
  private readonly traceEvents: StoredTraceEvent[] = [];
  private readonly isolation?: SessionIsolationState;

  constructor(
    id: string,
    pty: PtyInstance,
    cols: number,
    rows: number,
    buffer?: TerminalBuffer,
    mode: SessionMode = "stream",
    workspaceRoot: string = process.cwd(),
    security: SecurityPolicyManager = new SecurityPolicyManager({ workspaceRoot }),
    launchTrace?: SessionLaunchTrace,
    isolation?: SessionIsolationState
  ) {
    this.id = id;
    this.pty = pty;
    this.buffer = buffer;
    this.mode = mode;
    this.cols = cols;
    this.rows = rows;
    this.workspaceRoot = workspaceRoot;
    this.security = security;
    this.isolation = isolation;

    if (launchTrace) {
      this.recordTraceEvent("launch", { ...launchTrace });
    }

    pty.on("data", (data: string) => {
      this.transcriptChunks.push(data);
      this.transcriptBytes += Buffer.byteLength(data, "utf8");
      this.transcriptCache = null;
      this.strippedTranscriptCache = null;

      while (this.transcriptBytes > MAX_TRANSCRIPT_LENGTH && this.transcriptChunks.length > 0) {
        const overflow = this.transcriptBytes - MAX_TRANSCRIPT_LENGTH;
        const head = this.transcriptChunks[0] ?? "";
        const headBytes = Buffer.byteLength(head, "utf8");
        if (headBytes <= overflow) {
          this.transcriptChunks.shift();
          this.transcriptBytes -= headBytes;
          continue;
        }

        const trimmed = trimUtf8Prefix(head, overflow);
        this.transcriptChunks[0] = trimmed.remaining;
        this.transcriptBytes -= trimmed.droppedBytes;
        break;
      }
      this.buffer?.write(data);
    });

    pty.on("exit", (exitCode: number) => {
      this.recordTraceEvent("exit", { exitCode });
      this.cleanupIsolationResources();
    });
  }

  /**
   * Current lifecycle state. Derived from the PTY's exit flag and the
   * dispose path so the manager and server agree on what "alive" means.
   */
  get status(): SessionStatus {
    if (this._closed) return "closed";
    if (this.pty.exited) return "exited";
    return "active";
  }

  get transcript(): string {
    if (this.transcriptCache === null) {
      this.transcriptCache = this.transcriptChunks.join("");
    }
    return this.transcriptCache;
  }

  get strippedTranscript(): string {
    if (this.strippedTranscriptCache === null) {
      this.strippedTranscriptCache = stripAnsi(this.transcript);
    }
    return this.strippedTranscriptCache;
  }

  get closed(): boolean {
    return this._closed;
  }

  get info(): SessionInfo {
    return {
      id: this.id,
      mode: this.mode,
      pid: this.pty.pid,
      cols: this.cols,
      rows: this.rows,
      exited: this.pty.exited,
      exitCode: this.pty.exitCode,
      status: this.status,
    };
  }

  get trace(): SessionTraceEvent[] {
    return this.traceEvents.map((event) => deserializeTraceEvent(event));
  }

  get traceEventCount(): number {
    return this.traceEvents.length;
  }

  getIsolationMetadata(): SessionIsolationState | undefined {
    return cloneIsolationState(this.isolation);
  }

  forEachTraceEvent(visitor: (event: SessionTraceEvent) => void): void {
    for (const event of this.traceEvents) {
      visitor(deserializeTraceEvent(event));
    }
  }

  recordTraceEvent(type: SessionTraceEventType, details: Record<string, unknown> = {}): void {
    this.traceEvents.push({
      type,
      timestampMs: Date.now(),
      detailsJson: JSON.stringify(details),
    });
    if (this.traceEvents.length > MAX_TRACE_EVENTS) {
      this.traceEvents.shift();
    }
  }

  /**
   * Write input to the PTY.
   */
  write(data: string): void {
    this.recordTraceEvent("input", {
      length: data.length,
      utf8Bytes: Buffer.byteLength(data, "utf8"),
      newlineCount: (data.match(/\n/g) ?? []).length,
      containsControl: Array.from(data).some((char) => {
        const code = char.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
      }),
      containsEscape: data.includes("\u001b"),
    });
    this.pty.write(data);
  }

  /**
   * Get current screen output.
   *
   * The xterm buffer serializer strips ANSI unconditionally, so any
   * includeAnsi=true request is served from the raw transcript.
   */
  capture(includeAnsi: boolean = false, useBuffer?: boolean): string {
    const wantStream = useBuffer === false || !this.buffer;
    if (wantStream) {
      return includeAnsi ? this.transcript : this.strippedTranscript;
    }
    if (includeAnsi) {
      return this.transcript;
    }
    return this.buffer!.getScreenText();
  }

  /**
   * Resize the PTY and buffer together. Once the session is closed or the
   * child has exited the PTY handle is unusable, so we reject rather than
   * letting node-pty throw an opaque error.
   */
  resize(cols: number, rows: number): void {
    if (this._closed) {
      throw new Error(`Session '${this.id}' is closed and cannot be resized`);
    }
    if (this.pty.exited) {
      throw new Error(`Session '${this.id}' has exited and cannot be resized`);
    }
    this.pty.resize(cols, rows);
    this.buffer?.resize(cols, rows);
    this.cols = cols;
    this.rows = rows;
    this.recordTraceEvent("resize", { cols, rows });
  }

  prepareForClose(details: Record<string, unknown> = {}): void {
    if (this.closeRecorded) {
      return;
    }

    this.closeRecorded = true;
    const isolation = this.getIsolationMetadata();
    this.recordTraceEvent("close", {
      exitCode: this.pty.exitCode,
      status: this.status,
      ...(isolation ? { isolation } : {}),
      ...details,
    });
  }

  /**
   * Dispose of the session. Idempotent so the manager can call it from the
   * replacement path and from explicit close without risk of double-kill.
   */
  dispose(): void {
    if (this._closed) {
      return;
    }
    this.prepareForClose();
    this._closed = true;
    this.pty.dispose();
    this.buffer?.dispose();
    this.cleanupIsolationResources();
  }

  private cleanupIsolationResources(): void {
    cleanupIsolation(this.isolation);
  }
}

/**
 * Default session manager instance.
 */
export const defaultSessionManager = new SessionManager();
export { buildChildEnv, mergeEnv } from "./session-isolation.js";

function trimUtf8Prefix(value: string, targetBytes: number): { remaining: string; droppedBytes: number } {
  if (targetBytes <= 0 || value.length === 0) {
    return { remaining: value, droppedBytes: 0 };
  }

  let droppedBytes = 0;
  let droppedChars = 0;

  for (const char of value) {
    if (droppedBytes >= targetBytes) {
      break;
    }
    droppedBytes += Buffer.byteLength(char, "utf8");
    droppedChars += char.length;
  }

  return {
    remaining: value.slice(droppedChars),
    droppedBytes,
  };
}

function deserializeTraceEvent(event: StoredTraceEvent): SessionTraceEvent {
  return {
    type: event.type,
    timestamp: new Date(event.timestampMs).toISOString(),
    details: JSON.parse(event.detailsJson) as Record<string, unknown>,
  };
}
