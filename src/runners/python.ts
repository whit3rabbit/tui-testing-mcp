/**
 * Python runner for Python projects.
 */
import * as fs from "fs";
import * as path from "path";
import type { RunnerAdapter, ProjectTarget, CommandSpec, MaybeCommandSpec } from "./types.js";

/**
 * Python runner for Python projects.
 */
export class PythonRunner implements RunnerAdapter {
  id = "python";

  async detect(root: string): Promise<boolean> {
    // Check for pyproject.toml, setup.py, or requirements.txt
    const pyproject = path.join(root, "pyproject.toml");
    const setupPy = path.join(root, "setup.py");
    const requirements = path.join(root, "requirements.txt");
    const hasPythonFiles = fs.readdirSync(root).some((f) => f.endsWith(".py"));
    return fs.existsSync(pyproject) || fs.existsSync(setupPy) || fs.existsSync(requirements) || hasPythonFiles;
  }

  async listTargets(root: string): Promise<ProjectTarget[]> {
    const targets: ProjectTarget[] = [];

    // Look for Python files in root or src/
    const searchDirs = ["", "src", "app"];
    const entryPoints = ["__main__.py", "main.py", "app.py", "cli.py"];

    for (const searchDir of searchDirs) {
      const searchPath = searchDir ? path.join(root, searchDir) : root;
      if (!fs.existsSync(searchPath)) continue;

      for (const entry of entryPoints) {
        const entryPath = path.join(searchPath, entry);
        if (fs.existsSync(entryPath)) {
          const name = entry.replace(/\.py$/, "");
          const pyCmd = this.getPythonCommand(root);

          targets.push({
            name: `${searchDir ? searchDir + "/" : ""}${name}`,
            runner: "python",
            cwd: root,
            build: null,
            launch: { command: pyCmd, args: [entryPath], cwd: root },
            test: { command: pyCmd, args: ["-m", "pytest"], cwd: root },
          });
        }
      }
    }

    // Check for pytest configuration
    const hasPytest = [
      path.join(root, "pytest.ini"),
      path.join(root, "pyproject.toml"),
      path.join(root, "setup.cfg"),
    ].some((p) => fs.existsSync(p));

    if (hasPytest) {
      const pyCmd = this.getPythonCommand(root);
      targets.push({
        name: "pytest",
        runner: "python",
        cwd: root,
        build: null,
        launch: null,
        test: { command: pyCmd, args: ["-m", "pytest"], cwd: root },
      });
    }

    return targets;
  }

  async build(_target: ProjectTarget): Promise<CommandSpec | null> {
    // No build step for pure Python
    // Could add "pip install -e ." if in development mode
    return null;
  }

  async test(target: ProjectTarget): Promise<CommandSpec | null> {
    if (target.test) {
      return target.test;
    }
    const cwd = target.cwd ?? process.cwd();
    const pyCmd = this.getPythonCommand(cwd);
    return { command: pyCmd, args: ["-m", "pytest"], cwd };
  }

  launch(target: ProjectTarget): MaybeCommandSpec {
    return target.launch;
  }

  private getPythonCommand(root: string): string {
    const venvPython = process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python");

    if (fs.existsSync(venvPython)) {
      return venvPython;
    }

    return process.platform === "win32" ? "python" : "python3";
  }
}
