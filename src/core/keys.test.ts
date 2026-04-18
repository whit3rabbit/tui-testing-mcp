import { describe, expect, it } from "vitest";
import { SpecialKeys, parseKeys } from "./keys.js";

describe("parseKeys", () => {
  it("parses hex escape sequences correctly", () => {
    expect(parseKeys("\\x1b")).toBe(SpecialKeys.escape);
  });

  it("supports named arrow keys without mangling regular text", () => {
    expect(parseKeys("up")).toBe(SpecialKeys.arrowUp);
    expect(parseKeys("<left>")).toBe(SpecialKeys.arrowLeft);
    expect(parseKeys("setup")).toBe("setup");
  });
});
