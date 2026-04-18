import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigPath, loadConfig } from "./load.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("searches parent directories and normalizes workspace-relative paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-config-"));
    tempDirs.push(root);

    const childDir = path.join(root, "apps", "demo");
    fs.mkdirSync(childDir, { recursive: true });

    fs.writeFileSync(
      path.join(root, "tui-test.config.json"),
      JSON.stringify(
        {
          workspaceRoot: ".",
          targets: {
            counter: {
              runner: "node",
              cwd: "./examples",
              launch: ["node", "counter.js"],
            },
          },
        },
        null,
        2
      )
    );

    const config = loadConfig(childDir);

    expect(findConfigPath(childDir)).toBe(path.join(root, "tui-test.config.json"));
    expect(config.workspaceRoot).toBe(root);
    expect(config.targets?.counter?.cwd).toBe(path.join(root, "examples"));
  });

  it("normalizes target isolation copy paths relative to the workspace root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tui-config-isolation-"));
    tempDirs.push(root);

    fs.writeFileSync(
      path.join(root, "tui-test.config.json"),
      JSON.stringify(
        {
          workspaceRoot: ".",
          targets: {
            destructive: {
              runner: "node",
              cwd: "./examples",
              launch: ["node", "counter.js"],
              isolation: {
                workingDirectory: {
                  mode: "copy",
                  copyFrom: "./fixtures/destructive",
                },
              },
            },
          },
        },
        null,
        2
      )
    );

    const config = loadConfig(root);

    expect(config.targets?.destructive?.isolation?.workingDirectory).toMatchObject({
      mode: "copy",
      copyFrom: path.join(root, "fixtures", "destructive"),
    });
  });
});
