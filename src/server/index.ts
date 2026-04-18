/**
 * MCP server for TUI testing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { info, error } from "../logging.js";
import { SessionManager, Session, mergeEnv } from "../core/session.js";
import type { TerminalBuffer } from "../core/buffer.js";
import { encodeKeys, ctrlKey } from "../core/keys.js";
import {
  assertContains,
  assertAtPosition,
  waitForOutput,
  waitForScreenChange,
  waitForScreenStability,
  buildExcerpt,
  type PatternMode,
  type WaitMode,
} from "../core/assertions.js";
import { captureAndPersistArtifacts, type SessionArtifactMetadata } from "../artifacts.js";
import { defaultDimensions, defaultTimeouts } from "../config/default.js";
import { loadConfig } from "../config/load.js";
import { runnerRegistry } from "../runners/index.js";
import { runMicrosoftTuiTestBridge } from "../bridges/microsoft-tui-test/index.js";
import { sleep } from "../utils.js";
import {
  sessionAlias,
  ansiAlias,
  bufferOverrideAlias,
  regionAlias,
  closeAlias,
  dimensionAlias,
  patternModeAlias,
  pollIntervalAlias,
  stableForAlias,
  normalize,
} from "./aliases.js";
import { attachInitializeLifecycleGuard } from "./lifecycle.js";
import { buildSecurity, executeCommand, resolveProjectTarget } from "./target-commands.js";

type ToolErrorResponse = {
  content: [{ type: "text"; text: string }];
  isError: true;
};

/**
 * Canonical error strings: a single source so callers can match on
 * distinct session-vs-buffer failure modes without fuzzy string matching.
 */
function missingSessionError(sessionId: string): ToolErrorResponse {
  return {
    content: [
      { type: "text", text: `Session '${sessionId}' is not active (closed or not found)` },
    ],
    isError: true,
  };
}

function missingBufferError(sessionId: string): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text: `Session '${sessionId}' has no buffer; launch with mode: "buffer" to use this tool`,
      },
    ],
    isError: true,
  };
}

/**
 * Input to an exited session is silently dropped by the PTY layer, which
 * leaves an LLM caller unable to tell why its keystrokes had no effect.
 * This helper surfaces the exit plus a screen excerpt so the caller can
 * decide whether to relaunch without a round-trip through capture_screen.
 */
function exitedSessionError(session: Session): ToolErrorResponse {
  const excerpt = buildExcerpt(session.capture(), session.mode);
  const exitCode = session.info.exitCode;
  const exitLabel = exitCode == null ? "without exit code" : `with exit code ${exitCode}`;
  return {
    content: [
      {
        type: "text",
        text: `Session '${session.id}' has exited ${exitLabel} and cannot receive input. Current ${session.mode} excerpt:\n${excerpt}`,
      },
    ],
    isError: true,
  };
}

function requireSession(
  sessions: SessionManager,
  sessionId: string
): { session: Session } | { error: ToolErrorResponse } {
  const session = sessions.get(sessionId);
  if (!session || session.closed) {
    return { error: missingSessionError(sessionId) };
  }
  return { session };
}

function requireBufferSession(
  sessions: SessionManager,
  sessionId: string
): { session: Session; buffer: TerminalBuffer } | { error: ToolErrorResponse } {
  const lookup = requireSession(sessions, sessionId);
  if ("error" in lookup) return lookup;
  if (!lookup.session.buffer) {
    return { error: missingBufferError(sessionId) };
  }
  return { session: lookup.session, buffer: lookup.session.buffer };
}

// Input tools need a session that is both registered AND whose child has
// not exited. The distinction matters because writes to an exited PTY are
// silently dropped by node-pty, so the caller needs a loud failure.
function requireActiveSession(
  sessions: SessionManager,
  sessionId: string
): { session: Session } | { error: ToolErrorResponse } {
  const lookup = requireSession(sessions, sessionId);
  if ("error" in lookup) return lookup;
  if (lookup.session.status === "exited") {
    return { error: exitedSessionError(lookup.session) };
  }
  return lookup;
}

type SessionToolResult = {
  text: string;
  isError?: boolean;
};

export async function expectTextInSession(
  session: Session,
  pattern: string,
  timeoutSeconds: number,
  patternMode: PatternMode = "text"
): Promise<SessionToolResult> {
  const timeoutMs = timeoutSeconds * 1000;
  const mode: WaitMode = session.buffer ? "buffer" : "stream";
  const read = session.buffer
    ? () => session.buffer!.getScreenText()
    : () => session.capture(false, false);
  const result = await waitForOutput(read, pattern, {
    timeoutMs,
    mode,
    patternMode,
    isStopRequested: () => session.status !== "active",
  });

  session.recordTraceEvent("wait", {
    pattern,
    patternMode,
    timeoutMs,
    mode,
    success: result.success,
    message: result.message,
    found: result.found,
    excerpt: result.excerpt,
    elapsedMs: result.elapsedMs,
  });

  return {
    text: result.message,
    isError: !result.success,
  };
}

async function waitForScreenChangeInSession(
  session: Session,
  timeoutSeconds: number,
  pollIntervalMs?: number
): Promise<SessionToolResult> {
  const timeoutMs = timeoutSeconds * 1000;
  const mode: WaitMode = session.buffer ? "buffer" : "stream";
  const read = session.buffer
    ? () => session.buffer!.getScreenText()
    : () => session.capture(false, false);
  const result = await waitForScreenChange(read, {
    timeoutMs,
    mode,
    pollIntervalMs,
    isStopRequested: () => session.status !== "active",
  });

  session.recordTraceEvent("wait", {
    kind: "screen_change",
    timeoutMs,
    mode,
    success: result.success,
    message: result.message,
    excerpt: result.excerpt,
    elapsedMs: result.elapsedMs,
  });

  return { text: result.message, isError: !result.success };
}

async function waitForScreenStabilityInSession(
  session: Session,
  timeoutSeconds: number,
  stableForMs: number,
  pollIntervalMs?: number
): Promise<SessionToolResult> {
  const timeoutMs = timeoutSeconds * 1000;
  const mode: WaitMode = session.buffer ? "buffer" : "stream";
  const read = session.buffer
    ? () => session.buffer!.getScreenText()
    : () => session.capture(false, false);
  const result = await waitForScreenStability(read, {
    timeoutMs,
    mode,
    stableForMs,
    pollIntervalMs,
    isStopRequested: () => session.status !== "active",
  });

  session.recordTraceEvent("wait", {
    kind: "screen_stability",
    timeoutMs,
    stableForMs,
    mode,
    success: result.success,
    message: result.message,
    excerpt: result.excerpt,
    elapsedMs: result.elapsedMs,
  });

  return { text: result.message, isError: !result.success };
}

export async function closeSessionWithArtifacts(
  sessions: SessionManager,
  sessionId: string,
  captureArtifacts: boolean
): Promise<SessionArtifactMetadata | null> {
  const session = sessions.get(sessionId);
  let artifact: SessionArtifactMetadata | null = null;

  if (captureArtifacts && session) {
    session.prepareForClose({
      captureArtifacts: true,
      closedBy: "close_session",
    });
    // Artifact writes route through the session's frozen security
    // context, not a rebuilt one, so retention and redaction match the
    // policy that was in force at launch.
    artifact = captureAndPersistArtifacts(session, session.security);
  }

  await sessions.close(sessionId);
  return artifact;
}

/**
 * MCP server for TUI testing.
 */
export class TuiTestServer {
  private sessions = new SessionManager();
  private server?: McpServer;
  private bridgeAbortController = new AbortController();
  private shutdownPromise?: Promise<void>;

  /**
   * Initialize the server.
   */
  async start(): Promise<void> {
    const server = new McpServer({
      name: "tui-test",
      version: "0.1.0",
    });

    // ========== Launch Tools ==========

    server.tool(
      "launch_tui",
      "Launch a terminal program inside a PTY and register it under `sessionId`. This is usually the first tool to call for requests like 'run the TUI', 'open the CLI', 'check whether this command starts', or 'test the layout'. Pick `mode: \"stream\"` for line-oriented CLI flows and `mode: \"buffer\"` for full-screen, redraw-heavy TUIs and layout checks. Prefer exact `command` plus `args`; use `target` when the workspace defines named launch targets. When `shell: true` the command is passed verbatim to the resolved shell adapter (`sh -c`, `bash -lc`, `cmd /c`, and similar), so the caller is responsible for all quoting. `cols` and `rows` are bounded 10-500 to prevent buffer exhaustion. Relaunching with an existing `sessionId` closes the prior session first.",
      {
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        target: z.string().optional(),
        cwd: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        isolation: z
          .object({
            environment: z
              .object({
                inherit: z.boolean().optional(),
                allow: z.array(z.string()).optional(),
                set: z.record(z.string(), z.string()).optional(),
              })
              .optional(),
            workingDirectory: z
              .object({
                mode: z.enum(["temp", "copy"]).optional(),
                copyFrom: z.string().optional(),
                retain: z.boolean().optional(),
              })
              .optional(),
          })
          .optional(),
        shell: z.boolean().default(false),
        // shellOptions is honored only when shell=true. The adapter id is
        // validated at resolution time so the supported set lives in one
        // place (see src/shell/index.ts).
        shellOptions: z
          .object({
            name: z.string().optional(),
            login: z.boolean().optional(),
            path: z.string().optional(),
          })
          .optional(),
        sessionId: z.string().default("default"),
        mode: z.enum(["stream", "buffer"]).default("stream"),
        cols: z.number().int().min(10).max(500).default(defaultDimensions.cols),
        rows: z.number().int().min(10).max(500).default(defaultDimensions.rows),
        timeout: z.number().int().positive().max(120).default(defaultTimeouts.launch / 1000),
        ...sessionAlias,
        ...dimensionAlias,
      },
      async (raw: {
        command?: string;
        args?: string[];
        target?: string;
        cwd?: string;
        env?: Record<string, string>;
        isolation?: {
          environment?: {
            inherit?: boolean;
            allow?: string[];
            set?: Record<string, string>;
          };
          workingDirectory?: {
            mode?: "temp" | "copy";
            copyFrom?: string;
            retain?: boolean;
          };
        };
        shell: boolean;
        shellOptions?: { name?: string; login?: boolean; path?: string };
        sessionId: string;
        mode: "stream" | "buffer";
        cols: number;
        rows: number;
        timeout: number;
      }) => {
        const params = normalize(raw);
        try {
          const result = await this.sessions.launch({
            sessionId: params.sessionId,
            command: params.command,
            args: params.args,
            target: params.target,
            cwd: params.cwd,
            env: params.env,
            isolation: params.isolation,
            shell: params.shell,
            shellOptions: params.shellOptions,
            mode: params.mode,
            cols: params.cols,
            rows: params.rows,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (e) {
          return {
            content: [{ type: "text", text: `Error: ${e}` }],
            isError: true,
          };
        }
      }
    );

    // ========== Input Tools ==========

    server.tool(
      "send_keys",
      "Send literal keystrokes or named keys (for example `Enter`, `Tab`, `ArrowDown`, `Escape`) to an active session. Use this after `launch_tui` when the task says to type, press Enter, open a menu, move selection, or trigger a shortcut. `delay` is milliseconds to wait after the write. Returns an error with a screen excerpt if the session has already exited.",
      {
        sessionId: z.string().default("default"),
        keys: z.string(),
        delay: z.number().int().default(defaultTimeouts.sendKeys),
        ...sessionAlias,
      },
      async (raw: { sessionId: string; keys: string; delay: number }) => {
        const params = normalize(raw);
        const lookup = requireActiveSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        const parsed = encodeKeys(params.keys);
        lookup.session.write(parsed);

        if (params.delay > 0) {
          await sleep(params.delay);
        }

        return { content: [{ type: "text", text: "ok" }] };
      }
    );

    server.tool(
      "send_ctrl",
      "Send a single Ctrl combination to an active session. Use for actions like Ctrl+C to stop a process or Ctrl+D to exit a prompt. Pass the lowercase letter only: `c` for Ctrl+C, `d` for Ctrl+D, and so on. Returns an error with a screen excerpt if the session has already exited.",
      {
        sessionId: z.string().default("default"),
        key: z.string(),
        ...sessionAlias,
      },
      async (raw: { sessionId: string; key: string }) => {
        const params = normalize(raw);
        const lookup = requireActiveSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        const combo = ctrlKey(params.key);
        lookup.session.write(combo);

        return { content: [{ type: "text", text: "ok" }] };
      }
    );

    // ========== Screen Tools ==========

    server.tool(
      "capture_screen",
      "Return the current screen as text so the caller can inspect or summarize the terminal's current state. Buffer-mode sessions return the rendered grid, which is best for full-screen TUI layout checks. Stream-mode sessions return the raw transcript, which is best for line-oriented CLI output. Set `includeAnsi: true` to keep ANSI escape sequences (always served from the raw stream, because the xterm buffer strips ANSI). Use `useBuffer` to override the session's native mode for this single read.",
      {
        // `useBuffer` overrides the session's mode for this single read:
        //   - true  → force buffer snapshot (or raw stream if includeAnsi)
        //   - false → force raw stream readback even in buffer sessions
        //   - unset → auto (buffer if the session has one, else stream)
        // `includeAnsi` on a buffered session falls back to raw streamOutput,
        // because the xterm buffer serializer strips ANSI unconditionally.
        sessionId: z.string().default("default"),
        includeAnsi: z.boolean().default(false),
        useBuffer: z.boolean().optional(),
        ...sessionAlias,
        ...ansiAlias,
        ...bufferOverrideAlias,
      },
      async (raw: { sessionId: string; includeAnsi: boolean; useBuffer?: boolean }) => {
        const params = normalize(raw);
        const lookup = requireSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        return {
          content: [{ type: "text", text: lookup.session.capture(params.includeAnsi, params.useBuffer) }],
        };
      }
    );

    // ========== Assertion Tools ==========

    server.tool(
      "expect_text",
      "Wait until `pattern` appears on the screen, or fail after `timeout` seconds (max 120). Use this when the task says to wait for a prompt, menu item, success message, error text, or other visible confirmation that the app reached the next state. Set `patternMode: \"regex\"` for regex matching; the default is literal text. Buffer mode strips ANSI, so do not embed escape sequences like `\\x1b[31m` in the pattern. On timeout the error includes a screen excerpt.",
      {
        // patternMode toggles literal vs regex matching so callers don't
        // need a separate tool for regex waits.
        // NOTE: For highly transient text that flashes on screen, use stream
        // mode instead of buffer mode, as buffer mode polls snapshots and may
        // miss fast changes.
        sessionId: z.string().default("default"),
        pattern: z.string(),
        patternMode: z.enum(["text", "regex"]).default("text"),
        timeout: z.number().int().positive().max(120).default(defaultTimeouts.expect / 1000),
        ...sessionAlias,
        ...patternModeAlias,
      },
      async (raw: { sessionId: string; pattern: string; patternMode: PatternMode; timeout: number }) => {
        const params = normalize(raw);
        const lookup = requireSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;
        const result = await expectTextInSession(lookup.session, params.pattern, params.timeout, params.patternMode);
        return {
          content: [{ type: "text", text: result.text }],
          isError: result.isError,
        };
      }
    );

    server.tool(
      "wait_for_screen_change",
      "Wait until the screen differs from its value at the start of the call, or fail after `timeout` seconds (max 120). Use this after sending input to a redraw-heavy TUI when you want to confirm that something changed before making the next assertion. Buffer mode polls a rendered snapshot and may miss sub-poll transient changes; use stream mode when you need to observe brief flashes.",
      {
        // Resolves as soon as the readback differs from its value at the start
        // of the wait. Buffered sessions observe the rendered screen; stream
        // sessions observe the raw transcript.
        // NOTE: For highly transient changes that flash on screen, use stream
        // mode instead of buffer mode, as buffer mode polls snapshots and may
        // miss fast changes.
        sessionId: z.string().default("default"),
        timeout: z.number().int().positive().max(120).default(defaultTimeouts.expect / 1000),
        pollIntervalMs: z.number().int().min(50).optional(),
        ...sessionAlias,
        ...pollIntervalAlias,
      },
      async (raw: { sessionId: string; timeout: number; pollIntervalMs?: number }) => {
        const params = normalize(raw);
        const lookup = requireSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;
        const result = await waitForScreenChangeInSession(lookup.session, params.timeout, params.pollIntervalMs);
        return {
          content: [{ type: "text", text: result.text }],
          isError: result.isError,
        };
      }
    );

    server.tool(
      "wait_for_screen_stability",
      "Wait until the screen has been unchanged for `stableForMs` milliseconds, or fail after `timeout` seconds (max 120). Use in place of ad hoc sleeps to let a redraw-heavy TUI settle before running assertions, especially for layout checks after launch, resize, or navigation.",
      {
        // Resolves when the readback has been unchanged for stableForMs. Use
        // in place of ad hoc sleeps when a redraw-heavy TUI needs to settle
        // before assertions run.
        // NOTE: For highly transient states that flash on screen, use stream
        // mode instead of buffer mode, as buffer mode polls snapshots and may
        // miss fast changes.
        sessionId: z.string().default("default"),
        timeout: z.number().int().positive().max(120).default(defaultTimeouts.expect / 1000),
        stableForMs: z.number().int().positive().default(500),
        pollIntervalMs: z.number().int().min(50).optional(),
        ...sessionAlias,
        ...stableForAlias,
        ...pollIntervalAlias,
      },
      async (raw: { sessionId: string; timeout: number; stableForMs: number; pollIntervalMs?: number }) => {
        const params = normalize(raw);
        const lookup = requireSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;
        const result = await waitForScreenStabilityInSession(
          lookup.session,
          params.timeout,
          params.stableForMs,
          params.pollIntervalMs
        );
        return {
          content: [{ type: "text", text: result.text }],
          isError: result.isError,
        };
      }
    );

    server.tool(
      "assert_contains",
      "Assert that `pattern` is currently present on the screen. Use this for immediate checks like 'the status bar shows Connected' or 'the command printed Usage'. Does not wait, use `expect_text` when you need to poll. Buffer mode strips ANSI; do not embed escape sequences in the pattern.",
      {
        sessionId: z.string().default("default"),
        text: z.string(),
        ...sessionAlias,
      },
      async (raw: { sessionId: string; text: string }) => {
        const params = normalize(raw);
        const lookup = requireSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;
        const session = lookup.session;

        if (session.buffer) {
          const result = assertContains(session.buffer, params.text);
          session.recordTraceEvent("assert", {
            assertion: "assert_contains",
            text: params.text,
            mode: "buffer",
            success: result.success,
            message: result.message,
            excerpt: result.excerpt,
          });
          return {
            content: [{ type: "text", text: result.message }],
            isError: !result.success,
          };
        }

        const captured = session.capture(false, false);
        const found = captured.includes(params.text);
        const message = found
          ? `Found: ${params.text}`
          : `Not found: ${params.text}. Current output excerpt:\n${buildExcerpt(captured, "stream")}`;
        session.recordTraceEvent("assert", {
          assertion: "assert_contains",
          text: params.text,
          mode: "stream",
          success: found,
          message,
        });

        return {
          content: [{ type: "text", text: message }],
          isError: !found,
        };
      }
    );

    // ========== Buffer-only Tools ==========

    server.tool(
      "assert_at_position",
      "Assert that `pattern` appears at a specific `row` and `column` on the screen. Use this for layout-sensitive checks like headers, footers, sidebars, and aligned table cells. Buffer mode only. 0-indexed row/column.",
      {
        sessionId: z.string().default("default"),
        text: z.string(),
        row: z.number().int(),
        col: z.number().int(),
        ...sessionAlias,
      },
      async (raw: { sessionId: string; text: string; row: number; col: number }) => {
        const params = normalize(raw);
        const lookup = requireBufferSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        const result = assertAtPosition(lookup.buffer, params.text, params.row, params.col);
        lookup.session.recordTraceEvent("assert", {
          assertion: "assert_at_position",
          text: params.text,
          row: params.row,
          col: params.col,
          mode: "buffer",
          success: result.success,
          message: result.message,
          excerpt: result.excerpt,
        });
        return {
          content: [{ type: "text", text: result.message }],
          isError: !result.success,
        };
      }
    );

    server.tool(
      "get_cursor_position",
      "Return the current cursor `row` and `column` from the terminal buffer. Use this when the task cares where focus or text entry is currently located. Buffer mode only.",
      {
        sessionId: z.string().default("default"),
        ...sessionAlias,
      },
      async (raw: { sessionId: string }) => {
        const params = normalize(raw);
        const lookup = requireBufferSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        const pos = lookup.buffer.getCursorPosition();
        return { content: [{ type: "text", text: JSON.stringify(pos) }] };
      }
    );

    server.tool(
      "get_screen_region",
      "Return the text inside a rectangular region of the screen defined by `startRow`, `endRow`, `startColumn`, `endColumn` (inclusive). Use this to inspect one panel, table, footer, sidebar, or other bounded area without reading the full screen. Buffer mode only.",
      {
        // rowStart/rowEnd are required in practice, but we keep them optional
        // in the schema so snake_case callers passing row_start/row_end are
        // accepted. Presence is checked below after alias normalization.
        sessionId: z.string().default("default"),
        rowStart: z.number().int().optional(),
        rowEnd: z.number().int().optional(),
        colStart: z.number().int().optional(),
        colEnd: z.number().int().optional(),
        ...sessionAlias,
        ...regionAlias,
      },
      async (raw: { sessionId: string; rowStart?: number; rowEnd?: number; colStart?: number; colEnd?: number }) => {
        const params = normalize(raw);
        const lookup = requireBufferSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        if (typeof params.rowStart !== "number" || typeof params.rowEnd !== "number") {
          return {
            content: [{ type: "text", text: "rowStart and rowEnd are required (or row_start/row_end)" }],
            isError: true,
          };
        }

        const region = lookup.buffer.getRegion(params.rowStart, params.rowEnd, params.colStart, params.colEnd);
        return { content: [{ type: "text", text: region }] };
      }
    );

    server.tool(
      "get_line",
      "Return the text of a single screen row by `row` index. Use this for focused checks on one rendered line, such as a title bar, footer, or selected row. Buffer mode only.",
      {
        sessionId: z.string().default("default"),
        row: z.number().int(),
        ...sessionAlias,
      },
      async (raw: { sessionId: string; row: number }) => {
        const params = normalize(raw);
        const lookup = requireBufferSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        const line = lookup.buffer.getLine(params.row);
        return { content: [{ type: "text", text: line ?? "" }] };
      }
    );

    // ========== Session Tools ==========

    server.tool(
      "close_session",
      "Close an active session and dispose its PTY. Call this when the test or inspection is complete, or before relaunching the same `sessionId`. Pass `captureArtifacts: true` to persist the final artifact bundle before closing, including `screen.html` for buffer-mode sessions.",
      {
        sessionId: z.string().default("default"),
        captureArtifacts: z.boolean().default(true),
        ...sessionAlias,
        ...closeAlias,
      },
      async (raw: { sessionId: string; captureArtifacts: boolean }) => {
        const params = normalize(raw);
        const artifact = await closeSessionWithArtifacts(this.sessions, params.sessionId, params.captureArtifacts);

        if (artifact) {
          return { content: [{ type: "text", text: JSON.stringify(artifact, null, 2) }] };
        }
        return { content: [{ type: "text", text: "ok" }] };
      }
    );

    server.tool(
      "list_sessions",
      "Return metadata for every registered session: id, mode, pid, cols, rows, and exit state. Use this for cleanup, debugging, or when you need to inspect what is already running.",
      {},
      async () => {
        const sessions = this.sessions.list();
        return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
      }
    );

    server.tool(
      "resize_session",
      "Resize an active session. Use this for layout and responsiveness checks after the app is already running. Keeps the PTY and the buffer grid in sync. `cols` and `rows` are bounded 10-500. Either pass `cols`/`rows` directly or use the `dimensions: {cols, rows}` alias.",
      {
        // cols/rows are required in practice but optional in the schema so
        // Python-surface callers passing dimensions: {cols, rows} still parse.
        // Presence is checked below after alias normalization.
        sessionId: z.string().default("default"),
        cols: z.number().int().min(10).max(500).optional(),
        rows: z.number().int().min(10).max(500).optional(),
        ...sessionAlias,
        ...dimensionAlias,
      },
      async (raw: { sessionId: string; cols?: number; rows?: number }) => {
        const params = normalize(raw);
        const lookup = requireSession(this.sessions, params.sessionId);
        if ("error" in lookup) return lookup.error;

        if (typeof params.cols !== "number" || typeof params.rows !== "number") {
          return {
            content: [{ type: "text", text: "cols and rows are required (or pass dimensions: {cols, rows})" }],
            isError: true,
          };
        }

        try {
          lookup.session.resize(params.cols, params.rows);
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
        return { content: [{ type: "text", text: "ok" }] };
      }
    );

    // ========== Runner Tools ==========

    server.tool(
      "discover_targets",
      "Detect targets the workspace's runners (cargo, go, node, python) can launch or test, using explicit config and/or auto-detection at the workspace root. Use this first when the user says to run or test the app in the current repo but does not name the command.",
      {
        cwd: z.string().optional(),
      },
      async (params: { cwd?: string }) => {
        try {
          const config = loadConfig(params.cwd);
          const root = config.workspaceRoot;
          const detected = await runnerRegistry.detect(root);
          const perRunner = await Promise.all(detected.map((r) => r.listTargets(root)));
          const targets = perRunner.flat();

          return { content: [{ type: "text", text: JSON.stringify(targets, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
        }
      }
    );

    server.tool(
      "build_target",
      "Invoke the build step for a named target through its resolved runner (for example `cargo build`, `go build`, `npm run build`). Use this when the task explicitly asks for a build or when a launch flow depends on a build artifact.",
      {
        target: z.string(),
        cwd: z.string().optional(),
      },
      async (params: { target: string; cwd?: string }) => {
        try {
          const { config, runner, projectTarget } = resolveProjectTarget(params.target, params.cwd);
          const buildSpec = await runner.build(projectTarget);
          if (!buildSpec) {
            return { content: [{ type: "text", text: `No build command for target: ${params.target}` }], isError: true };
          }

          const result = await executeCommand(config, buildSpec, projectTarget.cwd);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: result.exitCode === 0,
                  output: result.stdout + result.stderr,
                  exitCode: result.exitCode,
                }),
              },
            ],
          };
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
        }
      }
    );

    server.tool(
      "run_target_tests",
      "Invoke the test step for a named target through its resolved runner (for example `cargo test`, `go test`, `npm test`). Use this when the task is about the target's test suite rather than an interactive PTY session.",
      {
        target: z.string(),
        cwd: z.string().optional(),
      },
      async (params: { target: string; cwd?: string }) => {
        try {
          const { config, runner, projectTarget } = resolveProjectTarget(params.target, params.cwd);
          const testSpec = await runner.test(projectTarget);
          if (!testSpec) {
            return { content: [{ type: "text", text: `No test command for target: ${params.target}` }], isError: true };
          }

          const result = await executeCommand(config, testSpec, projectTarget.cwd);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: result.exitCode === 0,
                  output: result.stdout + result.stderr,
                  exitCode: result.exitCode,
                }),
              },
            ],
          };
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
        }
      }
    );

    // ========== Microsoft TUI Test Bridge (optional, opt-in) ==========
    //
    // This tool exists as an explicit bridge-specific invocation path. The
    // core PTY session tools above do not depend on `@microsoft/tui-test`,
    // so projects that never call this tool pay no runtime cost and see no
    // behavior change if the optional dependency is absent.

    server.tool(
      "run_microsoft_tui_test",
      "Bridge to Microsoft `tui-test`: discover and run test patterns against the workspace and return the runner's stdout, stderr, and exit code. Use this only when the workspace already uses Microsoft's `tui-test`; otherwise prefer the core PTY session tools above. `timeout` is bounded to 300s.",
      {
        configFile: z.string().optional(),
        cwd: z.string().optional(),
        pattern: z.string().optional(),
        timeout: z.number().int().positive().max(300).optional(),
        extraArgs: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      },
      async (params: {
        configFile?: string;
        cwd?: string;
        pattern?: string;
        timeout?: number;
        extraArgs?: string[];
        env?: Record<string, string>;
      }) => {
        try {
          const config = loadConfig(params.cwd);
          const security = buildSecurity(config);

          const bridgeCfg = config.microsoftTuiTest;
          const cwd = params.cwd ?? bridgeCfg?.cwd ?? config.workspaceRoot;
          security.checkWorkspace(cwd);
          // The bridge spawns process.execPath (the current Node). Gate it
          // through the same check as any other command the server would
          // launch so deny-lists can cover it.
          security.checkCommand(process.execPath, []);

          const timeoutMs = params.timeout
            ? params.timeout * 1000
            : bridgeCfg?.defaultTimeoutMs;

          const result = await runMicrosoftTuiTestBridge({
            cwd,
            configFile: params.configFile ?? bridgeCfg?.configFile,
            pattern: params.pattern,
            timeoutMs,
            extraArgs: params.extraArgs,
            env: mergeEnv(security, params.env),
            signal: this.bridgeAbortController.signal,
          });

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: result.status !== "success",
          };
        } catch (e) {
          return {
            content: [
              { type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` },
            ],
            isError: true,
          };
        }
      }
    );

    // ========== Connect and Run ==========

    this.server = server;
    const transport = new StdioServerTransport();
    await server.connect(transport);
    attachInitializeLifecycleGuard(transport);

    info("TUI Test MCP server started");
  }

  /**
   * Tear down active sessions and disconnect the MCP transport.
   *
   * Re-entrant: overlapping callers (e.g., two near-simultaneous signals)
   * share the same shutdown promise instead of one returning early while
   * the other is still running.
   *
   * Transport is closed before sessions so in-flight requests cannot
   * observe a half-disposed SessionManager.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      this.bridgeAbortController.abort();
      if (this.server) {
        try {
          await this.server.close();
        } catch (err) {
          error(`Error closing MCP server: ${String(err)}`);
        }
      }
      try {
        await this.sessions.closeAll();
      } catch (err) {
        error(`Error closing sessions during shutdown: ${String(err)}`);
      }
    })();
    return this.shutdownPromise;
  }
}

/**
 * Create and start the server.
 */
export async function createServer(): Promise<TuiTestServer> {
  const server = new TuiTestServer();
  await server.start();
  return server;
}

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().catch((e) => {
    error("Failed to start server:", e);
    process.exit(1);
  });
}
