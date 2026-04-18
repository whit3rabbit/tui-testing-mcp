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

function isWindowsPath(inputPath: string): boolean {
  return /^\\\\/.test(inputPath) || /^[A-Za-z]:[\\/]/.test(inputPath) || inputPath.includes("\\");
}

function getPathApi(...pathsToCheck: string[]): typeof path.posix | typeof path.win32 {
  if (process.platform === "win32" || pathsToCheck.some(isWindowsPath)) {
    return path.win32;
  }
  return path.posix;
}

function getHomeDirectory(windows: boolean): string {
  if (!windows) {
    return process.env.HOME ?? "";
  }

  return (
    process.env.USERPROFILE ??
    (process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : undefined) ??
    process.env.HOME ??
    ""
  );
}

/**
 * Normalize a path, expanding ~ to home and resolving symlinks.
 * If the path (or its parents) do not exist, it resolves as much as possible.
 */
export function normalizePath(inputPath: string): string {
  const pathApi = getPathApi(inputPath);
  const windows = pathApi === path.win32;
  const expanded = inputPath.replace(/^~(?=[\\/]|$)/, getHomeDirectory(windows));
  const absolute = pathApi.resolve(expanded);

  try {
    return fs.realpathSync(absolute);
  } catch {
    const segments: string[] = [];
    let current = absolute;

    while (!fs.existsSync(current)) {
      segments.unshift(pathApi.basename(current));
      const parent = pathApi.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    const existingRoot = fs.existsSync(current) ? fs.realpathSync(current) : pathApi.resolve(current);
    return pathApi.join(existingRoot, ...segments);
  }
}

/**
 * Check if a candidate path is within (or equal to) a parent directory.
 * Immune to prefix-spoofing (e.g., /app/workspace-hacked vs /app/workspace).
 */
export function isPathWithin(parent: string, candidate: string): boolean {
  const pathApi = getPathApi(parent, candidate);
  const normParent = normalizePath(parent);
  const normCandidate = normalizePath(candidate);

  if (pathApi === path.win32) {
    const canonicalParent = path.win32.normalize(normParent).toLowerCase();
    const canonicalCandidate = path.win32.normalize(normCandidate).toLowerCase();
    const relative = path.win32.relative(canonicalParent, canonicalCandidate);

    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.win32.isAbsolute(relative))
    );
  }

  const relative = path.posix.relative(normParent, normCandidate);

  // path.relative returns "" for identical paths.
  // On POSIX, it uses ".." to go up. On Windows, it may return an absolute path
  // if drives differ.
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
