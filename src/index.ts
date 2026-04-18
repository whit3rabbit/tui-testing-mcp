#!/usr/bin/env node

/**
 * TUI Test MCP Server
 * Entry point for the MCP server.
 */

import { TuiTestServer } from "./server/index.js";

async function main(): Promise<void> {
  const server = new TuiTestServer();

  // Signals: close PTYs before exit so child processes don't become orphans.
  const handleSignal = (signal: NodeJS.Signals) => {
    void (async () => {
      try {
        await server.shutdown();
      } catch (err) {
        console.error(`Error during shutdown (${signal}):`, err);
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  await server.start();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
