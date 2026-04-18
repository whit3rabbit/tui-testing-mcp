/**
 * Configuration and target discovery.
 * Handles loading, validation, and normalization of tui-test.json config.
 */

export {
  configSchema,
  targetSchema,
  sessionEnvironmentSchema,
  workingDirectoryIsolationSchema,
  sessionIsolationSchema,
  type SessionEnvironmentConfig,
  type WorkingDirectoryIsolationConfig,
  type SessionIsolationConfig,
  type TuiTestConfig,
  type TargetConfig,
  validateConfig,
  safeParseConfig,
} from "./schema.js";
export { loadConfig, findConfigPath, resolvePath, getTargetConfig } from "./load.js";
export { CONFIG_FILE_NAMES } from "./load.js";
export { defaultConfig, defaultDimensions, defaultTimeouts } from "./default.js";
