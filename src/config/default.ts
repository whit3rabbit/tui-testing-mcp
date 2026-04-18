/**
 * Default configuration values.
 */
export const defaultConfig = {
  workspaceRoot: process.cwd(),
  targets: {},
};

/**
 * Default terminal dimensions.
 */
export const defaultDimensions = {
  cols: 80,
  rows: 24,
};

/**
 * Default timeouts (in milliseconds).
 */
export const defaultTimeouts = {
  launch: 30000,
  expect: 30000,
  sendKeys: 100,
};