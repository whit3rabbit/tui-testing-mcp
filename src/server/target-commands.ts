import { loadConfig, getTargetConfig } from "../config/load.js";
import type { TuiTestConfig } from "../config/schema.js";
import { runnerRegistry, runCommand, type CommandSpec, type ProjectTarget } from "../runners/index.js";
import { SecurityPolicyManager } from "../security/manager.js";
import { mergeEnv } from "../core/session.js";

export function buildSecurity(config: TuiTestConfig): SecurityPolicyManager {
  return new SecurityPolicyManager({
    workspaceRoot: config.workspaceRoot,
    ...config.security,
  });
}

export function resolveProjectTarget(
  targetName: string,
  cwd?: string
): { config: TuiTestConfig; runner: NonNullable<ReturnType<typeof runnerRegistry.get>>; projectTarget: ProjectTarget } {
  const config = loadConfig(cwd);

  const targetCfg = getTargetConfig(targetName, config);
  if (!targetCfg) {
    throw new Error(`Target not found: ${targetName}`);
  }

  const runner = runnerRegistry.get(targetCfg.runner);
  if (!runner) {
    throw new Error(`Runner not found: ${targetCfg.runner}`);
  }

  return {
    config,
    runner,
    projectTarget: {
      name: targetName,
      runner: targetCfg.runner,
      cwd: targetCfg.cwd,
      build: targetCfg.build
        ? { command: targetCfg.build[0], args: targetCfg.build.slice(1), cwd: targetCfg.cwd }
        : undefined,
      launch: targetCfg.launch
        ? { command: targetCfg.launch[0], args: targetCfg.launch.slice(1), cwd: targetCfg.cwd }
        : undefined,
      test: targetCfg.test
        ? { command: targetCfg.test[0], args: targetCfg.test.slice(1), cwd: targetCfg.cwd }
        : undefined,
    },
  };
}

export async function executeCommand(
  config: TuiTestConfig,
  spec: CommandSpec,
  fallbackCwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const security = buildSecurity(config);

  const cwd = spec.cwd ?? fallbackCwd ?? config.workspaceRoot;
  security.checkCommand(spec.command, spec.args ?? []);
  security.checkWorkspace(cwd);

  return runCommand({
    command: spec.command,
    args: spec.args,
    cwd,
    env: mergeEnv(security),
  });
}
