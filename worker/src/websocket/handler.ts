import { parseVlessHeader } from "../vless/parser";
import { validateUuid } from "../vless/auth";
import { VLESS_COMMAND_TCP } from "../vless/protocol";
import {
  OutboundConnection,
  OutboundConnector,
  DirectTcpConnector,
  MockConnector,
} from "../outbound/connector";

export interface WebSocketEnv {
  VLESS_UUID?: string;
  ENVIRONMENT?: string;
  OUTBOUND_MOCK?: string;
}

/**
 * Handles diagnostic echo WebSocket on /ws (Milestone 1, Step 3 & 4).
 */
export async function handleEchoWebSocket(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const upgradeHeader = request.headers.get("Upgrade")?.toLowerCase();
  if (upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", {
      status: 426,
      statusText: "Upgrade Required",
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
      },
    });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  // Send initial welcome message upon connection
  server.send("welcome");

  // Full-duplex echo for text and binary messages
  server.addEventListener("message", (event: MessageEvent) => {
    try {
      server.send(event.data);
    } catch {
      try {
        server.close(1011, "Echo send error");
      } catch {
        // Socket already closed
      }
    }
  });

  server.addEventListener("close", (event: CloseEvent) => {
    try {
      server.close(event.code || 1000, event.reason || "Normal Closure");
    } catch {
      // Socket already closed
    }
  });

  server.addEventListener("error", () => {
    try {
      server.close(1011, "WebSocket Error");
    } catch {
      // Socket already closed
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Handles VLESS WebSocket proxy connections with full-duplex outbound streaming pipeline (Step 10).
 */
export async function handleVlessWebSocket(
  request: Request,
  env?: WebSocketEnv,
  connector?: OutboundConnector
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const upgradeHeader = request.headers.get("Upgrade")?.toLowerCase();
  if (upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", {
      status: 426,
      statusText: "Upgrade Required",
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
      },
    });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  const outboundConnector =
    connector ??
    (env?.OUTBOUND_MOCK === "true" || env?.ENVIRONMENT === "test"
      ? new MockConnector()
      : new DirectTcpConnector());

  let authenticated = false;
  let isConnecting = false;
  let isCleanedUp = false;
  let outboundConn: OutboundConnection | null = null;
  let tcpWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  const pendingBuffer: Uint8Array[] = [];

  const cleanup = async (code = 1000, reason = "Normal Closure") => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    try {
      server.close(code, reason);
    } catch {}
    if (tcpWriter) {
      try {
        await tcpWriter.close();
      } catch {}
    }
    if (outboundConn) {
      try {
        await outboundConn.close();
      } catch {}
    }
  };

  server.addEventListener("message", async (event: MessageEvent) => {
    try {
      if (!authenticated && !isConnecting) {
        // First packet must be binary VLESS request frame
        if (
          !(event.data instanceof ArrayBuffer) &&
          !(event.data instanceof Uint8Array)
        ) {
          server.close(1003, "Unsupported Data: expected VLESS binary frame");
          return;
        }

        const buffer =
          event.data instanceof Uint8Array
            ? event.data
            : new Uint8Array(event.data);

        let vlessReq;
        try {
          vlessReq = parseVlessHeader(buffer);
        } catch {
          server.close(1002, "Protocol Error: invalid VLESS header");
          return;
        }

        // 1. Authenticate UUID against configured environment secret
        const configuredUuid = env?.VLESS_UUID;
        if (!validateUuid(vlessReq.uuid, configuredUuid)) {
          // Immediately terminate with 1008 Policy Violation, prevent any outbound traffic
          server.close(1008, "Policy Violation: Invalid User UUID");
          return;
        }

        // 2. Validate Command: only TCP (1) is supported
        if (vlessReq.command !== VLESS_COMMAND_TCP) {
          server.close(
            1003,
            "Unsupported Command: only TCP (1) is currently supported"
          );
          return;
        }

        // 3. Validate Port: block Port 25 (SMTP)
        if (vlessReq.port === 25) {
          server.close(
            1008,
            "Policy Violation: Port 25 (SMTP) is prohibited on Cloudflare network"
          );
          return;
        }

        isConnecting = true;

        try {
          // 4. Dial Outbound TCP connection
          outboundConn = await outboundConnector.connect(
            vlessReq.address,
            vlessReq.port
          );
          tcpWriter = outboundConn.writable.getWriter();
          authenticated = true;
          isConnecting = false;

          // 5. Send VLESS response header (version 0, addons length 0)
          server.send(new Uint8Array([0, 0]));

          // 6. Inject initial application payload (e.g. TLS ClientHello)
          if (vlessReq.payload && vlessReq.payload.length > 0) {
            await tcpWriter.write(vlessReq.payload);
          }

          // 7. Flush any packets that arrived during connection handshake
          while (pendingBuffer.length > 0) {
            const chunk = pendingBuffer.shift();
            if (chunk) {
              await tcpWriter.write(chunk);
            }
          }

          // 8. Start downstream pump: TCP readable -> Client WebSocket
          (async () => {
            if (!outboundConn) return;
            const reader = outboundConn.readable.getReader();
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  await cleanup(1000, "Outbound connection closed");
                  break;
                }
                if (value && value.length > 0) {
                  server.send(value);
                }
              }
            } catch {
              await cleanup(1011, "Outbound read error");
            } finally {
              reader.releaseLock();
            }
          })();
        } catch {
          isConnecting = false;
          await cleanup(1011, "Outbound connection failed");
          return;
        }
      } else if (isConnecting) {
        // Queue chunk if arrived while outbound socket is opening
        const chunk =
          event.data instanceof Uint8Array
            ? event.data
            : event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : new TextEncoder().encode(String(event.data));
        pendingBuffer.push(chunk);
      } else if (authenticated && tcpWriter) {
        // Forward subsequent client packets to outbound TCP writer
        const chunk =
          event.data instanceof Uint8Array
            ? event.data
            : event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : new TextEncoder().encode(String(event.data));
        await tcpWriter.write(chunk);
      }
    } catch {
      await cleanup(1011, "Internal Streaming Pipeline Error");
    }
  });

  server.addEventListener("close", async () => {
    await cleanup(1000, "Client WebSocket closed");
  });

  server.addEventListener("error", async () => {
    await cleanup(1011, "Client WebSocket error");
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Main WebSocket router: routes /ws to diagnostic echo, and other paths to VLESS proxy.
 */
export async function handleWebSocket(
  request: Request,
  env?: WebSocketEnv,
  connector?: OutboundConnector
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/ws") {
    return handleEchoWebSocket(request);
  }
  return handleVlessWebSocket(request, env, connector);
}
