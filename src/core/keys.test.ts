import { describe, expect, it } from "vitest";
import { SpecialKeys, ctrlKey, parseKeys } from "./keys.js";

describe("parseKeys", () => {
  it("parses hex escape sequences correctly", () => {
    expect(parseKeys("\\x1b")).toBe(SpecialKeys.escape);
  });

  it("supports named arrow keys without mangling regular text", () => {
    expect(parseKeys("up")).toBe(SpecialKeys.arrowUp);
    expect(parseKeys("<left>")).toBe(SpecialKeys.arrowLeft);
    expect(parseKeys("setup")).toBe("setup");
  });

  // Regression: TUIs in raw mode decode byte 0x0A as Ctrl+J (modifier), not Enter.
  // The canonical Enter byte is CR (0x0D). send_keys "Enter" must write CR so that
  // ratatui/crossterm/bubbletea Enter bindings fire, matching send_ctrl { key: "m" }.
  describe("Enter key encodes as CR (0x0D), not LF (0x0A)", () => {
    it("named enter -> \\r", () => {
      expect(parseKeys("enter")).toBe("\r");
      expect(parseKeys("enter").charCodeAt(0)).toBe(0x0d);
    });

    it("bracketed <enter> -> \\r", () => {
      expect(parseKeys("<enter>")).toBe("\r");
    });

    it("return alias -> \\r", () => {
      expect(parseKeys("return")).toBe("\r");
      expect(parseKeys("<return>")).toBe("\r");
    });

    it("literal \\\\r escape -> CR", () => {
      expect(parseKeys("\\r")).toBe("\r");
    });

    it("literal \\\\n escape -> LF (not collapsed to Enter)", () => {
      expect(parseKeys("\\n")).toBe("\n");
      expect(parseKeys("\\n").charCodeAt(0)).toBe(0x0a);
    });
  });

  // Exhaustive byte-level pin for every named key we ship. If any of these drift,
  // target apps (ratatui/bubbletea/textual) silently misinterpret the key.
  describe("named key byte sequences", () => {
    const cases: Array<[string, string]> = [
      ["enter", "\r"],
      ["return", "\r"],
      ["tab", "\t"],
      ["escape", "\x1b"],
      ["esc", "\x1b"],
      ["backspace", "\x7f"],
      ["up", "\x1b[A"],
      ["down", "\x1b[B"],
      ["right", "\x1b[C"],
      ["left", "\x1b[D"],
      ["home", "\x1b[H"],
      ["end", "\x1b[F"],
      ["pageup", "\x1b[5~"],
      ["pgup", "\x1b[5~"],
      ["pagedown", "\x1b[6~"],
      ["pgdn", "\x1b[6~"],
      ["insert", "\x1b[2~"],
      ["delete", "\x1b[3~"],
      ["del", "\x1b[3~"],
      ["f1", "\x1bOP"],
      ["f2", "\x1bOQ"],
      ["f3", "\x1bOR"],
      ["f4", "\x1bOS"],
      ["f5", "\x1b[15~"],
      ["f6", "\x1b[17~"],
      ["f7", "\x1b[18~"],
      ["f8", "\x1b[19~"],
      ["f9", "\x1b[20~"],
      ["f10", "\x1b[21~"],
      ["f11", "\x1b[23~"],
      ["f12", "\x1b[24~"],
    ];

    for (const [name, bytes] of cases) {
      it(`${name} -> expected bytes`, () => {
        expect(parseKeys(name)).toBe(bytes);
        expect(parseKeys(`<${name}>`)).toBe(bytes);
      });
    }

    it("named lookup is case insensitive and trims whitespace", () => {
      expect(parseKeys("Enter")).toBe("\r");
      expect(parseKeys("ENTER")).toBe("\r");
      expect(parseKeys("  tab  ")).toBe("\t");
    });

    it("unshipped aliases fall through as literal text", () => {
      // We ship `up`/`<up>` but not `<ArrowUp>`. Literal text returns unchanged.
      expect(parseKeys("<ArrowUp>")).toBe("<ArrowUp>");
    });

    it("unknown named key falls through to literal text", () => {
      expect(parseKeys("setup")).toBe("setup");
      expect(parseKeys("hello world")).toBe("hello world");
    });
  });

  describe("backslash escape expansions", () => {
    it("\\\\t -> tab (0x09)", () => {
      expect(parseKeys("\\t")).toBe("\t");
    });
    it("\\\\b -> backspace (0x7F)", () => {
      expect(parseKeys("\\b")).toBe("\x7f");
    });
    it("\\\\e -> escape (0x1B)", () => {
      expect(parseKeys("\\e")).toBe("\x1b");
    });
    it("\\\\x1b -> escape (0x1B)", () => {
      expect(parseKeys("\\x1b")).toBe("\x1b");
    });
    it("mixed literal + escape: hi\\\\n -> hi + LF", () => {
      expect(parseKeys("hi\\n")).toBe("hi\n");
    });
    it("mixed literal + escape: hi\\\\r -> hi + CR", () => {
      expect(parseKeys("hi\\r")).toBe("hi\r");
    });
    it("unknown backslash escape passes through literally", () => {
      expect(parseKeys("\\q")).toBe("\\q");
    });
  });

  describe("caret Ctrl syntax (^x)", () => {
    it("^c -> 0x03 (Ctrl+C)", () => {
      expect(parseKeys("^c")).toBe("\x03");
    });
    it("^m -> 0x0D (Ctrl+M equals Enter)", () => {
      expect(parseKeys("^m")).toBe("\r");
    });
    it("^j -> 0x0A (Ctrl+J equals LF)", () => {
      expect(parseKeys("^j")).toBe("\n");
    });
    it("^C uppercase also works", () => {
      expect(parseKeys("^C")).toBe("\x03");
    });
    it("mixed ^c inside text", () => {
      expect(parseKeys("hi^cbye")).toBe("hi\x03bye");
    });
  });
});

describe("ctrlKey", () => {
  it("lowercase letters", () => {
    expect(ctrlKey("a")).toBe("\x01");
    expect(ctrlKey("c")).toBe("\x03");
    expect(ctrlKey("d")).toBe("\x04");
    expect(ctrlKey("j")).toBe("\n");
    expect(ctrlKey("m")).toBe("\r");
    expect(ctrlKey("z")).toBe("\x1a");
  });

  it("uppercase letters produce the same byte", () => {
    expect(ctrlKey("A")).toBe("\x01");
    expect(ctrlKey("M")).toBe("\r");
  });

  it("rejects non-letter single-char input", () => {
    expect(() => ctrlKey("1")).toThrow(/A-Z/);
    expect(() => ctrlKey("!")).toThrow(/A-Z/);
    expect(() => ctrlKey("")).toThrow(/A-Z/);
  });
});
