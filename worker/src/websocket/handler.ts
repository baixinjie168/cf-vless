import { parseVlessHeader } from "../vless/parser";
import { validateUuid } from "../vless/auth";

export interface WebSocketEnv {
  VLESS_UUID?: string;
  ENVIRONMENT?: string;
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
 * Handles VLESS WebSocket proxy connections with UUID authentication (Milestone 2, Step 7).
 */
export async function handleVlessWebSocket(
  request: Request,
  env?: WebSocketEnv
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

  let authenticated = false;

  server.addEventListener("message", (event: MessageEvent) => {
    try {
      if (!authenticated) {
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

        // Authenticate UUID against configured environment secret
        const configuredUuid = env?.VLESS_UUID;
        if (!validateUuid(vlessReq.uuid, configuredUuid)) {
          // Immediately terminate with 1008 Policy Violation, prevent any outbound traffic
          server.close(1008, "Policy Violation: Invalid User UUID");
          return;
        }

        authenticated = true;

        // Step 7: Acknowledge successful authentication with VLESS response header (version 0, addons length 0)
        // This confirms the connection is validated and ready for Step 10 outbound pipeline.
        server.send(new Uint8Array([0, 0]));
      } else {
        // Subsequent packets once authenticated
        server.send(event.data);
      }
    } catch {
      try {
        server.close(1011, "Internal Server Error");
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
 * Main WebSocket router: routes /ws to diagnostic echo, and other paths to VLESS proxy.
 */
export async function handleWebSocket(
  request: Request,
  env?: WebSocketEnv
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/ws") {
    return handleEchoWebSocket(request);
  }
  return handleVlessWebSocket(request, env);
}
