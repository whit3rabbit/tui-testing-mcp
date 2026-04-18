import { getTargetConfig } from "../config/load.js";
import type { SessionIsolationConfig, TuiTestConfig } from "../config/schema.js";
import { runnerRegistry } from "../runners/index.js";
import { SecurityPolicyManager } from "../security/manager.js";
import { buildShellInvocation, resolveShell } from "../shell/index.js";
import type { LaunchConfig } from "./session.js";
import { mergeEnv, mergeIsolation, normalizeIsolationConfig } from "./session-isolation.js";

type ResolvedTarget = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  isolation?: SessionIsolationConfig;
};

export interface ResolvedLaunchConfig {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  isolation?: SessionIsolationConfig;
}

/**
 * Resolve a target name to command spec using config and runner adapters.
 */
export function resolveTarget(targetName: string, config: TuiTestConfig): ResolvedTarget | null {
  const targetCfg = getTargetConfig(targetName, config);

  if (!targetCfg) {
    return null;
  }

  const runner = runnerRegistry.get(targetCfg.runner);
  if (!runner) {
    throw new Error(`Runner "${targetCfg.runner}" not found`);
  }

  const target = {
    name: targetName,
    runner: targetCfg.runner,
    cwd: targetCfg.cwd,
    build: targetCfg.build
      ? { command: targetCfg.build[0], args: targetCfg.build.slice(1) }
      : undefined,
    launch: targetCfg.launch
      ? { command: targetCfg.launch[0], args: targetCfg.launch.slice(1) }
      : undefined,
    test: targetCfg.test
      ? { command: targetCfg.test[0], args: targetCfg.test.slice(1) }
      : undefined,
  };

  const launchSpec = runner.launch(target);
  if (!launchSpec) {
    throw new Error(`Target "${targetName}" has no launch command`);
  }

  return {
    command: launchSpec.command,
    args: launchSpec.args,
    cwd: launchSpec.cwd ?? target.cwd,
    env: targetCfg.env,
    isolation: targetCfg.isolation,
  };
}

export function resolveLaunch(
  config: LaunchConfig,
  projectConfig: TuiTestConfig,
  security: SecurityPolicyManager
): ResolvedLaunchConfig {
  if (config.command && config.target) {
    throw new Error("specify either command or target, not both");
  }

  if (config.shell && config.target) {
    throw new Error("shell mode is not compatible with target launches");
  }

  if (config.shellOptions && !config.shell) {
    throw new Error("shellOptions requires shell: true");
  }

  if (config.target) {
    const resolved = resolveTarget(config.target, projectConfig);
    if (!resolved) {
      throw new Error(`Target "${config.target}" not found`);
    }

    const cwd = config.cwd ?? resolved.cwd;
    const isolation = normalizeIsolationConfig(
      mergeIsolation(resolved.isolation, config.isolation),
      cwd,
      projectConfig.workspaceRoot
    );

    return {
      command: resolved.command,
      args: resolved.args,
      cwd,
      env: mergeEnv(
        security,
        {
          ...(resolved.isolation?.environment?.set ?? {}),
          ...(resolved.env ?? {}),
          ...(config.isolation?.environment?.set ?? {}),
          ...(config.env ?? {}),
        },
        isolation?.environment
      ),
      isolation,
    };
  }

  if (!config.command) {
    throw new Error("either command or target must be specified");
  }

  if (config.shell) {
    if (config.args && config.args.length > 0) {
      throw new Error("shell mode does not support args, pass the full shell command in command");
    }

    // Inline -c forwards the caller's command string through the shell
    // verbatim, bypassing checkCommand. Gate on the stricter eval predicate.
    security.checkShellEvalAllowed();

    const resolution = resolveShell(
      config.shellOptions,
      process.env.SHELL,
      projectConfig.shell
    );
    const invocation = buildShellInvocation(config.command, resolution);

    return {
      command: invocation.command,
      args: invocation.args,
      cwd: config.cwd,
      env: mergeEnv(
        security,
        {
          ...(config.isolation?.environment?.set ?? {}),
          ...(config.env ?? {}),
        },
        config.isolation?.environment
      ),
      isolation: normalizeIsolationConfig(config.isolation, config.cwd, projectConfig.workspaceRoot),
    };
  }

  return {
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: mergeEnv(
      security,
      {
        ...(config.isolation?.environment?.set ?? {}),
        ...(config.env ?? {}),
      },
      config.isolation?.environment
    ),
    isolation: normalizeIsolationConfig(config.isolation, config.cwd, projectConfig.workspaceRoot),
  };
}
