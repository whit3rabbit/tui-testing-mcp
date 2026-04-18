/**
 * Shell adapter contracts.
 *
 * A shell adapter describes how to invoke a single shell binary with one
 * command string. Adapters are deliberately separate from runner adapters
 * (which discover project targets): a shell concerns the process-launch
 * mechanics, while a runner concerns project-aware build/launch/test
 * resolution.
 *
 * Direct executable launches do not use this interface at all; they spawn
 * the requested program with the caller's argv unchanged. The shell
 * abstraction only engages when shell-backed execution is explicitly
 * requested.
 */

export interface ShellInvocationOptions {
  /**
   * Whether to start the shell as a login shell. Defaults are decided by
   * the resolver, not the adapter.
   */
  login: boolean;

  /**
   * Optional override of the shell binary path. When omitted the adapter's
   * `defaultPath` is used.
   */
  path?: string;
}

export interface ShellInvocation {
  command: string;
  args: string[];
}

export interface ShellAdapter {
  /** Stable identifier (e.g. "sh", "bash", "zsh", "fish"). */
  readonly id: string;

  /** Default executable path used when the resolver has no explicit path. */
  readonly defaultPath: string;

  /**
   * Build the argv for invoking the shell with a single command string.
   *
   * Implementations SHOULD reject empty commands so the failure surfaces
   * before a process is spawned.
   */
  buildInvocation(command: string, options: ShellInvocationOptions): ShellInvocation;
}
