/**
 * WebSocket Request Handler (Step 3)
 * Handles WebSocket upgrade, welcome greeting, full-duplex message echo,
 * and connection lifecycle management.
 */
export async function handleWebSocket(request: Request): Promise<Response> {
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

  // Lifecycle management: close and error handling
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
