/**
 * Generic binary runner for pre-built executables.
 */
import * as fs from "fs";
import * as path from "path";
import type { RunnerAdapter, ProjectTarget, CommandSpec, MaybeCommandSpec } from "./types.js";

/**
 * Generic binary runner.
 * Used for pre-built executables that don't need building.
 */
export class BinaryRunner implements RunnerAdapter {
  id = "binary";

  async detect(_root: string): Promise<boolean> {
    // Binary runner is always available as fallback
    return true;
  }

  async listTargets(root: string): Promise<ProjectTarget[]> {
    const targets: ProjectTarget[] = [];

    // Look for executable files in common locations
    const binDirs = ["bin", "dist", "build"];

    for (const dir of binDirs) {
      const dirPath = path.join(root, dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            // Check if executable
            if (stats.mode & 0o111) {
              targets.push({
                name: file,
                runner: "binary",
                cwd: dirPath,
                launch: {
                  command: filePath,
                  args: [],
                  cwd: dirPath,
                },
              });
            }
          }
        }
      }
    }

    return targets;
  }

  async build(_target: ProjectTarget): Promise<CommandSpec | null> {
    // No build step for binary
    return null;
  }

  async test(_target: ProjectTarget): Promise<CommandSpec | null> {
    // No test step for binary
    return null;
  }

  launch(target: ProjectTarget): MaybeCommandSpec {
    return target.launch;
  }
}