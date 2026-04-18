import { afterEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { RawStdioMcpHarness } from "./harness.js";

describe("raw stdio MCP protocol", () => {
  const harnesses: RawStdioMcpHarness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
      await harness.close();
    }
  });

  function newHarness(): RawStdioMcpHarness {
    const harness = new RawStdioMcpHarness();
    harnesses.push(harness);
    return harness;
  }

  it("rejects tool traffic before initialize completes", async () => {
    const harness = newHarness();

    const response = await harness.request(1, "tools/list", {});

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(ErrorCode.InvalidRequest);
    expect(response.error?.message).toContain("Server not initialized");
  });

  it("keeps stdout reserved for JSON-RPC and stderr for diagnostics", async () => {
    const harness = newHarness();

    const initialize = await harness.initialize(1);
    const listSessions = await harness.request(2, "tools/call", {
      name: "list_sessions",
      arguments: {},
    });

    expect(initialize.result).toBeDefined();
    expect(listSessions.result).toBeDefined();
    expect(harness.getStdoutLines()).toHaveLength(2);
    expect(() => harness.getStdoutLines().forEach((line) => JSON.parse(line))).not.toThrow();
    expect(harness.getStdoutLines().join("\n")).not.toContain("[INFO]");
    expect(harness.getStderr()).toContain("[INFO] TUI Test MCP server started");
  });

  it("fails clearly on an invalid lifecycle sequence", async () => {
    const harness = newHarness();

    await harness.initialize(1);
    const secondInitialize = await harness.request(2, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "raw-protocol-test",
        version: "0.0.0",
      },
    });

    expect(secondInitialize.error).toBeDefined();
    expect(secondInitialize.error?.code).toBe(ErrorCode.InvalidRequest);
    expect(secondInitialize.error?.message).toContain("already initialized");
  });
});
