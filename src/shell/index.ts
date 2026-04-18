/**
 * Shell abstraction entry point.
 *
 * This module is the only place that decides:
 *   - which shell binary to invoke for a shell-backed launch
 *   - whether that shell runs as a login or non-login shell
 *   - how the inline command string is wrapped into argv for that shell
 *
 * Direct executable launches do not pass through here.
 */

import * as path from "path";
import { bashAdapter, fishAdapter, shAdapter, zshAdapter } from "./unix.js";
import { cmdAdapter } from "./windows.js";
import type { ShellAdapter, ShellInvocation } from "./types.js";

export type { ShellAdapter, ShellInvocation, ShellInvocationOptions } from "./types.js";

const ADAPTERS: Record<string, ShellAdapter> = {
  [shAdapter.id]: shAdapter,
  [bashAdapter.id]: bashAdapter,
  [zshAdapter.id]: zshAdapter,
  [fishAdapter.id]: fishAdapter,
  [cmdAdapter.id]: cmdAdapter,
};

export const SUPPORTED_SHELLS: ReadonlyArray<string> = Object.freeze(Object.keys(ADAPTERS));

const DEFAULT_FALLBACK_SHELL = process.platform === "win32" ? "cmd" : "sh";

/**
 * Look up an adapter by id. Returns undefined for unsupported shells so
 * callers can produce an error that lists the supported set.
 */
export function getShellAdapter(name: string): ShellAdapter | undefined {
  return ADAPTERS[name];
}

/**
 * Derive a shell id from an executable path (e.g. "/usr/local/bin/zsh"
 * → "zsh"). Returns undefined when the basename is not one of the
 * supported shells.
 */
export function inferShellName(envShell: string | undefined): string | undefined {
  if (!envShell || envShell.length === 0) {
    return undefined;
  }
  const base = path.basename(envShell);
  return base in ADAPTERS ? base : undefined;
}

export interface ShellLaunchOptions {
  /** Shell id from {@link SUPPORTED_SHELLS}. */
  name?: string;
  /** Run as a login shell. Defaults to true to preserve historical behavior. */
  login?: boolean;
  /** Override the shell binary path. */
  path?: string;
}

export interface ShellLaunchDefaults {
  name?: string;
  login?: boolean;
}

export interface ShellResolution {
  adapter: ShellAdapter;
  path: string;
  login: boolean;
}

/**
 * Resolve a shell adapter and invocation parameters from explicit options,
 * config-level defaults, and the caller's environment.
 *
 * Precedence for the shell id: explicit > defaults > inferred from
 * `process.env.SHELL` > sh fallback.
 *
 * Throws when the resolved id is not in {@link SUPPORTED_SHELLS} so silent
 * fallback to an arbitrary `/bin/sh` flavor cannot happen.
 */
export function resolveShell(
  options: ShellLaunchOptions | undefined,
  envShell: string | undefined,
  defaults: ShellLaunchDefaults | undefined
): ShellResolution {
  const name =
    options?.name ?? defaults?.name ?? inferShellName(envShell) ?? DEFAULT_FALLBACK_SHELL;

  const adapter = getShellAdapter(name);
  if (!adapter) {
    throw new Error(
      `Unsupported shell '${name}'. Supported shells: ${SUPPORTED_SHELLS.join(", ")}`
    );
  }

  const explicitPath = options?.path && options.path.length > 0 ? options.path : undefined;
  const inferredPath =
    !explicitPath && envShell && envShell.length > 0 && inferShellName(envShell) === adapter.id
      ? envShell
      : undefined;
  const resolvedPath = explicitPath ?? inferredPath ?? adapter.defaultPath;

  const login = options?.login ?? defaults?.login ?? true;

  return { adapter, path: resolvedPath, login };
}

/**
 * Build the spawn-ready invocation for a shell-backed launch. Validates
 * the command string before any process is created.
 */
export function buildShellInvocation(
  command: string,
  resolution: ShellResolution
): ShellInvocation {
  return resolution.adapter.buildInvocation(command, {
    login: resolution.login,
    path: resolution.path,
  });
}
