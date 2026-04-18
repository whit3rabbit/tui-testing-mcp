import { describe, expect, it } from "vitest";
import {
  waitForOutput,
  waitForScreenChange,
  waitForScreenStability,
} from "./assertions.js";

describe("waitForOutput", () => {
  it("matches literal text and reports elapsed time", async () => {
    let output = "";
    setTimeout(() => {
      output = "hello world";
    }, 40);

    const result = await waitForOutput(() => output, "hello", {
      timeoutMs: 500,
      pollIntervalMs: 10,
      mode: "stream",
    });

    expect(result.success).toBe(true);
    expect(result.found).toBe("hello");
    expect(typeof result.elapsedMs).toBe("number");
  });

  it("matches dynamic content using regex when patternMode='regex'", async () => {
    let output = "";
    setTimeout(() => {
      output = "counter value: 42";
    }, 40);

    const result = await waitForOutput(() => output, "value:\\s+(\\d+)", {
      timeoutMs: 500,
      pollIntervalMs: 10,
      patternMode: "regex",
      mode: "stream",
    });

    expect(result.success).toBe(true);
    expect(result.found).toBe("value: 42");
  });

  it("treats regex metacharacters literally when patternMode='text'", async () => {
    // In regex mode "value." would match "valueX"; in text mode it should not.
    const result = await waitForOutput(() => "valueX", "value.", {
      timeoutMs: 80,
      pollIntervalMs: 10,
      patternMode: "text",
    });
    expect(result.success).toBe(false);
  });

  it("times out with condition, timeout, and excerpt in message", async () => {
    const result = await waitForOutput(() => "nothing useful here", "missing", {
      timeoutMs: 60,
      pollIntervalMs: 10,
      mode: "stream",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Timeout after 60ms");
    expect(result.message).toContain('text "missing"');
    expect(result.message).toContain("nothing useful here");
    expect(result.excerpt).toBeDefined();
  });

  it("labels regex condition in timeout diagnostics", async () => {
    const result = await waitForOutput(() => "plain", "foo|bar", {
      timeoutMs: 40,
      pollIntervalMs: 10,
      patternMode: "regex",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("regex /foo|bar/");
  });

  it("aborts early when isStopRequested returns true", async () => {
    let stop = false;
    setTimeout(() => { stop = true; }, 40);

    const start = Date.now();
    const result = await waitForOutput(() => "nothing", "pattern", {
      timeoutMs: 1000,
      pollIntervalMs: 10,
      isStopRequested: () => stop,
    });

    const elapsed = Date.now() - start;
    expect(result.success).toBe(false);
    expect(result.message).toContain("Wait aborted");
    expect(elapsed).toBeLessThan(200); // Should be much less than 1000ms
  });

  it("supports multiline regex matching", async () => {
    const buffer = "line 1\nline 2\nline 3";
    const result = await waitForOutput(() => buffer, "^line 2$", {
      timeoutMs: 100,
      pollIntervalMs: 10,
      patternMode: "regex",
    });
    expect(result.success).toBe(true);
  });
});

describe("waitForScreenChange", () => {
  it("resolves when the readback diverges from the baseline sample", async () => {
    let output = "first frame";
    setTimeout(() => {
      output = "second frame";
    }, 30);

    const result = await waitForScreenChange(() => output, {
      timeoutMs: 500,
      pollIntervalMs: 10,
      mode: "stream",
    });

    expect(result.success).toBe(true);
    expect(result.excerpt).toContain("second frame");
  });

  it("times out with diagnostics when the screen never changes", async () => {
    const result = await waitForScreenChange(() => "static", {
      timeoutMs: 60,
      pollIntervalMs: 10,
      mode: "stream",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Timeout after 60ms");
    expect(result.message).toContain("screen change");
    expect(result.message).toContain("matched baseline");
  });

  it("honors an explicit baseline", async () => {
    const result = await waitForScreenChange(() => "current", {
      timeoutMs: 200,
      pollIntervalMs: 10,
      baseline: "old snapshot",
      mode: "stream",
    });
    expect(result.success).toBe(true);
  });
});

describe("waitForScreenStability", () => {
  it("resolves once the readback is unchanged for the required window", async () => {
    let output = "changing";
    const interval = setInterval(() => {
      output = output + ".";
    }, 10);

    // Stop mutating after 50ms so the reader can settle.
    setTimeout(() => clearInterval(interval), 50);

    const result = await waitForScreenStability(() => output, {
      timeoutMs: 800,
      pollIntervalMs: 10,
      stableForMs: 60,
      mode: "stream",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Screen stable");
  });

  it("times out and explains that the screen never settled", async () => {
    let output = "a";
    const interval = setInterval(() => {
      output = output + "a";
    }, 5);

    try {
      const result = await waitForScreenStability(() => output, {
        timeoutMs: 100,
        pollIntervalMs: 5,
        stableForMs: 80,
        mode: "stream",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Timeout after 100ms");
      expect(result.message).toContain("screen stability");
      expect(result.message).toContain("required 80ms stable");
    } finally {
      clearInterval(interval);
    }
  });
});

describe("waitForOutput polling interval", () => {
  it("polls at the requested cadence", async () => {
    let reads = 0;
    await waitForOutput(
      () => {
        reads++;
        return "";
      },
      "never",
      { timeoutMs: 60, pollIntervalMs: 20, mode: "stream" }
    );
    // Expect roughly 3 reads before timeout; allow wiggle room.
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(reads).toBeLessThanOrEqual(5);
  });

  it("does not hang if sleep resolves promptly", async () => {
    const start = Date.now();
    await waitForOutput(() => "", "never", {
      timeoutMs: 30,
      pollIntervalMs: 5,
    });
    expect(Date.now() - start).toBeLessThan(500);
  });
});
