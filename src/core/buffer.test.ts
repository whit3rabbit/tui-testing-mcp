import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./buffer.js";

describe("TerminalBuffer rendered HTML", () => {
  it("renders a deterministic full-width HTML snapshot with escaped content", async () => {
    const buffer = new TerminalBuffer({ cols: 12, rows: 3 });

    try {
      buffer.write("A&B<1>\nZ");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(buffer.getScreenRows(false)).toEqual(["A&B<1>      ", "      Z     ", "            "]);

      const html = buffer.getScreenHtml();
      expect(html).toContain("<!doctype html>");
      expect(html).toContain('data-cols="12"');
      expect(html).toContain('data-rows="3"');
      expect(html).toContain("A&amp;B&lt;1&gt;");
      expect(html).toContain("      Z     ");
      expect(html).not.toContain("A&B<1>");
    } finally {
      buffer.dispose();
    }
  });

  it("returns an omission page when a capped render would exceed the byte budget", async () => {
    const buffer = new TerminalBuffer({ cols: 64, rows: 8 });

    try {
      buffer.write("x".repeat(64 * 8));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const html = buffer.getScreenHtml(200);
      expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(200);
      expect(html).toContain("Rendered snapshot omitted");
      expect(html).not.toContain("x".repeat(32));
    } finally {
      buffer.dispose();
    }
  });
});
