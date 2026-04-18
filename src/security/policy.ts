/**
 * Security policy for command execution.
 *
 * Predicates here are pure. Runtime enforcement lives in
 * SecurityPolicyManager, which wraps a frozen policy so a single request
 * can never mutate another request's view of the rules.
 */

import * as fs from "fs";
import * as path from "path";
import { isPathWithin } from "../utils.js";

/**
 * High-risk commands where argv validation is necessary because the
 * command itself may be allowed, but certain flag combinations are dangerous.
 */
const RISKY_COMMANDS = new Set([
  "python",
  "python3",
  "python3.11",
  "python3.12",
  "node",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "bun",
  "deno",
  "bash",
  "sh",
  "zsh",
  "fish",
  "powershell",
  "pwsh",
  "git",
  "cargo",
  "go",
  "ruby",
  "perl",
  "php",
  "lua",
  "expect",
]);

/**
 * Dangerous argv patterns per command. These patterns are matched against
 * the full argv array to catch flag combinations that could execute
 * arbitrary code or expose sensitive data.
 */
const DANGEROUS_ARGV_PATTERNS: Record<string, RegExp[]> = {
  // Git hooks can execute arbitrary code
  git: [
    /--upload-pack(?:=.*)?$/,
    /--receive-pack(?:=.*)?$/,
    /-c[=\s].*\.git[=\s]/,
    /--exec(?:=.*)?$/,
  ],
  // Node can eval arbitrary code or load modules
  node: [
    /^-e(?:.+)?$/,
    /^--eval(?:=.*)?$/,
    /^-p(?:.+)?$/,
    /^--print(?:=.*)?$/,
    /^-r(?:.+)?$/,
    /^--require(?:=.*)?$/,
    /^--loader(?:=.*)?$/,
    /^--import(?:=.*)?$/,
    /^--inspect(?:-.*)?(?:=.*)?$/,
    /^--experimental-/,
    /--check\b/,
  ],
  deno: [
    /^-e(?:.+)?$/,
    /^--eval(?:=.*)?$/,
    /^--allow-all$/,
    /^-A$/,
    /^--allow-run(?:=.*)?$/,
    /^--allow-write(?:=.*)?$/,
    /^--allow-net(?:=.*)?$/,
    /^--allow-ffi(?:=.*)?$/,
    /^--allow-env(?:=.*)?$/,
  ],
  // Python can run code from command line or load modules
  python: [
    /^-c(?:.+)?$/,
    /^--command(?:=.*)?$/,
    /^-m(?:.+)?$/,
    /^-i$/,
  ],
  python3: [
    /^-c(?:.+)?$/,
    /^--command(?:=.*)?$/,
    /^-m(?:.+)?$/,
    /^-i$/,
  ],
  // Shell invocation is inherently dangerous
  bash: [/^-c(?:.+)?$/, /^--posix$/],
  sh: [/^-c(?:.+)?$/],
  zsh: [/^-c(?:.+)?$/],
  powershell: [/^-c$/, /^-Command$/, /^-File$/],
  pwsh: [/^-c$/, /^-Command$/, /^-File$/],
  // Package manager scripts can run arbitrary code
  npm: [/^exec$/, /^run-script$/, /^--script/],
  npx: [/^-y$/, /^--yes$/],
  yarn: [/^add$/, /^run$/],
  pnpm: [/^add$/, /^exec$/],
  // Build tools can execute arbitrary commands
  cargo: [/^run$/, /^test$/, /^build$/, /^--script/],
  go: [/^run$/, /^test$/, /^build$/, /^execute$/],
  // Script interpreters
  ruby: [/^-e$/, /^-r$/, /^--runner/],
  perl: [/^-e$/, /^-r$/],
  php: [/^-r$/, /^--define/],
};

const DANGEROUS_ENV_PATTERNS: Record<string, RegExp[]> = {
  node: [/^NODE_OPTIONS$/i],
  deno: [/^DENO_AUTH_TOKENS$/i, /^DENO_DIR$/i],
  python: [/^PYTHONSTARTUP$/i, /^PYTHONPATH$/i],
  python3: [/^PYTHONSTARTUP$/i, /^PYTHONPATH$/i],
  bash: [/^BASH_ENV$/i, /^ENV$/i],
  sh: [/^ENV$/i],
  zsh: [/^ZDOTDIR$/i, /^ENV$/i],
  powershell: [/^PSMODULEPATH$/i],
  pwsh: [/^PSMODULEPATH$/i],
  ruby: [/^RUBYOPT$/i, /^RUBYLIB$/i],
  perl: [/^PERL5OPT$/i, /^PERL5LIB$/i],
  git: [/^GIT_CONFIG_(?:COUNT|KEY_\\d+|VALUE_\\d+|SYSTEM|GLOBAL)$/i, /^GIT_EXEC_PATH$/i],
};

export interface ArtifactRetentionPolicy {
  /** Delete bundles older than this many hours. */
  maxAgeHours?: number;
  /** Keep at most this many bundles per session id; oldest deleted first. */
  maxBundles?: number;
}

export interface SecurityPolicy {
  workspaceRoot: string;
  allowedCommands?: string[];
  deniedCommands?: string[];
  /**
   * Whether shell-backed launches may resolve a shell binary. Does NOT by
   * itself permit inline shell evaluation - see allowShellEval.
   */
  allowShell?: boolean;
  /**
   * Whether `shell: true` launches may pass an arbitrary command string
   * through the shell's -c flag. Separated from allowShell so policies
   * can whitelist a shell binary (for adapters/tools that need it) without
   * granting universal command execution.
   */
  allowShellEval?: boolean;
  envAllowlist?: string[];
  /**
   * When true, mergeEnv copies the whole parent process env by default
   * (pre-2.0 behavior). When unset or false, mergeEnv copies only a
   * minimal safe allowlist unless a session opts in per-launch.
   */
  inheritEnv?: boolean;
  /**
   * Extra regex strings appended to the built-in artifact redactors.
   * Patterns are compiled with the global flag before being applied.
   * Invalid patterns are silently skipped.
   */
  artifactRedactions?: string[];
  artifactRetention?: ArtifactRetentionPolicy;
}

/**
 * A frozen view of SecurityPolicy. Every SecurityPolicyManager exposes
 * its policy as this type so call sites cannot mutate policy in place.
 */
export type SecurityContext = Readonly<SecurityPolicy>;

/**
 * Deep-freeze a SecurityPolicy into a SecurityContext. Array and object
 * fields are copied before freezing so later mutation of the input does
 * not leak into downstream readers.
 */
export function freezePolicy(policy: SecurityPolicy): SecurityContext {
  const copy: SecurityPolicy = {
    workspaceRoot: policy.workspaceRoot,
  };
  if (policy.allowedCommands) {
    copy.allowedCommands = Object.freeze([...policy.allowedCommands]) as string[];
  }
  if (policy.deniedCommands) {
    copy.deniedCommands = Object.freeze([...policy.deniedCommands]) as string[];
  }
  if (policy.allowShell !== undefined) copy.allowShell = policy.allowShell;
  if (policy.allowShellEval !== undefined) copy.allowShellEval = policy.allowShellEval;
  if (policy.envAllowlist) {
    copy.envAllowlist = Object.freeze([...policy.envAllowlist]) as string[];
  }
  if (policy.inheritEnv !== undefined) copy.inheritEnv = policy.inheritEnv;
  if (policy.artifactRedactions) {
    // Validate redaction patterns - fail closed on invalid regex
    for (const pattern of policy.artifactRedactions) {
      try {
        new RegExp(pattern);
      } catch (cause) {
        throw new Error(
          `Invalid artifact redaction pattern: ${pattern}. ` +
          `Patterns must be valid JavaScript regex syntax.`,
          { cause }
        );
      }
    }
    copy.artifactRedactions = Object.freeze([...policy.artifactRedactions]) as string[];
  }
  if (policy.artifactRetention) {
    copy.artifactRetention = Object.freeze({ ...policy.artifactRetention }) as ArtifactRetentionPolicy;
  }
  return Object.freeze(copy);
}

/**
 * Match a single rule (allow or deny entry) against a resolved command.
 *
 * Rules with a path separator are treated as absolute-path rules: both
 * sides are resolved via realpath (or path.resolve on failure) and
 * compared for equality. Rules without a separator are basename rules:
 * the command's realpath basename is compared literally.
 *
 * This closes the earlier exact-string-equality gap where "/bin/bash"
 * failed to match "/usr/bin/bash" even though both resolve to the same
 * interpreter through symlinks.
 */
export function isCommandAllowed(policy: SecurityPolicy, command: string, env?: Record<string, string>): boolean {
  const resolved = resolveCommandForMatching(command, env);
  const basename = path.basename(resolved);

  const matches = (entry: string): boolean => {
    if (entry.includes("/") || entry.includes("\\")) {
      return resolveCommandForMatching(entry, env) === resolved;
    }
    return entry === basename;
  };

  if (policy.deniedCommands?.some(matches)) return false;

  if (policy.allowedCommands && policy.allowedCommands.length > 0) {
    return policy.allowedCommands.some(matches);
  }

  return true;
}

function resolveCommandForMatching(command: string, env?: Record<string, string>): string {
  if (!command.includes("/") && !command.includes("\\")) {
    const onPath = findOnPath(command, env);
    return onPath ?? command;
  }

  const absolute = path.resolve(command);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function findOnPath(name: string, env?: Record<string, string>): string | null {
  const pathVar = env?.PATH ?? env?.Path ?? process.env.PATH ?? "";
  if (!pathVar) return null;
  const separator = process.platform === "win32" ? ";" : ":";
  for (const dir of pathVar.split(separator)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isFile()) return real;
    } catch {
      // candidate not present or not a real file - try the next PATH entry
    }
  }
  return null;
}

/**
 * Check whether the given argv array is safe for the resolved command.
 *
 * Even if the command itself is allowed (e.g., python, node, git), certain
 * flag combinations can execute arbitrary code or expose sensitive data.
 * This function validates argv patterns against known dangerous combinations.
 *
 * argv validation only applies when there is an active command policy
 * (allowlist or denylist). Without such a policy, all commands are allowed
 * anyway, so the validation is redundant and would break tests that use
 * legitimate node -e invocations.
 */
export function isArgvSafe(policy: SecurityPolicy, command: string, argv: string[], env?: Record<string, string>): boolean {
  // Only validate argv when there's an active command policy
  const hasPolicy = (policy.allowedCommands && policy.allowedCommands.length > 0) ||
                    (policy.deniedCommands && policy.deniedCommands.length > 0);
  if (!hasPolicy) {
    return true;
  }

  const resolved = resolveCommandForMatching(command, env);
  const basename = path.basename(resolved).toLowerCase();

  // Strip version suffixes (python3.13 -> python, nodev20 -> node) for matching
  const baseName = basename.replace(/[\d.]+$/, "");

  // Only validate argv for known risky commands
  if (!RISKY_COMMANDS.has(basename) && !RISKY_COMMANDS.has(baseName)) {
    return true;
  }

  // Use the baseName for pattern lookup if available, otherwise use full basename
  const lookupName = RISKY_COMMANDS.has(baseName) ? baseName : basename;
  const patterns = DANGEROUS_ARGV_PATTERNS[lookupName];
  const envPatterns = DANGEROUS_ENV_PATTERNS[lookupName] ?? [];

  // Check each dangerous pattern against the argv
  if (patterns && patterns.length > 0) {
    for (const arg of argv) {
      for (const pattern of patterns) {
        if (pattern.test(arg)) {
          return false;
        }
      }
    }
  }

  if (env && envPatterns.length > 0) {
    for (const key of Object.keys(env)) {
      for (const pattern of envPatterns) {
        if (pattern.test(key)) {
          return false;
        }
      }
    }
  }

  return true;
}

export function isShellAllowed(policy: SecurityPolicy): boolean {
  return policy.allowShell === true;
}

/**
 * Inline shell eval (shell: true with a free-form -c payload) requires
 * both allowShell and allowShellEval because forwarding a caller string
 * through bash -c bypasses isCommandAllowed entirely.
 */
export function isShellEvalAllowed(policy: SecurityPolicy): boolean {
  return policy.allowShell === true && policy.allowShellEval === true;
}

export function isWithinWorkspace(policy: SecurityPolicy, targetPath: string): boolean {
  return isPathWithin(policy.workspaceRoot, targetPath);
}

export function filterEnvVars(policy: SecurityPolicy, env: Record<string, string>): Record<string, string> {
  if (!policy.envAllowlist || policy.envAllowlist.length === 0) {
    return env;
  }

  const filtered: Record<string, string> = {};
  for (const key of policy.envAllowlist) {
    if (key in env) filtered[key] = env[key];
  }
  return filtered;
}
