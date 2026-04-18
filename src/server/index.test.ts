import { describe, expect, it, vi } from "vitest";
import type { Session } from "../core/session.js";
import { expectTextInSession } from "./index.js";

describe("expectTextInSession", () => {
  it("returns a structured tool error for unsafe regex waits", async () => {
    const recordTraceEvent = vi.fn();
    const capture = vi.fn().mockResolvedValue("aaaaaaaaaaaaaaaa");
    const session = {
      buffer: undefined,
      capture,
      status: "active",
      recordTraceEvent,
    } as unknown as Session;

    const result = await expectTextInSession(session, "(a+)+b", 1, "regex");

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Unsafe regex rejected");
    expect(capture).not.toHaveBeenCalled();
    expect(recordTraceEvent).toHaveBeenCalledWith(
      "wait",
      expect.objectContaining({
        pattern: "(a+)+b",
        patternMode: "regex",
        success: false,
      })
    );
  });
});
