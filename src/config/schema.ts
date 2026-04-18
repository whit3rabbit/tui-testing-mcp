/**
 * Zod schemas for tui-test.json configuration.
 */
import { z } from "zod";

export const sessionEnvironmentSchema = z.object({
  inherit: z.boolean().optional(),
  allow: z.array(z.string()).optional(),
  set: z.record(z.string(), z.string()).optional(),
});

export const workingDirectoryIsolationSchema = z.object({
  mode: z.enum(["temp", "copy"]).optional(),
  copyFrom: z.string().optional(),
  retain: z.boolean().optional(),
});

export const sessionIsolationSchema = z.object({
  environment: sessionEnvironmentSchema.optional(),
  workingDirectory: workingDirectoryIsolationSchema.optional(),
});

export type SessionEnvironmentConfig = z.infer<typeof sessionEnvironmentSchema>;
export type WorkingDirectoryIsolationConfig = z.infer<typeof workingDirectoryIsolationSchema>;
export type SessionIsolationConfig = z.infer<typeof sessionIsolationSchema>;

/**
 * Schema for target configuration.
 */
export const targetSchema = z.object({
  runner: z.enum(["cargo", "go", "python", "node", "binary"]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  isolation: sessionIsolationSchema.optional(),
  build: z.array(z.string()).optional(),
  launch: z.array(z.string()),
  test: z.array(z.string()).optional(),
});

export type TargetConfig = z.infer<typeof targetSchema>;

export const securitySchema = z.object({
  /**
   * Exact basename ("bash") or absolute-path ("/bin/bash") rules. Rules
   * containing a path separator match via realpath; bare names match
   * path.basename(realpath(command)).
   */
  allowedCommands: z.array(z.string()).optional(),
  deniedCommands: z.array(z.string()).optional(),
  /**
   * Permits shell-backed launches to resolve a shell binary. Does NOT by
   * itself authorize `shell: true` with an inline -c payload - that
   * requires allowShellEval as well.
   */
  allowShell: z.boolean().optional(),
  /**
   * Permits `shell: true` launches to pass an arbitrary command string
   * through the shell's -c flag. Default false because forwarding a
   * caller string through bash -c bypasses allowedCommands entirely.
   */
  allowShellEval: z.boolean().optional(),
  envAllowlist: z.array(z.string()).optional(),
  /**
   * Default process-env inheritance for session launches. When true, the
   * parent process env is copied by default (pre-2.0 behavior). When
   * unset or false, only a minimal safe allowlist is copied unless the
   * session overrides with isolation.environment.inherit.
   */
  inheritEnv: z.boolean().optional(),
  /**
   * Extra regex strings (global flag implied) appended to the built-in
   * artifact redactors. Invalid patterns fail validation.
   */
  artifactRedactions: z.array(z.string()).optional(),
  artifactRetention: z
    .object({
      maxAgeHours: z.number().positive().optional(),
      maxBundles: z.number().int().positive().optional(),
    })
    .optional(),
});

/**
 * Project-level defaults for shell-backed launches. Adapter selection is
 * validated at resolution time, not here, so unknown shell ids fail with a
 * clear runtime error instead of a generic schema rejection.
 */
export const shellDefaultsSchema = z.object({
  name: z.string().optional(),
  login: z.boolean().optional(),
});

export type ShellDefaultsConfig = z.infer<typeof shellDefaultsSchema>;

/**
 * Project-level defaults for the optional Microsoft TUI Test bridge. The
 * bridge is only invoked when a caller uses the dedicated bridge tool; this
 * block supplies defaults for that explicit opt-in path and has no effect on
 * the core PTY session tools.
 */
export const microsoftTuiTestSchema = z.object({
  configFile: z.string().optional(),
  cwd: z.string().optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
});

export type MicrosoftTuiTestConfig = z.infer<typeof microsoftTuiTestSchema>;

/**
 * Schema for the full configuration file.
 */
export const configSchema = z.object({
  workspaceRoot: z.string(),
  targets: z.record(z.string(), targetSchema).optional(),
  security: securitySchema.optional(),
  shell: shellDefaultsSchema.optional(),
  microsoftTuiTest: microsoftTuiTestSchema.optional(),
});

export type TuiTestConfig = z.infer<typeof configSchema>;

/**
 * Validate config against the schema.
 */
export function validateConfig(config: unknown): TuiTestConfig {
  return configSchema.parse(config);
}

/**
 * Parse config with error handling.
 */
export function safeParseConfig(config: unknown): {
  success: boolean;
  data?: TuiTestConfig;
  error?: string;
} {
  try {
    const data = configSchema.parse(config);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
