/**
 * Security policy manager.
 *
 * Each manager wraps a SecurityContext frozen at construction time. Callers
 * build one per request/session instead of sharing a process-global mutable
 * singleton so concurrent MCP invocations cannot clobber each other's rules.
 */

import type { SecurityContext, SecurityPolicy } from "./policy.js";
import {
  filterEnvVars,
  freezePolicy,
  isArgvSafe,
  isCommandAllowed,
  isShellAllowed,
  isShellEvalAllowed,
  isWithinWorkspace,
} from "./policy.js";

export class SecurityPolicyManager {
  readonly policy: SecurityContext;

  constructor(policy: SecurityPolicy) {
    this.policy = freezePolicy(policy);
  }

  /**
   * Check if a command is allowed by the security policy.
   * For high-risk commands (python, node, git, etc.), also validates argv.
   *
   * @param command - The executable path or name
   * @param args - The argument array (optional, for argv validation on risky commands)
   * @param env - The environment variables for the command (optional, for PATH resolution)
   */
  checkCommand(command: string, args: string[] = [], env?: Record<string, string>): void {
    if (!isCommandAllowed(this.policy, command, env)) {
      throw new Error(`Command denied by security policy: ${command}`);
    }

    // Validate argv for high-risk commands (only when there's an active policy)
    if (args.length > 0 && !isArgvSafe(this.policy, command, args, env)) {
      throw new Error(
        `Command arguments denied by security policy for ${command}. ` +
        `The provided arguments contain dangerous flag combinations.`
      );
    }
  }

  checkWorkspace(path: string): void {
    if (!isWithinWorkspace(this.policy, path)) {
      throw new Error(`Path outside workspace: ${path}`);
    }
  }

  /**
   * Gate on whether a shell binary may be resolved at all.
   */
  checkShellAllowed(): void {
    if (!isShellAllowed(this.policy)) {
      throw new Error("Shell mode is disabled by security policy (security.allowShell)");
    }
  }

  /**
   * Gate on inline shell evaluation. Arbitrary `-c` payloads must pass
   * this check - checkShellAllowed alone is not sufficient.
   */
  checkShellEvalAllowed(): void {
    if (!isShellAllowed(this.policy)) {
      throw new Error("Shell mode is disabled by security policy (security.allowShell)");
    }
    if (!isShellEvalAllowed(this.policy)) {
      throw new Error(
        "Inline shell eval is disabled by security policy. " +
        "Set security.allowShellEval=true to pass arbitrary commands through shell -c."
      );
    }
  }

  filterEnv(env: Record<string, string>): Record<string, string> {
    return filterEnvVars(this.policy, env);
  }
}

