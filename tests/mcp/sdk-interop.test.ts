import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getBuiltServerParams } from "./harness.js";

describe("official SDK interoperability", () => {
  const transports: StdioClientTransport[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close();
    }
    for (const transport of transports.splice(0)) {
      await transport.close();
    }
  });

  async function connectClient(): Promise<{ client: Client; transport: StdioClientTransport }> {
    const transport = new StdioClientTransport(getBuiltServerParams());
    const client = new Client(
      {
        name: "sdk-interop-test",
        version: "0.0.0",
      },
      { capabilities: {} }
    );

    transports.push(transport);
    clients.push(client);

    await client.connect(transport);
    return { client, transport };
  }

  it("initializes and lists the advertised tools", async () => {
    const { client } = await connectClient();

    const tools = await client.listTools();

    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.some((tool) => tool.name === "launch_tui")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "list_sessions")).toBe(true);
  });

  it("supports a happy-path tool call through the SDK client", async () => {
    const { client } = await connectClient();

    await client.listTools();
    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toBe("[]");
  });

  it("returns a structured tool failure instead of a transport crash", async () => {
    const { client } = await connectClient();

    await client.listTools();
    const result = await client.callTool({
      name: "send_keys",
      arguments: {
        sessionId: "missing-session",
        keys: "x",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("missing-session");
    expect(result.content[0]?.text).toContain("not active");
  });
});
