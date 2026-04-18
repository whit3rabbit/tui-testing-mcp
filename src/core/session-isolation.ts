import * as fs from "fs";
import * as path from "path";
import type { SessionEnvironmentConfig, SessionIsolationConfig, WorkingDirectoryIsolationConfig } from "../config/schema.js";
import { SecurityPolicyManager } from "../security/manager.js";
import type { SessionIsolationState } from "./session.js";
import { isPathWithin } from "../utils.js";

/**
 * Minimal env keys copied when inheritance is disabled. Sufficient for
 * shell startup (PATH), locale-sensitive CLIs (LANG, LC_*), terminal
 * detection (TERM), temp-file handling (TMPDIR/TMP/TEMP), and home-path
 * resolution (HOME, USER). Anything outside this set is explicit opt-in.
 */
const POSIX_MINIMAL_ENV_KEYS: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "TMPDIR",
  "TMP",
  "TEMP",
];
const WINDOWS_MINIMAL_ENV_KEYS: ReadonlyArray<string> = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "ComSpec",
  "SystemRoot",
  "PATHEXT",
  "TERM",
  "LANG",
  "TMP",
  "TEMP",
];
const MINIMAL_ENV_KEY_PATTERNS: ReadonlyArray<RegExp> = [/^LC_/];

/**
 * Secret env var patterns that are ALWAYS dropped, even when inheritEnv
 * is enabled. This provides defense-in-depth against credential leakage.
 * Patterns match common cloud provider, CI/CD, and service tokens.
 */
const SECRET_VAR_PATTERNS: ReadonlyArray<RegExp> = [
  // AWS
  /AWS_ACCESS_KEY_ID/i,
  /AWS_SECRET_ACCESS_KEY/i,
  /AWS_SESSION_TOKEN/i,
  /AWS_DEFAULT_REGION/i,
  // Azure
  /AZURE_/i,
  /ARM_/i,
  // GCP
  /GOOGLE_/i,
  /GCP_/i,
  // GitHub
  /GH_TOKEN/i,
  /GITHUB_TOKEN/i,
  /GITHUB_APP_/i,
  // GitLab
  /GITLAB_TOKEN/i,
  /GITLAB_API_TOKEN/i,
  // Heroku
  /HEROKU_/i,
  // Stripe
  /STRIPE_/i,
  // OpenAI / Anthropic
  /OPENAI_API_KEY/i,
  /ANTHROPIC_API_KEY/i,
  // Generic
  /API_KEY/i,
  /API_SECRET/i,
  /SECRET_KEY/i,
  /ACCESS_TOKEN/i,
  /AUTH_TOKEN/i,
  /BEARER_TOKEN/i,
  /TOKEN/i,
  /PASSWORD/i,
  /SECRET/i,
  /PRIVATE_KEY/i,
  /SSH_/i,
  // CI/CD common vars
  /CI_/i,
  /JENKINS_/i,
  /CIRCLECI_/i,
  /GITLAB_CI/i,
  /GITHUB_/i,
  // Database
  /DATABASE_URL/i,
  /DB_/i,
  /MONGODB_/i,
  /POSTGRES_/i,
  /MYSQL_/i,
  /REDIS_/i,
  // npm / package managers
  /NPM_/i,
  /YARN_/i,
  /NPM_TOKEN/i,
  /NPM_API_TOKEN/i,
  // Docker
  /DOCKER_/i,
];

/**
 * Execution-modifying environment variables that must ALWAYS be dropped,
 * even when inheritEnv is enabled. These variables can change the behavior
 * of interpreters (Node, Python, Ruby, etc.) to execute arbitrary code or
 * load unintended modules.
 */
const EXECUTION_MODIFIER_PATTERNS: ReadonlyArray<RegExp> = [
  /^NODE_OPTIONS$/i,
  /^PYTHONSTARTUP$/i,
  /^PYTHONPATH$/i,
  /^RUBYOPT$/i,
  /^RUBYLIB$/i,
  /^PERL5OPT$/i,
  /^PERL5LIB$/i,
  /^LD_PRELOAD$/i,
  /^LD_LIBRARY_PATH$/i,
  /^DYLD_INSERT_LIBRARIES$/i,
  /^DYLD_LIBRARY_PATH$/i,
  /^BASH_ENV$/i,
  /^ENV$/i,
  /^PROMPT_COMMAND$/i,
];

function isBlockedVar(key: string): boolean {
  return (
    SECRET_VAR_PATTERNS.some((pat) => pat.test(key)) ||
    EXECUTION_MODIFIER_PATTERNS.some((pat) => pat.test(key))
  );
}

function isWindowsPlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

function getMinimalEnvKeys(platform: NodeJS.Platform): ReadonlyArray<string> {
  return isWindowsPlatform(platform) ? WINDOWS_MINIMAL_ENV_KEYS : POSIX_MINIMAL_ENV_KEYS;
}

function matchesMinimalEnvKey(
  platform: NodeJS.Platform,
  key: string,
  minimalKeys: ReadonlyArray<string>
): boolean {
  if (isWindowsPlatform(platform)) {
    const folded = key.toUpperCase();
    return minimalKeys.some((candidate) => candidate.toUpperCase() === folded);
  }
  return minimalKeys.includes(key);
}

function getPathValue(source: Record<string, string | undefined>): string | undefined {
  return source.Path ?? source.PATH ?? source.path;
}

function deletePathKeys(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") {
      delete env[key];
    }
  }
}

function getFallbackPath(
  platform: NodeJS.Platform,
  sourceEnv: Record<string, string | undefined>
): string {
  if (!isWindowsPlatform(platform)) {
    return "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }

  const systemRoot = sourceEnv.SystemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
  return [
    path.win32.join(systemRoot, "System32"),
    systemRoot,
    path.win32.join(systemRoot, "System32", "Wbem"),
  ].join(";");
}

function normalizePathEnv(env: Record<string, string>, platform: NodeJS.Platform): void {
  const pathValue = getPathValue(env);
  deletePathKeys(env);
  env[isWindowsPlatform(platform) ? "Path" : "PATH"] = pathValue ?? getFallbackPath(platform, env);
}

/**
 * Build the env passed to a child spawn.
 *
 * Inherit resolution order:
 *   1. Explicit `environment.inherit` on the session isolation block
 *   2. Project-wide `security.inheritEnv` (the frozen policy)
 *   3. Default: `false` (minimal allowlist only)
 *
 * Prior to 2.0 the default was to copy all of `process.env`. That default
 * leaked every secret the server process carried (API keys, SSH agent
 * vars, cloud credentials) into every child. The new default copies only
 * a minimal, well-known safe set (PATH, HOME, LC_*, etc.). Callers that
 * want the old behavior must opt in explicitly via `security.inheritEnv`
 * or per-session `isolation.environment.inherit`.
 */
export function buildChildEnv(
  sourceEnv: NodeJS.ProcessEnv,
  security: SecurityPolicyManager,
  overrides?: Record<string, string>,
  environment?: SessionEnvironmentConfig,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const env: Record<string, string> = {};
  const inherit = environment?.inherit ?? security.policy.inheritEnv ?? false;
  const minimalKeys = getMinimalEnvKeys(platform);

  if (inherit) {
    // Even with full inheritance enabled, drop known secret patterns as
    // defense-in-depth. This prevents accidental credential leakage even
    // when the caller explicitly opts into inheritance.
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (typeof value === "string" && !isBlockedVar(key)) {
        env[key] = value;
      }
    }
  } else {
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (typeof value !== "string") continue;
      if (
        matchesMinimalEnvKey(platform, key, minimalKeys) ||
        MINIMAL_ENV_KEY_PATTERNS.some((pat) => pat.test(key))
      ) {
        env[key] = value;
      }
    }
  }

  if (overrides) {
    Object.assign(env, overrides);
  }

  // Spawn safety: node-pty requires a usable PATH/Path to resolve `file`
  // when the caller did not hand us an absolute path.
  normalizePathEnv(env, platform);

  const shaped =
    environment?.allow && environment.allow.length > 0
      ? pickEnvKeys(env, environment.allow)
      : env;

  normalizePathEnv(shaped, platform);
  return security.filterEnv(shaped);
}

export function mergeEnv(
  security: SecurityPolicyManager,
  overrides?: Record<string, string>,
  environment?: SessionEnvironmentConfig
): Record<string, string> {
  return buildChildEnv(process.env, security, overrides, environment, process.platform);
}

export function mergeIsolation(
  base?: SessionIsolationConfig,
  override?: SessionIsolationConfig
): SessionIsolationConfig | undefined {
  const environment = base?.environment || override?.environment
    ? {
        inherit: override?.environment?.inherit ?? base?.environment?.inherit,
        allow: override?.environment?.allow ?? base?.environment?.allow,
        set: {
          ...(base?.environment?.set ?? {}),
          ...(override?.environment?.set ?? {}),
        },
      }
    : undefined;
  const workingDirectory = base?.workingDirectory || override?.workingDirectory
    ? {
        mode: override?.workingDirectory?.mode ?? base?.workingDirectory?.mode,
        copyFrom: override?.workingDirectory?.copyFrom ?? base?.workingDirectory?.copyFrom,
        retain: override?.workingDirectory?.retain ?? base?.workingDirectory?.retain,
      }
    : undefined;

  if (!environment && !workingDirectory) {
    return undefined;
  }

  return {
    ...(environment ? { environment } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
  };
}

export function normalizeIsolationConfig(
  isolation: SessionIsolationConfig | undefined,
  cwd: string | undefined,
  workspaceRoot: string
): SessionIsolationConfig | undefined {
  if (!isolation?.workingDirectory?.copyFrom) {
    return isolation;
  }

  return {
    ...isolation,
    workingDirectory: {
      ...isolation.workingDirectory,
      copyFrom: path.resolve(cwd ?? workspaceRoot, isolation.workingDirectory.copyFrom),
    },
  };
}

export function prepareSessionIsolation(
  sessionId: string,
  cwd: string | undefined,
  isolation: SessionIsolationConfig | undefined,
  workspaceRoot: string
): { cwd: string | undefined; isolation?: SessionIsolationState } {
  const runtime = buildIsolationState(isolation);
  const workingDirectory = isolation?.workingDirectory;
  if (!workingDirectory?.mode) {
    return { cwd, isolation: runtime };
  }

  const sessionsRoot = path.join(workspaceRoot, ".tui-test", "sessions");
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const isolatedPath = fs.mkdtempSync(path.join(sessionsRoot, `${sanitizePathSegment(sessionId)}-`));
  const sourcePath = resolveIsolationSource(workingDirectory, cwd);

  if (workingDirectory.mode === "copy") {
    copyFixtureContents(sourcePath, isolatedPath);
  }

  return {
    cwd: isolatedPath,
    isolation: {
      ...runtime,
      workingDirectory: {
        mode: workingDirectory.mode,
        path: isolatedPath,
        sourcePath,
        retain: workingDirectory.retain ?? false,
        cleanup: "pending",
      },
    },
  };
}

export function cleanupIsolation(isolation?: SessionIsolationState): void {
  const workingDirectory = isolation?.workingDirectory;
  if (!workingDirectory || workingDirectory.cleanup !== "pending") {
    return;
  }

  if (workingDirectory.retain) {
    workingDirectory.cleanup = "retained";
    workingDirectory.cleanupError = undefined;
    return;
  }

  try {
    // maxRetries/retryDelay handle Windows EBUSY/EPERM/ENOTEMPTY when the
    // child's handle to the isolated workdir is still releasing after the PTY
    // exits. Node's built-in linear backoff retries up to 10 * 100ms = ~5.5s.
    // No-op on Unix, where the first rmSync succeeds.
    fs.rmSync(workingDirectory.path, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    workingDirectory.cleanup = "cleaned";
    workingDirectory.cleanupError = undefined;
  } catch (error) {
    workingDirectory.cleanup = "failed";
    workingDirectory.cleanupError = error instanceof Error ? error.message : String(error);
  }
}

export function cloneIsolationState(isolation?: SessionIsolationState): SessionIsolationState | undefined {
  if (!isolation) {
    return undefined;
  }

  return {
    ...(isolation.environment
      ? {
          environment: {
            inherit: isolation.environment.inherit,
            allow: isolation.environment.allow ? [...isolation.environment.allow] : undefined,
            setKeys: [...isolation.environment.setKeys],
          },
        }
      : {}),
    ...(isolation.workingDirectory
      ? {
          workingDirectory: {
            ...isolation.workingDirectory,
          },
        }
      : {}),
  };
}

function buildIsolationState(isolation: SessionIsolationConfig | undefined): SessionIsolationState | undefined {
  if (!isolation?.environment) {
    return undefined;
  }

  return {
    environment: {
      inherit: isolation.environment.inherit ?? true,
      allow: isolation.environment.allow ? [...isolation.environment.allow] : undefined,
      setKeys: Object.keys(isolation.environment.set ?? {}),
    },
  };
}

function resolveIsolationSource(
  workingDirectory: WorkingDirectoryIsolationConfig,
  cwd: string | undefined
): string | undefined {
  if (workingDirectory.mode !== "copy") {
    return undefined;
  }

  const sourcePath = workingDirectory.copyFrom ?? cwd;
  if (!sourcePath) {
    throw new Error("workingDirectory.mode='copy' requires copyFrom or cwd");
  }

  return sourcePath;
}

function copyFixtureContents(sourcePath: string | undefined, destinationRoot: string): void {
  if (!sourcePath) {
    return;
  }

  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(sourcePath)) {
      const sourceEntry = path.join(sourcePath, entry);
      if (isSameOrParentPath(sourceEntry, destinationRoot)) {
        continue;
      }
      fs.cpSync(sourceEntry, path.join(destinationRoot, entry), { recursive: true });
    }
    return;
  }

  if (stat.isFile()) {
    fs.copyFileSync(sourcePath, path.join(destinationRoot, path.basename(sourcePath)));
    return;
  }

  throw new Error(`Unsupported fixture source: ${sourcePath}`);
}

function pickEnvKeys(env: Record<string, string>, allowedKeys: string[]): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const key of allowedKeys) {
    if (key in env) {
      filtered[key] = env[key];
    }
  }

  return filtered;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function isSameOrParentPath(parent: string, candidate: string): boolean {
  return isPathWithin(parent, candidate);
}
