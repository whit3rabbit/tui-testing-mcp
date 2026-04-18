/**
 * Go runner for Go projects.
 */
import * as fs from "fs";
import * as path from "path";
import type { RunnerAdapter, ProjectTarget, CommandSpec, MaybeCommandSpec } from "./types.js";

/**
 * Go runner for Go projects.
 */
export class GoRunner implements RunnerAdapter {
  id = "go";

  async detect(root: string): Promise<boolean> {
    // Check for go.mod
    const goMod = path.join(root, "go.mod");
    return fs.existsSync(goMod);
  }

  async listTargets(root: string): Promise<ProjectTarget[]> {
    const targets: ProjectTarget[] = [];

    // Parse go.mod for module name
    const goMod = path.join(root, "go.mod");
    if (!fs.existsSync(goMod)) {
      return targets;
    }

    const content = fs.readFileSync(goMod, "utf-8");
    const moduleMatch = content.match(/module\s+([^\s]+)/);

    if (moduleMatch) {
      const moduleName = moduleMatch[1];
      // Use last path component as name
      const name = moduleName.split("/").pop() ?? "main";

      // Look for cmd/* directories
      const cmdDir = path.join(root, "cmd");
      if (fs.existsSync(cmdDir) && fs.statSync(cmdDir).isDirectory()) {
        const entries = fs.readdirSync(cmdDir);
        for (const entry of entries) {
          const entryPath = path.join(cmdDir, entry);
          const stats = fs.statSync(entryPath);
          if (stats.isDirectory()) {
            targets.push({
              name: entry,
              runner: "go",
              cwd: root,
              build: {
                command: "go",
                args: ["build", "-o", `./bin/${entry}`, `./cmd/${entry}`],
                cwd: root,
              },
              launch: { command: `./bin/${entry}`, args: [], cwd: root },
              test: { command: "go", args: ["test", "./..."], cwd: root },
            });
          }
        }
      } else {
        // Default to running the module
        targets.push({
          name,
          runner: "go",
          cwd: root,
          build: { command: "go", args: ["build", "-o", "./bin/app", "."], cwd: root },
          launch: { command: "go", args: ["run", "."], cwd: root },
          test: { command: "go", args: ["test", "./..."], cwd: root },
        });
      }
    }

    return targets;
  }

  async build(target: ProjectTarget): Promise<CommandSpec | null> {
    if (target.build) {
      return target.build;
    }
    return { command: "go", args: ["build", "-o", "./bin/app", "."], cwd: target.cwd };
  }

  async test(target: ProjectTarget): Promise<CommandSpec | null> {
    if (target.test) {
      return target.test;
    }
    return { command: "go", args: ["test", "./..."], cwd: target.cwd };
  }

  launch(target: ProjectTarget): MaybeCommandSpec {
    return target.launch;
  }
}