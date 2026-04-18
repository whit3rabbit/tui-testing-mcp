import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, isJSONRPCNotification, isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { error } from "../logging.js";

type StdioLifecycleState = "awaiting_initialize" | "awaiting_initialized_notification" | "ready";

export function attachInitializeLifecycleGuard(transport: StdioServerTransport): void {
  const forwardMessage = transport.onmessage;
  if (!forwardMessage) {
    throw new Error("Transport message handler was not registered");
  }

  const forwardSend = transport.send.bind(transport);
  let state: StdioLifecycleState = "awaiting_initialize";
  let pendingInitializeRequestId: string | number | null = null;

  transport.send = async (message) => {
    if (
      pendingInitializeRequestId !== null &&
      "id" in message &&
      message.id === pendingInitializeRequestId
    ) {
      state = "result" in message ? "awaiting_initialized_notification" : "awaiting_initialize";
      pendingInitializeRequestId = null;
    }
    await forwardSend(message);
  };

  transport.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCRequest(message)) {
      if (message.method === "initialize") {
        if (state !== "awaiting_initialize") {
          void sendLifecycleError(transport, message.id, ErrorCode.InvalidRequest, "Server already initialized");
          return;
        }

        pendingInitializeRequestId = message.id;
        forwardMessage(message);
        return;
      }

      if (state !== "ready") {
        void sendLifecycleError(
          transport,
          message.id,
          ErrorCode.InvalidRequest,
          "Server not initialized. Send initialize and notifications/initialized before other requests."
        );
        return;
      }

      forwardMessage(message);
      return;
    }

    if (isJSONRPCNotification(message)) {
      if (message.method === "notifications/initialized") {
        if (state === "awaiting_initialized_notification") {
          state = "ready";
          forwardMessage(message);
          return;
        }

        error(`Ignoring out-of-order notification: ${message.method}`);
        return;
      }

      if (state !== "ready") {
        error(`Ignoring pre-initialize notification: ${message.method}`);
        return;
      }
    }

    forwardMessage(message);
  };
}

async function sendLifecycleError(
  transport: StdioServerTransport,
  id: string | number,
  code: number,
  message: string
): Promise<void> {
  try {
    await transport.send({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
  } catch (err) {
    error(`Failed to send lifecycle error: ${String(err)}`);
  }
}
