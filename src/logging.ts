/**
 * Logging utilities.
 * All logs go to stderr to avoid corrupting stdout (used for MCP stdio).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

/**
 * Set the log level.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Log a debug message.
 */
export function debug(...args: unknown[]): void {
  log("debug", ...args);
}

/**
 * Log an info message.
 */
export function info(...args: unknown[]): void {
  log("info", ...args);
}

/**
 * Log a warning.
 */
export function warn(...args: unknown[]): void {
  log("warn", ...args);
}

/**
 * Log an error.
 */
export function error(...args: unknown[]): void {
  log("error", ...args);
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    const prefix = `[${level.toUpperCase()}]`;
    const message = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    process.stderr.write(`${prefix} ${message}\n`);
  }
}