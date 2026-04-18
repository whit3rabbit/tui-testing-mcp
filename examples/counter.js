#!/usr/bin/env node

/**
 * Simple counter TUI example.
 * Demonstrates basic terminal interaction.
 */

let count = 0;

function render() {
  console.clear();
  console.log("=== Counter Demo ===");
  console.log("");
  console.log("  Counter value: " + count);
  console.log("");
  console.log("  Press + to increment");
  console.log("  Press - to decrement");
  console.log("  Press q to quit");
  console.log("");
  console.log("====================");
}

// Set up input handling
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

render();

process.stdin.on("data", (key) => {
  if (key === "+") {
    count++;
    render();
  } else if (key === "-") {
    count--;
    render();
  } else if (key === "q" || key === "\u0003") {
    // q or Ctrl+C
    process.exit(0);
  }
});