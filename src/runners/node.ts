/**
 * Node.js runner for JavaScript/TypeScript projects.
 */
import * as fs from "fs";
import * as path from "path";
import type { RunnerAdapter, ProjectTarget, CommandSpec, MaybeCommandSpec } from "./types.js";

/**
 * Node.js runner for npm/Node projects.
 */
export class NodeRunner implements RunnerAdapter {
  id = "node";

  async detect(root: string): Promise<boolean> {
    // Check for package.json
    const packageJson = path.join(root, "package.json");
    return fs.existsSync(packageJson);
  }

  async listTargets(root: string): Promise<ProjectTarget[]> {
    const targets: ProjectTarget[] = [];

    // Parse package.json for scripts
    const packageJson = path.join(root, "package.json");
    if (!fs.existsSync(packageJson)) {
      return targets;
    }

    const content = fs.readFileSync(packageJson, "utf-8");
    const pkg = JSON.parse(content);

    // Look for bin entries (global CLI tools)
    if (pkg.bin) {
      const binEntries = typeof pkg.bin === "string"
        ? { main: pkg.bin }
        : pkg.bin;

      for (const [binName, binPath] of Object.entries(binEntries as Record<string, string>)) {
        targets.push({
          name: binName,
          runner: "node",
          cwd: root,
          build: null, // No build step needed for node
          launch: { command: "node", args: [binPath], cwd: root },
          test: { command: this.getNpmCommand(), args: ["test"], cwd: root },
        });
      }
    }

    // Look for src/index.js, src/main.js, or index.js as default
    const possibleEntryPoints = ["src/index.js", "src/main.js", "index.js", "app.js"];
    for (const entry of possibleEntryPoints) {
      const entryPath = path.join(root, entry);
      if (fs.existsSync(entryPath)) {
        const name = entry.replace(/\.js$/, "");
        // Avoid duplicates with bin entries
        if (!targets.some((t) => t.name === name)) {
          targets.push({
            name,
            runner: "node",
            cwd: root,
            build: null,
            launch: { command: "node", args: [entry], cwd: root },
            test: { command: this.getNpmCommand(), args: ["test"], cwd: root },
          });
        }
      }
    }

    // Add npm scripts as virtual targets
    if (pkg.scripts) {
      for (const scriptName of Object.keys(pkg.scripts)) {
        if (scriptName === "start") {
          targets.push({
            name: "start",
            runner: "node",
            cwd: root,
            build: null,
            launch: { command: this.getNpmCommand(), args: ["start"], cwd: root },
            test: null,
          });
        }
        if (scriptName === "dev") {
          targets.push({
            name: "dev",
            runner: "node",
            cwd: root,
            build: null,
            launch: { command: this.getNpmCommand(), args: ["run", "dev"], cwd: root },
            test: null,
          });
        }
      }
    }

    return targets;
  }

  async build(_target: ProjectTarget): Promise<CommandSpec | null> {
    // No build step for pure Node projects
    // Could add "npm install" if needed
    return null;
  }

  async test(target: ProjectTarget): Promise<CommandSpec | null> {
    if (target.test) {
      return target.test;
    }
    return { command: this.getNpmCommand(), args: ["test"], cwd: target.cwd };
  }

  launch(target: ProjectTarget): MaybeCommandSpec {
    return target.launch;
  }

  private getNpmCommand(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
  }
}