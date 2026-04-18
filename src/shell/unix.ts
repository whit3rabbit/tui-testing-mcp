/**
 * Unix shell adapters.
 *
 * Each adapter encodes how its shell consumes a single inline command
 * string and how login mode is requested. Quoting is deliberately not
 * performed here: the caller passes a fully-formed shell command and the
 * adapter forwards it verbatim through the shell's own `-c` parameter,
 * which is the only contract the adapter promises to respect.
 */

import type { ShellAdapter, ShellInvocation, ShellInvocationOptions } from "./types.js";

function requireCommand(id: string, command: string): void {
  if (command.trim().length === 0) {
    throw new Error(`shell '${id}' requires a non-empty command string`);
  }
}

function resolvePath(adapter: { defaultPath: string }, options: ShellInvocationOptions): string {
  return options.path && options.path.length > 0 ? options.path : adapter.defaultPath;
}

/**
 * sh/bash/zsh accept a combined `-lc` flag for "login + command" or `-c`
 * for non-login. Keeping the combined login form preserves the historical
 * argv shape the project has shipped.
 */
function makeBourneAdapter(id: string, defaultPath: string): ShellAdapter {
  const adapter: ShellAdapter = {
    id,
    defaultPath,
    buildInvocation(command, options): ShellInvocation {
      requireCommand(id, command);
      const path = resolvePath(adapter, options);
      const flag = options.login ? "-lc" : "-c";
      return { command: path, args: [flag, command] };
    },
  };
  return adapter;
}

/**
 * fish does not support a combined `-lc`. Login mode is a separate flag
 * that must precede `-c`.
 */
function makeFishAdapter(): ShellAdapter {
  const id = "fish";
  const defaultPath = "/usr/bin/fish";
  const adapter: ShellAdapter = {
    id,
    defaultPath,
    buildInvocation(command, options): ShellInvocation {
      requireCommand(id, command);
      const path = resolvePath(adapter, options);
      const args = options.login ? ["-l", "-c", command] : ["-c", command];
      return { command: path, args };
    },
  };
  return adapter;
}

export const shAdapter = makeBourneAdapter("sh", "/bin/sh");
export const bashAdapter = makeBourneAdapter("bash", "/bin/bash");
export const zshAdapter = makeBourneAdapter("zsh", "/bin/zsh");
export const fishAdapter = makeFishAdapter();
