/**
 * Cargo runner for Rust projects.
 */
import * as fs from "fs";
import * as path from "path";
import type { RunnerAdapter, ProjectTarget, CommandSpec, MaybeCommandSpec } from "./types.js";

/**
 * Cargo runner for Rust projects.
 */
export class CargoRunner implements RunnerAdapter {
  id = "cargo";

  async detect(root: string): Promise<boolean> {
    // Check for Cargo.toml
    const cargoToml = path.join(root, "Cargo.toml");
    return fs.existsSync(cargoToml);
  }

  async listTargets(root: string): Promise<ProjectTarget[]> {
    const targets: ProjectTarget[] = [];

    // Parse Cargo.toml for binary targets
    const cargoToml = path.join(root, "Cargo.toml");
    if (!fs.existsSync(cargoToml)) {
      return targets;
    }

    // Simple TOML parsing for [[bin]] sections
    const content = fs.readFileSync(cargoToml, "utf-8");
    const binSectionMatch = content.match(/\[\[bin\]\]/g);

    if (binSectionMatch) {
      // Find all binary names from [[bin]] section = name = "..."
      const nameMatches = content.matchAll(/\[bin\]\s*name\s*=\s*"([^"]+)"/g);
      for (const match of nameMatches) {
        const name = match[1];
        targets.push({
          name,
          runner: "cargo",
          cwd: root,
          build: { command: "cargo", args: ["build"], cwd: root },
          launch: { command: "cargo", args: ["run", "--bin", name], cwd: root },
          test: { command: "cargo", args: ["test", "--bin", name], cwd: root },
        });
      }
    } else {
      // Default to package name as single binary
      const packageMatch = content.match(/\[package\]\s*name\s*=\s*"([^"]+)"/);
      if (packageMatch) {
        const name = packageMatch[1];
        targets.push({
          name,
          runner: "cargo",
          cwd: root,
          build: { command: "cargo", args: ["build"], cwd: root },
          launch: { command: "cargo", args: ["run"], cwd: root },
          test: { command: "cargo", args: ["test"], cwd: root },
        });
      }
    }

    return targets;
  }

  async build(target: ProjectTarget): Promise<CommandSpec | null> {
    if (target.build) {
      return target.build;
    }
    return { command: "cargo", args: ["build"], cwd: target.cwd };
  }

  async test(target: ProjectTarget): Promise<CommandSpec | null> {
    if (target.test) {
      return target.test;
    }
    return { command: "cargo", args: ["test"], cwd: target.cwd };
  }

  launch(target: ProjectTarget): MaybeCommandSpec {
    return target.launch;
  }
}