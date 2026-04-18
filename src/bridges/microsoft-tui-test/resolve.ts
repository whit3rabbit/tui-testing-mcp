/**
 * Optional-dependency resolution for `@microsoft/tui-test`.
 *
 * Uses Node's standard resolution (createRequire anchored in the target
 * project) so the bridge only works when the project itself, or one of its
 * ancestor directories, has `@microsoft/tui-test` installed. Returns null
 * (not throws) so callers can translate the failure into a structured
 * `missing_dependency` result without exception handling.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ResolvedBridge {
  packageDir: string;
  packageJsonPath: string;
  cliPath: string;
  version: string | null;
}

type BinField = string | Record<string, string> | undefined;

export function resolveMicrosoftTuiTest(fromDir: string): ResolvedBridge | null {
  // createRequire needs a file-ish anchor. It doesn't have to exist; it is
  // used only to seed resolution at `fromDir`.
  const anchor = path.join(path.resolve(fromDir), "__tui_test_resolve_anchor__.cjs");
  const localRequire = createRequire(anchor);

  let packageJsonPath: string;
  try {
    packageJsonPath = localRequire.resolve("@microsoft/tui-test/package.json");
  } catch {
    return null;
  }

  let pkg: { bin?: BinField; version?: string };
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      bin?: BinField;
      version?: string;
    };
  } catch {
    return null;
  }

  const cliRel = pickCliEntry(pkg.bin);
  if (!cliRel) return null;

  const packageDir = path.dirname(packageJsonPath);
  const cliPath = path.resolve(packageDir, cliRel);
  if (!fs.existsSync(cliPath)) return null;

  return {
    packageDir,
    packageJsonPath,
    cliPath,
    version: pkg.version ?? null,
  };
}

function pickCliEntry(bin: BinField): string | undefined {
  if (!bin) return undefined;
  if (typeof bin === "string") return bin;
  if (typeof bin === "object") {
    // Prefer the canonical binary name, then fall back to the first entry.
    if (typeof bin["tui-test"] === "string") return bin["tui-test"];
    const first = Object.values(bin).find((v) => typeof v === "string");
    return first;
  }
  return undefined;
}
