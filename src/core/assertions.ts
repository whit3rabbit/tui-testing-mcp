import { TerminalBuffer } from "./buffer.js";
import { sleep } from "../utils.js";

export interface AssertionResult {
  success: boolean;
  message: string;
  found?: string;
  excerpt?: string;
  elapsedMs?: number;
}

export type WaitMode = "stream" | "buffer";
export type PatternMode = "text" | "regex";

import { stripAnsi } from "../utils.js";

export interface WaitForTextOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  mode?: WaitMode;
  patternMode?: PatternMode;
  /**
   * Whether to strip ANSI escape codes before matching. Defaults to true.
   */
  stripAnsi?: boolean;
  /** Optional callback to abort the wait early (e.g., if session exits). */
  isStopRequested?: () => boolean;
}

export interface WaitForChangeOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  mode?: WaitMode;
  /**
   * Baseline output. If omitted, the first sampled output at wait start is
   * used as the baseline, and the wait resolves once the next poll observes
   * something different.
   */
  baseline?: string;
  /** Optional callback to abort the wait early (e.g., if session exits). */
  isStopRequested?: () => boolean;
}

export interface WaitForStabilityOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  /**
   * Duration the output must remain unchanged before the wait resolves. Must
   * be smaller than `timeoutMs`; otherwise the wait can only fail.
   */
  stableForMs?: number;
  mode?: WaitMode;
  /** Optional callback to abort the wait early (e.g., if session exits). */
  isStopRequested?: () => boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_STABLE_FOR_MS = 500;

/**
 * Assert that text appears in the terminal buffer.
 */
export function assertContains(buffer: TerminalBuffer, text: string): AssertionResult {
  const screen = buffer.getScreenText();
  const found = screen.includes(text);
  const excerpt = buildExcerpt(screen, "buffer");

  return {
    success: found,
    message: found
      ? `Found text "${text}"`
      : `Text "${text}" not found in screen. Current buffer excerpt:\n${excerpt}`,
    found: text,
    excerpt,
  };
}

/**
 * Assert that text appears at specific position (row, col).
 * Position is 0-indexed.
 */
export function assertAtPosition(
  buffer: TerminalBuffer,
  text: string,
  row: number,
  col: number
): AssertionResult {
  if (row < 0 || row >= buffer.rows) {
    return {
      success: false,
      message: `Row ${row} out of bounds (0-${buffer.rows - 1})`,
      excerpt: buildExcerpt(buffer.getScreenText(), "buffer"),
    };
  }

  const line = buffer.getLine(row);
  if (!line) {
    return {
      success: false,
      message: `Failed to read line ${row}`,
      excerpt: buildExcerpt(buffer.getScreenText(), "buffer"),
    };
  }

  const atPosition = line.startsWith(text, col);
  const excerpt = buildExcerpt(buffer.getScreenText(), "buffer");

  return {
    success: atPosition,
    message: atPosition
      ? `Found "${text}" at position (${row}, ${col})`
      : `Text "${text}" not at position (${row}, ${col}). Current line: "${line}"`,
    excerpt,
  };
}

/**
 * Wait for text or regex to appear in the buffer.
 * Convenience wrapper around `waitForOutput` for buffer-mode callers.
 */
export async function waitForText(
  buffer: TerminalBuffer,
  pattern: string | RegExp,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  pollIntervalMs: number = DEFAULT_POLL_MS
): Promise<AssertionResult> {
  return waitForOutput(() => buffer.getScreenText(), pattern, {
    timeoutMs,
    pollIntervalMs,
    mode: "buffer",
  });
}

/**
 * Wait until `pattern` matches the current readback.
 *
 * `pattern` may be a string (literal match by default; regex if
 * `patternMode === "regex"`) or a RegExp object (used directly regardless of
 * `patternMode`). Timeout diagnostics include the failed condition, the
 * elapsed/timeout window, and a mode-aware excerpt.
 */
export async function waitForOutput(
  read: () => string,
  pattern: string | RegExp,
  options: WaitForTextOptions = {}
): Promise<AssertionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const mode = options.mode ?? "stream";
  const patternMode = options.patternMode ?? "text";
  const regex = compilePattern(pattern, patternMode);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (options.isStopRequested?.()) {
      return {
        success: false,
        message: "Wait aborted: session is no longer active",
        elapsedMs: Date.now() - startTime,
      };
    }

    const rawOutput = read();
    const output = (options.stripAnsi !== false) ? stripAnsi(rawOutput) : rawOutput;
    
    // Mitigate ReDoS: for regex patterns in stream mode, only check the last 32KB 
    // of output. Literal text searches remain full-transcript.
    const searchSpace = (patternMode === "regex" && mode === "stream")
      ? output.slice(-32768)
      : output;
    
    const match = searchSpace.match(regex);

    if (match) {
      return {
        success: true,
        message: `Found pattern ${describePattern(pattern, patternMode)} after ${Date.now() - startTime}ms`,
        found: match[0],
        elapsedMs: Date.now() - startTime,
        excerpt: buildExcerpt(output, mode),
      };
    }

    await sleep(pollIntervalMs);
  }

  const rawOutput = read();
  const output = (options.stripAnsi !== false) ? stripAnsi(rawOutput) : rawOutput;
  const elapsedMs = Date.now() - startTime;
  const excerpt = buildExcerpt(output, mode);
  const sourceLabel = mode === "buffer" ? "buffer excerpt" : "output excerpt";

  return {
    success: false,
    message: `Timeout after ${timeoutMs}ms waiting for ${describePattern(pattern, patternMode)}. Current ${sourceLabel}:\n${excerpt}`,
    elapsedMs,
    excerpt,
  };
}

/**
 * Wait until the readback differs from `baseline` (or the first sample if no
 * baseline is provided). Useful for redraw-heavy TUIs where the test only
 * needs to know that the screen advanced past its previous state rather than
 * matching specific text.
 */
export async function waitForScreenChange(
  read: () => string,
  options: WaitForChangeOptions = {}
): Promise<AssertionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const mode = options.mode ?? "stream";
  const startTime = Date.now();
  const baseline = options.baseline ?? read();

  while (Date.now() - startTime < timeoutMs) {
    if (options.isStopRequested?.()) {
      return {
        success: false,
        message: "Wait aborted: session is no longer active",
        elapsedMs: Date.now() - startTime,
      };
    }

    const output = read();
    if (output !== baseline) {
      return {
        success: true,
        message: `Screen changed after ${Date.now() - startTime}ms`,
        elapsedMs: Date.now() - startTime,
        excerpt: buildExcerpt(output, mode),
      };
    }
    await sleep(pollIntervalMs);
  }

  const output = read();
  const excerpt = buildExcerpt(output, mode);
  const sourceLabel = mode === "buffer" ? "buffer excerpt" : "output excerpt";
  return {
    success: false,
    message: `Timeout after ${timeoutMs}ms waiting for screen change. Screen matched baseline for the entire interval. Current ${sourceLabel}:\n${excerpt}`,
    elapsedMs: Date.now() - startTime,
    excerpt,
  };
}

/**
 * Wait until the readback stops changing for `stableForMs`. Used to let
 * redraw-heavy TUIs settle before the caller asserts on their contents.
 *
 * The wait fails if the screen keeps changing for the full `timeoutMs` window.
 * A successful result reports how long the screen stayed stable.
 */
export async function waitForScreenStability(
  read: () => string,
  options: WaitForStabilityOptions = {}
): Promise<AssertionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const stableForMs = options.stableForMs ?? DEFAULT_STABLE_FOR_MS;
  const mode = options.mode ?? "stream";
  const startTime = Date.now();

  let lastOutput = read();
  let lastChangeAt = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (options.isStopRequested?.()) {
      return {
        success: false,
        message: "Wait aborted: session is no longer active",
        elapsedMs: Date.now() - startTime,
      };
    }

    await sleep(pollIntervalMs);
    const output = read();

    if (output !== lastOutput) {
      lastOutput = output;
      lastChangeAt = Date.now();
      continue;
    }

    const stableMs = Date.now() - lastChangeAt;
    if (stableMs >= stableForMs) {
      return {
        success: true,
        message: `Screen stable for ${stableMs}ms (>= ${stableForMs}ms) after ${Date.now() - startTime}ms`,
        elapsedMs: Date.now() - startTime,
        excerpt: buildExcerpt(output, mode),
      };
    }
  }

  const output = read();
  const excerpt = buildExcerpt(output, mode);
  const sinceLastChange = Date.now() - lastChangeAt;
  const sourceLabel = mode === "buffer" ? "buffer excerpt" : "output excerpt";
  return {
    success: false,
    message: `Timeout after ${timeoutMs}ms waiting for screen stability (required ${stableForMs}ms stable, observed ${sinceLastChange}ms since last change). Current ${sourceLabel}:\n${excerpt}`,
    elapsedMs: Date.now() - startTime,
    excerpt,
  };
}

function compilePattern(pattern: string | RegExp, patternMode: PatternMode): RegExp {
  if (pattern instanceof RegExp) {
    return pattern;
  }
  if (patternMode === "regex") {
    return new RegExp(pattern, "m");
  }
  return new RegExp(escapeRegex(pattern), "m");
}

function describePattern(pattern: string | RegExp, patternMode: PatternMode): string {
  if (pattern instanceof RegExp) {
    return `regex ${pattern.toString()}`;
  }
  if (patternMode === "regex") {
    return `regex /${pattern}/`;
  }
  return `text "${pattern}"`;
}

export function buildExcerpt(output: string, mode: WaitMode): string {
  if (output.length === 0) {
    return "<empty>";
  }

  if (mode === "buffer") {
    const lines = output.split("\n").map((line) => line.replace(/\s+$/g, ""));
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    const excerpt = lines.slice(-12).join("\n").trim();
    return excerpt.length > 0 ? excerpt : "<empty>";
  }

  return output.slice(-400);
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
