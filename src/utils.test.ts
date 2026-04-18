import { describe, expect, it } from "vitest";
import { isPathWithin, normalizePath } from "./utils.js";

describe("normalizePath", () => {
  it("expands Windows home paths from USERPROFILE", () => {
    const originalUserProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = "C:\\Users\\tester";

    try {
      expect(normalizePath("~\\workspace\\file.txt")).toBe(
        "C:\\Users\\tester\\workspace\\file.txt"
      );
    } finally {
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
    }
  });
});

describe("isPathWithin", () => {
  it("treats Windows paths as case-insensitive and separator-insensitive", () => {
    expect(
      isPathWithin("C:\\Work\\Repo", "c:/work/repo\\src\\main.ts")
    ).toBe(true);
  });

  it("rejects Windows sibling paths that share only a prefix", () => {
    expect(
      isPathWithin("C:\\Work\\Repo", "C:\\Work\\Repo-evil\\main.ts")
    ).toBe(false);
  });
});
