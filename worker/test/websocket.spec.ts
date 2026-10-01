import { describe, it, expect, beforeAll, afterAll } from "vitest";
import esbuild from "esbuild";
import { Miniflare } from "miniflare";

describe("WebSocket Full-Duplex Echo & Lifecycle (Step 3 & 4)", () => {
  let mf: Miniflare;

  beforeAll(async () => {
    const entryPath = new URL("../src/index.ts", (import.meta as any).url).pathname;
    const buildResult = esbuild.buildSync({
      entryPoints: [entryPath],
      bundle: true,
      format: "esm",
      write: false,
      sourcemap: "inline",
    });

    const code = buildResult.outputFiles[0].text;

    mf = new Miniflare({
      modules: true,
      script: code,
      compatibilityDate: "2024-09-23",
      compatibilityFlags: ["nodejs_compat"],
    });
  });

  afterAll(async () => {
    if (mf) {
      await mf.dispose();
    }
  });

  it("should reject non-WebSocket request to /ws with 426 Upgrade Required", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws");
    expect(response.status).toBe(426);
    expect(await response.text()).toContain("Expected Upgrade: websocket");
  });

  it("should reject non-GET request to /ws with 405 Method Not Allowed", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws", {
      method: "POST",
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });

  it("should upgrade connection with 101 Switching Protocols when Upgrade header is present", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws", {
      headers: { Upgrade: "websocket" },
    });

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();

    const ws = response.webSocket!;
    ws.accept();
    ws.close(1000, "Test done");
  });

  it("should send 'welcome' message immediately upon connection", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;

    const firstMessagePromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        resolve(String(event.data));
      });
    });

    ws.accept();

    const firstMsg = await firstMessagePromise;
    expect(firstMsg).toBe("welcome");

    ws.close(1000, "Test done");
  });

  it("should echo text messages back to the client", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;
    const messagesReceived: string[] = [];

    const echoPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        messagesReceived.push(String(event.data));
        // We expect "welcome", then "hello cloudflare", then "ping"
        if (messagesReceived.length === 3) {
          resolve();
        }
      });
    });

    ws.accept();

    // Give a brief moment for welcome to be dispatched, then send echo messages
    await new Promise((r) => setTimeout(r, 20));
    ws.send("hello cloudflare");
    ws.send("ping");

    await echoPromise;

    expect(messagesReceived).toEqual(["welcome", "hello cloudflare", "ping"]);

    ws.close(1000, "Test done");
  });

  it("should echo binary messages back to the client", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;
    const binaryData = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x42]);

    const binaryEchoPromise = new Promise<Uint8Array>((resolve) => {
      ws.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          resolve(new Uint8Array(event.data));
        }
      });
    });

    ws.accept();

    await new Promise((r) => setTimeout(r, 20));
    ws.send(binaryData);

    const receivedBinary = await binaryEchoPromise;
    expect(Array.from(receivedBinary)).toEqual(Array.from(binaryData));

    ws.close(1000, "Test done");
  });

  it("should handle graceful close event without hanging", async () => {
    const response = await mf.dispatchFetch("http://localhost/ws", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.addEventListener("close", (event: any) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });

    ws.accept();
    await new Promise((r) => setTimeout(r, 20));

    ws.close(1000, "Normal Closure Test");

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toBe("Normal Closure Test");
  });
});
