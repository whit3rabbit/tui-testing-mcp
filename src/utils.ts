import * as path from "path";
import * as fs from "fs";

/**
 * Shared utilities.
 */

/**
 * Sleep for the specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join("|"),
  "g"
);

/**
 * Strips ANSI escape codes from a string.
 */
export function stripAnsi(value: string): string {
  if (typeof value !== "string") return value;
  return value.replace(ANSI_PATTERN, "");
}

/**
 * Normalize a path, expanding ~ to home and resolving symlinks.
 * If the path (or its parents) do not exist, it resolves as much as possible.
 */
export function normalizePath(inputPath: string): string {
  const expanded = inputPath.replace(/^~/, process.env.HOME ?? "");
  const absolute = path.resolve(expanded);

  try {
    return fs.realpathSync(absolute);
  } catch {
    const segments: string[] = [];
    let current = absolute;

    while (!fs.existsSync(current)) {
      segments.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    const existingRoot = fs.existsSync(current) ? fs.realpathSync(current) : path.resolve(current);
    return path.join(existingRoot, ...segments);
  }
}

/**
 * Check if a candidate path is within (or equal to) a parent directory.
 * Immune to prefix-spoofing (e.g., /app/workspace-hacked vs /app/workspace).
 */
export function isPathWithin(parent: string, candidate: string): boolean {
  const normParent = normalizePath(parent);
  const normCandidate = normalizePath(candidate);
  const relative = path.relative(normParent, normCandidate);

  // path.relative returns "" for identical paths.
  // On POSIX, it uses ".." to go up. On Windows, it may return an absolute path
  // if drives differ.
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}