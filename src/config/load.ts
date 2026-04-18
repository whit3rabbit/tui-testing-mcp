/**
 * Configuration loading and normalization.
 */
import * as fs from "fs";
import * as path from "path";
import { configSchema, type SessionIsolationConfig, type TuiTestConfig } from "./schema.js";

export const CONFIG_FILE_NAMES = [
  "tui-test.config.json",
  ".tui-test.config.json",
];

/**
 * Find and load the configuration file.
 */
export function loadConfig(root?: string): TuiTestConfig {
  const searchRoot = path.resolve(root ?? process.cwd());
  const configPath = findConfigPath(searchRoot);

  if (configPath) {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = configSchema.parse(JSON.parse(content));
    return normalizeConfig(parsed, path.dirname(configPath));
  }

  // Return default config if no file found
  return normalizeConfig({ workspaceRoot: searchRoot }, searchRoot);
}

/**
 * Get the path to the config file if it exists.
 */
export function findConfigPath(root?: string): string | null {
  let currentDir = path.resolve(root ?? process.cwd());

  while (true) {
    for (const name of CONFIG_FILE_NAMES) {
      const configPath = path.join(currentDir, name);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

/**
 * Resolve a relative path against the workspace root.
 */
export function resolvePath(relativePath: string, config: TuiTestConfig): string {
  return path.resolve(config.workspaceRoot, relativePath);
}

/**
 * Get a target config by name.
 */
export function getTargetConfig(
  name: string,
  config: TuiTestConfig
): {
  runner: "cargo" | "go" | "python" | "node" | "binary";
  launch: string[];
  cwd?: string;
  env?: Record<string, string>;
  isolation?: SessionIsolationConfig;
  build?: string[];
  test?: string[];
} | undefined {
  return config.targets?.[name] as {
    runner: "cargo" | "go" | "python" | "node" | "binary";
    launch: string[];
    cwd?: string;
    env?: Record<string, string>;
    isolation?: SessionIsolationConfig;
    build?: string[];
    test?: string[];
  } | undefined;
}

function normalizeConfig(config: TuiTestConfig, configDir: string): TuiTestConfig {
  const workspaceRoot = path.resolve(configDir, config.workspaceRoot);
  const targets = config.targets
    ? Object.fromEntries(
        Object.entries(config.targets).map(([name, target]) => [
          name,
          {
            ...target,
            cwd: target.cwd ? path.resolve(workspaceRoot, target.cwd) : undefined,
            isolation: normalizeIsolation(target.isolation, workspaceRoot),
          },
        ])
      )
    : undefined;

  const microsoftTuiTest = config.microsoftTuiTest
    ? {
        ...config.microsoftTuiTest,
        cwd: config.microsoftTuiTest.cwd
          ? path.resolve(workspaceRoot, config.microsoftTuiTest.cwd)
          : undefined,
        configFile: config.microsoftTuiTest.configFile
          ? path.resolve(workspaceRoot, config.microsoftTuiTest.configFile)
          : undefined,
      }
    : undefined;

  return {
    ...config,
    workspaceRoot,
    targets,
    microsoftTuiTest,
  };
}

function normalizeIsolation(
  isolation: SessionIsolationConfig | undefined,
  workspaceRoot: string
): SessionIsolationConfig | undefined {
  if (!isolation?.workingDirectory?.copyFrom) {
    return isolation;
  }

  return {
    ...isolation,
    workingDirectory: {
      ...isolation.workingDirectory,
      copyFrom: path.resolve(workspaceRoot, isolation.workingDirectory.copyFrom),
    },
  };
}
