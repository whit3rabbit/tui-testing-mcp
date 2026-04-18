#!/usr/bin/env node

function classifyLayout(cols) {
  if (cols < 50) return "compact";
  if (cols < 80) return "medium";
  return "wide";
}

function repeatToWidth(token, width) {
  return token.repeat(Math.ceil(width / token.length)).slice(0, width);
}

function fitToWidth(text, width) {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function render() {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const layout = classifyLayout(cols);
  const pane = layout === "compact" ? "stack" : "split";
  const marker = layout === "compact" ? "[C]" : layout === "medium" ? "[M]" : "[W]";
  const staleGuard = `${layout}-only`;

  console.clear();
  console.log(fitToWidth(`layout=${layout} cols=${cols} rows=${rows}`, cols));
  console.log(fitToWidth(`pane=${pane}`, cols));
  console.log(repeatToWidth(marker, cols));
  console.log(fitToWidth(`signature=${layout}:${cols}x${rows}`, cols));
  console.log(fitToWidth(staleGuard, cols));
  console.log(fitToWidth("press q to quit", cols));
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.on("resize", render);

render();

process.stdin.on("data", (key) => {
  if (key === "q" || key === "\u0003") {
    process.exit(0);
  }
});
