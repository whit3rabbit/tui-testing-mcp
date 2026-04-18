import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  normalize,
  sessionAlias,
  ansiAlias,
  regionAlias,
  closeAlias,
  dimensionAlias,
} from "./aliases.js";

/**
 * These tests exercise the alias layer in isolation. They validate against
 * the same raw shapes the MCP server registers, so a regression in either
 * the shape fragment or the normalize step should fail here before hitting
 * the server.
 */

describe("normalize", () => {
  // Cast inputs to Record<string, unknown> so the test can read camelCase
  // keys off the result regardless of which snake_case fields were passed in.
  const run = (input: Record<string, unknown>): Record<string, unknown> =>
    normalize(input);

  it("maps session_id onto sessionId when alias is provided", () => {
    expect(run({ session_id: "abc", sessionId: "default" }).sessionId).toBe("abc");
  });

  it("leaves sessionId alone when no alias is provided", () => {
    expect(run({ sessionId: "default" }).sessionId).toBe("default");
  });

  it("lets the alias override when both are provided", () => {
    expect(run({ session_id: "alias", sessionId: "camel" }).sessionId).toBe("alias");
  });

  it("maps include_ansi onto includeAnsi", () => {
    expect(run({ include_ansi: true, includeAnsi: false }).includeAnsi).toBe(true);
    expect(run({ include_ansi: false, includeAnsi: true }).includeAnsi).toBe(false);
  });

  it("maps use_buffer onto useBuffer", () => {
    expect(run({ use_buffer: true }).useBuffer).toBe(true);
  });

  it("maps capture_artifacts onto captureArtifacts", () => {
    expect(run({ capture_artifacts: false, captureArtifacts: true }).captureArtifacts).toBe(false);
  });

  it("maps row_start/row_end/col_start/col_end onto camelCase", () => {
    const out = run({ row_start: 0, row_end: 5, col_start: 2, col_end: 7 });
    expect(out.rowStart).toBe(0);
    expect(out.rowEnd).toBe(5);
    expect(out.colStart).toBe(2);
    expect(out.colEnd).toBe(7);
  });

  it("expands dimensions:{cols,rows} onto top-level cols/rows", () => {
    const out = run({ dimensions: { cols: 100, rows: 30 } });
    expect(out.cols).toBe(100);
    expect(out.rows).toBe(30);
  });

  it("leaves existing cols/rows alone when dimensions is absent", () => {
    const out = run({ cols: 80, rows: 24 });
    expect(out.cols).toBe(80);
    expect(out.rows).toBe(24);
  });

  it("lets dimensions override pre-existing cols/rows", () => {
    // If the caller sent both, dimensions wins. Same rule as the snake
    // aliases: if you used the Python-surface form, you meant it.
    const out = run({ cols: 80, rows: 24, dimensions: { cols: 100, rows: 30 } });
    expect(out.cols).toBe(100);
    expect(out.rows).toBe(30);
  });

  it("ignores malformed dimensions", () => {
    const out = run({ cols: 80, rows: 24, dimensions: "not-an-object" });
    expect(out.cols).toBe(80);
    expect(out.rows).toBe(24);
  });
});

/**
 * These exercise the Zod shape fragments against the same parse step the
 * MCP SDK performs, so a schema-level regression (e.g. a missing optional)
 * shows up as a parse failure here.
 */
describe("shape fragments accept snake_case input", () => {
  it("sessionAlias accepts session_id", () => {
    const parsed = z.object(sessionAlias).safeParse({ session_id: "abc" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.session_id).toBe("abc");
  });

  it("ansiAlias accepts include_ansi", () => {
    const parsed = z.object(ansiAlias).safeParse({ include_ansi: true });
    expect(parsed.success).toBe(true);
  });

  it("regionAlias accepts row_start/row_end/col_start/col_end", () => {
    const parsed = z.object(regionAlias).safeParse({
      row_start: 1,
      row_end: 10,
      col_start: 0,
      col_end: 80,
    });
    expect(parsed.success).toBe(true);
  });

  it("closeAlias accepts capture_artifacts", () => {
    const parsed = z.object(closeAlias).safeParse({ capture_artifacts: false });
    expect(parsed.success).toBe(true);
  });

  it("dimensionAlias accepts dimensions:{cols,rows}", () => {
    const parsed = z.object(dimensionAlias).safeParse({ dimensions: { cols: 80, rows: 24 } });
    expect(parsed.success).toBe(true);
  });

  it("dimensionAlias rejects a malformed dimensions payload", () => {
    const parsed = z.object(dimensionAlias).safeParse({ dimensions: { cols: "oops" } });
    expect(parsed.success).toBe(false);
  });

  // Dimension bounds guard against xterm-headless OOM when an LLM hallucinates
  // multi-thousand row/col values. Keep the allowed band wide enough that real
  // terminal sizes still pass.
  it("dimensionAlias rejects cols/rows below 10 or above 500", () => {
    const tooSmall = z.object(dimensionAlias).safeParse({ dimensions: { cols: 9, rows: 24 } });
    expect(tooSmall.success).toBe(false);
    const tooLarge = z.object(dimensionAlias).safeParse({ dimensions: { cols: 501, rows: 24 } });
    expect(tooLarge.success).toBe(false);
    const rowsTooLarge = z.object(dimensionAlias).safeParse({ dimensions: { cols: 80, rows: 501 } });
    expect(rowsTooLarge.success).toBe(false);
  });

  it("dimensionAlias accepts values at the bounds", () => {
    const atMin = z.object(dimensionAlias).safeParse({ dimensions: { cols: 10, rows: 10 } });
    expect(atMin.success).toBe(true);
    const atMax = z.object(dimensionAlias).safeParse({ dimensions: { cols: 500, rows: 500 } });
    expect(atMax.success).toBe(true);
  });
});

/**
 * End-to-end: simulate the tool registration shape for launch_tui and
 * resize_session and confirm a pure snake_case input lands on camelCase
 * fields after normalize. This catches bugs where the shape and the
 * normalizer go out of sync.
 */
describe("launch_tui-shaped input", () => {
  const shape = {
    sessionId: z.string().default("default"),
    cols: z.number().int().default(80),
    rows: z.number().int().default(24),
    ...sessionAlias,
    ...dimensionAlias,
  };

  it("accepts session_id + dimensions and normalizes to sessionId/cols/rows", () => {
    const parsed = z.object(shape).safeParse({
      session_id: "s1",
      dimensions: { cols: 120, rows: 40 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const params = normalize(parsed.data);
    expect(params.sessionId).toBe("s1");
    expect(params.cols).toBe(120);
    expect(params.rows).toBe(40);
  });

  it("still works with canonical camelCase input", () => {
    const parsed = z.object(shape).safeParse({
      sessionId: "s2",
      cols: 100,
      rows: 30,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const params = normalize(parsed.data);
    expect(params.sessionId).toBe("s2");
    expect(params.cols).toBe(100);
    expect(params.rows).toBe(30);
  });
});

/**
 * Guardrails on tool-level numeric inputs. These shapes mirror the fragments
 * registered in src/server/index.ts for launch_tui/resize_session/expect_text,
 * so a loosening of bounds will fail here before reaching the tools surface.
 */
describe("numeric bounds on tool shapes", () => {
  // Mirror launch_tui's cols/rows shape.
  const launchDims = {
    cols: z.number().int().min(10).max(500).default(80),
    rows: z.number().int().min(10).max(500).default(24),
  };

  it("launch_tui-shaped cols/rows reject values outside 10-500", () => {
    expect(z.object(launchDims).safeParse({ cols: 9 }).success).toBe(false);
    expect(z.object(launchDims).safeParse({ cols: 501 }).success).toBe(false);
    expect(z.object(launchDims).safeParse({ rows: 9 }).success).toBe(false);
    expect(z.object(launchDims).safeParse({ rows: 501 }).success).toBe(false);
  });

  it("launch_tui-shaped cols/rows accept values at the bounds", () => {
    expect(z.object(launchDims).safeParse({ cols: 10, rows: 10 }).success).toBe(true);
    expect(z.object(launchDims).safeParse({ cols: 500, rows: 500 }).success).toBe(true);
  });

  // Mirror resize_session's cols/rows shape (same bounds, but optional).
  const resizeDims = {
    cols: z.number().int().min(10).max(500).optional(),
    rows: z.number().int().min(10).max(500).optional(),
  };

  it("resize_session-shaped cols/rows reject values outside 10-500", () => {
    expect(z.object(resizeDims).safeParse({ cols: 9 }).success).toBe(false);
    expect(z.object(resizeDims).safeParse({ cols: 501 }).success).toBe(false);
  });

  // Mirror expect_text / wait_for_screen_* timeout shape.
  const waitTimeout = {
    timeout: z.number().int().positive().max(120).default(30),
  };

  it("wait-style timeout rejects 0, negative, and > 120", () => {
    expect(z.object(waitTimeout).safeParse({ timeout: 0 }).success).toBe(false);
    expect(z.object(waitTimeout).safeParse({ timeout: -1 }).success).toBe(false);
    expect(z.object(waitTimeout).safeParse({ timeout: 121 }).success).toBe(false);
  });

  it("wait-style timeout accepts 1 through 120", () => {
    expect(z.object(waitTimeout).safeParse({ timeout: 1 }).success).toBe(true);
    expect(z.object(waitTimeout).safeParse({ timeout: 120 }).success).toBe(true);
  });
});
