import { describe, it, expect, beforeAll, afterAll } from "vitest";
import esbuild from "esbuild";
import { Miniflare } from "miniflare";
import {
  VLESS_COMMAND_TCP,
  VLESS_COMMAND_UDP,
  ADDRESS_TYPE_IPV4,
  ADDRESS_TYPE_DOMAIN,
} from "../src/vless/protocol";

function buildVlessRequestPacket(options: {
  uuid: string;
  command?: number;
  port?: number;
  addressType?: number;
  address?: string;
  payload?: Uint8Array;
}): Uint8Array {
  const cleanUuid = options.uuid.replace(/-/g, "");
  const uuidBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(cleanUuid.slice(i * 2, i * 2 + 2), 16);
  }

  const command = options.command ?? VLESS_COMMAND_TCP;
  const port = options.port ?? 443;
  const address = options.address ?? "1.1.1.1";
  const addressType =
    options.addressType ??
    (isNaN(Number(address.split(".")[0]))
      ? ADDRESS_TYPE_DOMAIN
      : ADDRESS_TYPE_IPV4);
  const payload = options.payload ?? new Uint8Array(0);

  let addrBytes: Uint8Array;
  if (addressType === ADDRESS_TYPE_IPV4) {
    addrBytes = new Uint8Array(address.split(".").map(Number));
  } else if (addressType === ADDRESS_TYPE_DOMAIN) {
    const enc = new TextEncoder().encode(address);
    addrBytes = new Uint8Array(1 + enc.length);
    addrBytes[0] = enc.length;
    addrBytes.set(enc, 1);
  } else {
    addrBytes = new Uint8Array([1, 1, 1, 1]);
  }

  const totalLen = 1 + 16 + 1 + 0 + 1 + 2 + 1 + addrBytes.length + payload.length;
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  buf[offset++] = 0; // version 0
  buf.set(uuidBytes, offset);
  offset += 16;
  buf[offset++] = 0; // addons length 0
  buf[offset++] = command;
  buf[offset++] = (port >> 8) & 0xff;
  buf[offset++] = port & 0xff;
  buf[offset++] = addressType;
  buf.set(addrBytes, offset);
  offset += addrBytes.length;

  if (payload.length > 0) {
    buf.set(payload, offset);
  }

  return buf;
}

describe("VLESS to Outbound Streaming Pipeline (Step 10)", () => {
  const testUuid = "b63f6402-998e-4a65-8b83-d1d78a9c4039";
  let mf: Miniflare;

  beforeAll(async () => {
    const entryPath = new URL("../src/index.ts", (import.meta as any).url).pathname;
    const buildResult = esbuild.buildSync({
      entryPoints: [entryPath],
      bundle: true,
      format: "esm",
      write: false,
      sourcemap: "inline",
      external: ["cloudflare:*"],
    });

    const code = buildResult.outputFiles[0].text;

    mf = new Miniflare({
      modules: true,
      script: code,
      compatibilityDate: "2024-09-23",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        VLESS_UUID: testUuid,
        ENVIRONMENT: "test",
        OUTBOUND_MOCK: "true",
      },
    });
  });

  afterAll(async () => {
    if (mf) {
      await mf.dispose();
    }
  });

  it("should forward initial payload and stream bi-directionally end-to-end", async () => {
    const response = await mf.dispatchFetch("http://localhost/vless", {
      headers: { Upgrade: "websocket" },
    });

    expect(response.status).toBe(101);
    const ws = response.webSocket!;

    const receivedChunks: Uint8Array[] = [];
    const pipelinePromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          receivedChunks.push(new Uint8Array(event.data));
          // We expect: 1. [0, 0] VLESS response header
          //            2. Initial payload echo [0x16, 0x03, 0x01]
          //            3. Subsequent message echo
          if (receivedChunks.length >= 3) {
            resolve();
          }
        }
      });
    });

    ws.accept();

    // 1. Send VLESS request packet containing an initial payload (TLS ClientHello prefix)
    const initialPayload = new Uint8Array([0x16, 0x03, 0x01]);
    const packet = buildVlessRequestPacket({
      uuid: testUuid,
      addressType: ADDRESS_TYPE_DOMAIN,
      address: "example.com",
      port: 443,
      payload: initialPayload,
    });

    ws.send(packet.buffer as ArrayBuffer);

    // Give a brief tick then send subsequent streaming chunk
    await new Promise((r) => setTimeout(r, 30));
    ws.send(new Uint8Array([0xaa, 0xbb, 0xcc]).buffer as ArrayBuffer);

    await pipelinePromise;

    // First chunk must be VLESS response header [0, 0]
    expect(Array.from(receivedChunks[0])).toEqual([0x00, 0x00]);
    // Second chunk is the echoed initial payload
    expect(Array.from(receivedChunks[1])).toEqual([0x16, 0x03, 0x01]);
    // Third chunk is the echoed subsequent stream chunk
    expect(Array.from(receivedChunks[2])).toEqual([0xaa, 0xbb, 0xcc]);

    ws.close(1000, "Done testing streaming pipeline");
  });

  it("SECURITY: should reject connections targeting Port 25 (SMTP)", async () => {
    const response = await mf.dispatchFetch("http://localhost/vless", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;
    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.addEventListener("close", (event: any) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });

    ws.accept();

    const packet = buildVlessRequestPacket({
      uuid: testUuid,
      port: 25,
      address: "smtp.mail.com",
    });

    ws.send(packet.buffer as ArrayBuffer);

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toContain("Port 25");
  });

  it("PROTOCOL: should reject unsupported commands (UDP command 2)", async () => {
    const response = await mf.dispatchFetch("http://localhost/vless", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;
    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.addEventListener("close", (event: any) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });

    ws.accept();

    const packet = buildVlessRequestPacket({
      uuid: testUuid,
      command: VLESS_COMMAND_UDP,
      port: 53,
      address: "8.8.8.8",
    });

    ws.send(packet.buffer as ArrayBuffer);

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1003);
    expect(closeEvent.reason).toContain("Unsupported Command");
  });

  it("LIFECYCLE: should cleanly handle mutual close from client", async () => {
    const response = await mf.dispatchFetch("http://localhost/vless", {
      headers: { Upgrade: "websocket" },
    });

    const ws = response.webSocket!;
    const closePromise = new Promise<number>((resolve) => {
      ws.addEventListener("close", (event: any) => {
        resolve(event.code);
      });
    });

    ws.accept();

    const packet = buildVlessRequestPacket({
      uuid: testUuid,
      address: "test.org",
      port: 80,
    });
    ws.send(packet.buffer as ArrayBuffer);

    await new Promise((r) => setTimeout(r, 20));
    ws.close(1000, "Client initiated close");

    const code = await closePromise;
    expect(code).toBe(1000);
  });
});
