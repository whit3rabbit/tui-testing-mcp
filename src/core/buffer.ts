/**
 * Terminal buffer management.
 * Wraps @xterm/headless to provide a queryable grid of characters.
 */
import xtermHeadless from "@xterm/headless";

const { Terminal } = xtermHeadless;

export interface BufferOptions {
  cols: number;
  rows: number;
  allowProposedApi?: boolean;
}

export interface CursorPosition {
  y: number;
  x: number;
}

const RENDERED_SCREEN_OMITTED_TITLE = "Rendered snapshot omitted";

/**
 * Wraps @xterm/headless to provide terminal buffer state.
 * Used in buffer mode for position-aware assertions.
 */
export class TerminalBuffer {
  private readonly terminal: InstanceType<typeof Terminal>;

  constructor(options: BufferOptions = { cols: 80, rows: 24 }) {
    this.terminal = new Terminal({
      cols: options.cols,
      rows: options.rows,
      allowProposedApi: options.allowProposedApi ?? true,
    });
  }

  /**
   * Write data to the buffer (received from PTY).
   */
  write(data: string): void {
    this.terminal.write(data);
  }

  /**
   * Get the current screen as plain text (no ANSI codes).
   */
  getScreenText(): string {
    return this.getScreenRows().join("\n");
  }

  /**
   * Get the active screen rows, optionally preserving trailing padding.
   */
  getScreenRows(trimRight: boolean = true): string[] {
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row++) {
      lines.push(this.getRowText(row, trimRight));
    }
    return lines;
  }

  /**
   * Render the active screen as a deterministic HTML snapshot for human review.
   */
  getScreenHtml(maxBytes: number = Number.POSITIVE_INFINITY): string {
    const prefix = [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8">',
      "  <title>tui-test screen snapshot</title>",
      "  <style>",
      "    :root { color-scheme: light; }",
      "    body { margin: 0; padding: 16px; background: #0f172a; color: #e2e8f0; font-family: Menlo, Monaco, Consolas, 'Liberation Mono', monospace; }",
      "    .frame { display: inline-block; padding: 12px; border: 1px solid #334155; background: #020617; box-shadow: 0 0 0 1px #020617 inset; }",
      "    .meta { margin: 0 0 10px; color: #94a3b8; font-size: 12px; }",
      "    .screen { margin: 0; white-space: pre; line-height: 1.2; }",
      "  </style>",
      "</head>",
      "<body>",
      `  <div class="frame" data-cols="${this.cols}" data-rows="${this.rows}">`,
      `    <p class="meta">cols=${this.cols} rows=${this.rows}</p>`,
      '    <pre class="screen">',
    ].join("\n");
    const suffix = [
      "</pre>",
      "  </div>",
      "</body>",
      "</html>",
      "",
    ].join("\n");

    const chunks: string[] = [prefix];
    let bytes = Buffer.byteLength(prefix, "utf8") + Buffer.byteLength(suffix, "utf8");

    for (let row = 0; row < this.rows; row += 1) {
      const piece = `${row === 0 ? "" : "\n"}${escapeHtml(this.getRowText(row, false))}`;
      const pieceBytes = Buffer.byteLength(piece, "utf8");
      if (bytes + pieceBytes > maxBytes) {
        return buildRenderedScreenOmission(maxBytes, bytes + pieceBytes);
      }
      chunks.push(piece);
      bytes += pieceBytes;
    }

    chunks.push(suffix);
    return chunks.join("");
  }

  /**
   * Get a single line from the buffer (0-indexed).
   */
  getLine(row: number): string | null {
    if (row < 0 || row >= this.terminal.rows) {
      return null;
    }
    const text = this.getRowText(row, true);
    return text.length > 0 ? text : "";
  }

  /**
   * Get a rectangular region from the buffer.
   */
  getRegion(
    rowStart: number,
    rowEnd: number,
    colStart: number = 0,
    colEnd?: number
  ): string {
    const lines: string[] = [];
    const buffer = this.terminal.buffer.active;
    const maxCols = colEnd ?? this.terminal.cols;

    for (let row = rowStart; row < rowEnd && row < this.terminal.rows; row++) {
      const line = buffer.getLine(row);
      if (line) {
        let text = "";
        for (let col = colStart; col < maxCols && col < this.terminal.cols; col++) {
          const cell = line.getCell(col);
          // Use getChars to get the cell content
          text += cell?.getChars() ?? " ";
        }
        lines.push(text);
      }
    }
    return lines.join("\n");
  }

  /**
   * Get the current cursor position (0-indexed).
   */
  getCursorPosition(): CursorPosition {
    const buffer = this.terminal.buffer.active;
    return {
      y: buffer.cursorY,
      x: buffer.cursorX,
    };
  }

  /**
   * Get the number of columns.
   */
  get cols(): number {
    return this.terminal.cols;
  }

  /**
   * Get the number of rows.
   */
  get rows(): number {
    return this.terminal.rows;
  }

  /**
   * Resize the terminal buffer to match the PTY dimensions.
   */
  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  /**
   * Check if a string appears in the buffer.
   */
  contains(text: string): boolean {
    return this.getScreenText().includes(text);
  }

  /**
   * Dispose of the terminal buffer.
   */
  dispose(): void {
    this.terminal.dispose();
  }

  private getRowText(row: number, trimRight: boolean): string {
    if (row < 0 || row >= this.terminal.rows) {
      return "";
    }
    const line = this.terminal.buffer.active.getLine(row);
    const text = line?.translateToString(trimRight) ?? "";
    return trimRight ? text.trimEnd() : text;
  }
}

/**
 * Create a new TerminalBuffer with the given options.
 */
export function createBuffer(options: BufferOptions): TerminalBuffer {
  return new TerminalBuffer(options);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildRenderedScreenOmission(maxBytes: number, requiredBytes: number): string {
  const detailed = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    `  <title>${RENDERED_SCREEN_OMITTED_TITLE}</title>`,
    "</head>",
    "<body>",
    `  <pre>${RENDERED_SCREEN_OMITTED_TITLE}: exceeded ${maxBytes} bytes while rendering (${requiredBytes} bytes required).</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");

  if (Buffer.byteLength(detailed, "utf8") <= maxBytes) {
    return detailed;
  }

  const compact = [
    "<!doctype html>",
    `<title>${RENDERED_SCREEN_OMITTED_TITLE}</title>`,
    `<pre>${RENDERED_SCREEN_OMITTED_TITLE}</pre>`,
    "",
  ].join("\n");

  if (Buffer.byteLength(compact, "utf8") <= maxBytes) {
    return compact;
  }

  const minimal = "<!doctype html>\n";
  return Buffer.byteLength(minimal, "utf8") <= maxBytes ? minimal : "";
}
