/**
 * Python-surface compatibility: accept snake_case parameter aliases alongside
 * the canonical camelCase names used by the TS server. Keeps Python-flavored
 * agent flows working without forcing callers to rename fields.
 *
 * Why handler-side normalization instead of a z.preprocess wrapper:
 * the MCP SDK's tools/list JSON schema is emitted only when the input schema
 * normalizes to a plain object; a preprocess wrapper hides the shape and the
 * emitted schema collapses to {}. Keeping the raw shape preserves schema
 * discoverability, at the cost of listing the aliases as extra keys.
 *
 * Aliases are split into fragments so each tool only advertises the aliases
 * it actually supports.
 */

import { z } from "zod";

/**
 * snake_case alias → canonical camelCase target.
 * Every entry needs a matching optional field in one of the alias fragments.
 */
const ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["session_id", "sessionId"],
  ["include_ansi", "includeAnsi"],
  ["use_buffer", "useBuffer"],
  ["capture_artifacts", "captureArtifacts"],
  ["row_start", "rowStart"],
  ["row_end", "rowEnd"],
  ["col_start", "colStart"],
  ["col_end", "colEnd"],
  ["pattern_mode", "patternMode"],
  ["poll_interval_ms", "pollIntervalMs"],
  ["stable_for_ms", "stableForMs"],
] as const;

export const sessionAlias = {
  session_id: z.string().optional(),
} as const;

export const ansiAlias = {
  include_ansi: z.boolean().optional(),
} as const;

export const bufferOverrideAlias = {
  use_buffer: z.boolean().optional(),
} as const;

export const regionAlias = {
  row_start: z.number().int().optional(),
  row_end: z.number().int().optional(),
  col_start: z.number().int().optional(),
  col_end: z.number().int().optional(),
} as const;

export const closeAlias = {
  capture_artifacts: z.boolean().optional(),
} as const;

export const dimensionAlias = {
  dimensions: z
    .object({
      cols: z.number().int().min(10).max(500),
      rows: z.number().int().min(10).max(500),
    })
    .optional(),
} as const;

export const patternModeAlias = {
  pattern_mode: z.enum(["text", "regex"]).optional(),
} as const;

export const pollIntervalAlias = {
  poll_interval_ms: z.number().int().min(50).optional(),
} as const;

export const stableForAlias = {
  stable_for_ms: z.number().int().positive().optional(),
} as const;

/**
 * Copy alias values onto their canonical keys so handlers only read camelCase.
 *
 * Precedence: alias wins when explicitly provided. The canonical field may
 * carry a Zod default ("default", 80, false) that looks identical to a
 * user-supplied value, so we cannot distinguish "explicit" from "defaulted".
 * If a caller sent the snake_case form, treat that as authoritative.
 *
 * `dimensions: {cols, rows}` is expanded into top-level `cols`/`rows` so the
 * Python server's dimensions object still works on launch_tui / resize.
 */
export function normalize<T extends Record<string, unknown>>(params: T): T {
  const out: Record<string, unknown> = { ...params };

  for (const [snake, camel] of ALIAS_PAIRS) {
    if (out[snake] !== undefined) {
      out[camel] = out[snake];
    }
  }

  const dim = out["dimensions"];
  if (dim && typeof dim === "object" && !Array.isArray(dim)) {
    const d = dim as { cols?: unknown; rows?: unknown };
    if (typeof d.cols === "number") out["cols"] = d.cols;
    if (typeof d.rows === "number") out["rows"] = d.rows;
  }

  return out as T;
}
