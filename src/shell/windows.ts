/**
 * Windows shell adapter (cmd.exe).
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
 * cmd.exe uses /c to run a command and then terminate.
 */
export const cmdAdapter: ShellAdapter = {
  id: "cmd",
  defaultPath: "cmd.exe",
  buildInvocation(command, options): ShellInvocation {
    requireCommand("cmd", command);
    const path = resolvePath(this, options);
    // On Windows, /c is the standard for inline command execution.
    // We don't have a direct "login" analog for cmd.exe like bash -l,
    // so we ignore the login flag if provided.
    return { command: path, args: ["/c", command] };
  },
};
