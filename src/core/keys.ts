/**
 * Key encoding utilities for terminal input.
 * Handles special keys, escape sequences, and Ctrl+ combinations.
 */

/**
 * Special key escape sequences.
 */
export const SpecialKeys = {
  // Enter must be CR (0x0D), not LF (0x0A). Raw-mode TUIs (ratatui/crossterm, bubbletea,
  // textual) decode 0x0A as Ctrl+J because that byte literally *is* Ctrl+J, so sending
  // LF makes an `Enter` binding arrive with a CONTROL modifier and not match. Cooked-mode
  // callers are unaffected because the PTY line discipline rewrites CR -> LF via ICRNL.
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  arrowUp: "\x1b[A",
  arrowDown: "\x1b[B",
  arrowRight: "\x1b[C",
  arrowLeft: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
  insert: "\x1b[2~",
  delete: "\x1b[3~",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
} as const;

/**
 * Send a Ctrl+key combination.
 * @param key - A-Z (case insensitive)
 */
export function ctrlKey(key: string): string {
  const char = key.toUpperCase();
  if (char < "A" || char > "Z") {
    throw new Error(`Ctrl+key must be A-Z, got ${key}`);
  }
  // Ctrl+A is char code 1, etc.
  const charCode = char.charCodeAt(0) - 64;
  return String.fromCharCode(charCode);
}

/**
 * Parse a key string and expand special sequences.
 * Supports:
 * - \r -> CR (0x0D), the canonical Enter byte
 * - \n -> LF (0x0A), distinct from Enter in raw mode
 * - \t -> tab
 * - \x1b or \e -> escape
 * - \b -> backspace
 * - Named keys: enter/return, tab, esc/escape, up/down/left/right, etc.
 */
export function parseKeys(input: string): string {
  const namedKey = parseNamedKey(input);
  if (namedKey) {
    return namedKey;
  }

  let result = "";

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "\\" && i + 1 < input.length) {
      const next = input[i + 1];
      switch (next) {
        case "n":
          result += "\n";
          i++;
          break;
        case "r":
          result += "\r";
          i++;
          break;
        case "t":
          result += SpecialKeys.tab;
          i++;
          break;
        case "b":
          result += SpecialKeys.backspace;
          i++;
          break;
        case "e":
        case "x":
          // \x1b or \e for escape
          if (input.substring(i + 1, i + 4) === "x1b") {
            result += SpecialKeys.escape;
            i += 3;
          } else {
            result += SpecialKeys.escape;
            i++;
          }
          break;
        default:
          result += char;
      }
    } else if (char === "^" && i + 1 < input.length) {
      // ^c syntax for Ctrl+C
      result += ctrlKey(input[i + 1]);
      i++;
    } else {
      result += char;
    }
  }

  return result;
}

function parseNamedKey(input: string): string | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const namedKeys: Record<string, string> = {
    // Basic arrows
    up: SpecialKeys.arrowUp,
    down: SpecialKeys.arrowDown,
    left: SpecialKeys.arrowLeft,
    right: SpecialKeys.arrowRight,
    "<up>": SpecialKeys.arrowUp,
    "<down>": SpecialKeys.arrowDown,
    "<left>": SpecialKeys.arrowLeft,
    "<right>": SpecialKeys.arrowRight,

    // Navigation and editing
    enter: SpecialKeys.enter,
    "<enter>": SpecialKeys.enter,
    return: SpecialKeys.enter,
    "<return>": SpecialKeys.enter,
    tab: SpecialKeys.tab,
    "<tab>": SpecialKeys.tab,
    esc: SpecialKeys.escape,
    escape: SpecialKeys.escape,
    "<esc>": SpecialKeys.escape,
    "<escape>": SpecialKeys.escape,
    backspace: SpecialKeys.backspace,
    "<backspace>": SpecialKeys.backspace,
    home: SpecialKeys.home,
    "<home>": SpecialKeys.home,
    end: SpecialKeys.end,
    "<end>": SpecialKeys.end,
    pageup: SpecialKeys.pageUp,
    pgup: SpecialKeys.pageUp,
    "<pageup>": SpecialKeys.pageUp,
    "<pgup>": SpecialKeys.pageUp,
    pagedown: SpecialKeys.pageDown,
    pgdn: SpecialKeys.pageDown,
    "<pagedown>": SpecialKeys.pageDown,
    "<pgdn>": SpecialKeys.pageDown,
    insert: SpecialKeys.insert,
    "<insert>": SpecialKeys.insert,
    delete: SpecialKeys.delete,
    del: SpecialKeys.delete,
    "<delete>": SpecialKeys.delete,
    "<del>": SpecialKeys.delete,

    // Function keys
    f1: SpecialKeys.f1,
    "<f1>": SpecialKeys.f1,
    f2: SpecialKeys.f2,
    "<f2>": SpecialKeys.f2,
    f3: SpecialKeys.f3,
    "<f3>": SpecialKeys.f3,
    f4: SpecialKeys.f4,
    "<f4>": SpecialKeys.f4,
    f5: SpecialKeys.f5,
    "<f5>": SpecialKeys.f5,
    f6: SpecialKeys.f6,
    "<f6>": SpecialKeys.f6,
    f7: SpecialKeys.f7,
    "<f7>": SpecialKeys.f7,
    f8: SpecialKeys.f8,
    "<f8>": SpecialKeys.f8,
    f9: SpecialKeys.f9,
    "<f9>": SpecialKeys.f9,
    f10: SpecialKeys.f10,
    "<f10>": SpecialKeys.f10,
    f11: SpecialKeys.f11,
    "<f11>": SpecialKeys.f11,
    f12: SpecialKeys.f12,
    "<f12>": SpecialKeys.f12,
  };

  return namedKeys[normalized];
}

/**
 * Encode a string for terminal input.
 * Handles special escape sequences.
 */
export const encodeKeys = parseKeys;
