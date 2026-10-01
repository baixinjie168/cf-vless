import { describe, it, expect, beforeAll, afterAll } from "vitest";
import esbuild from "esbuild";
import { Miniflare } from "miniflare";
import { timingSafeEqual, validateUuid } from "../src/vless/auth";
import {
  VLESS_COMMAND_TCP,
  ADDRESS_TYPE_IPV4,
} from "../src/vless/protocol";

function buildTestPacket(uuid: string): Uint8Array {
  const cleanUuid = uuid.replace(/-/g, "");
  const uuidBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(cleanUuid.slice(i * 2, i * 2 + 2), 16);
  }

  // 1 + 16 + 1 + 0 + 1 + 2 + 1 + 4 = 26 bytes
  const buf = new Uint8Array(26);
  let offset = 0;
  buf[offset++] = 0; // version 0
  buf.set(uuidBytes, offset);
  offset += 16;
  buf[offset++] = 0; // addonsLen 0
  buf[offset++] = VLESS_COMMAND_TCP; // command TCP (1)
  buf[offset++] = 1; // port 443 (0x01bb)
  buf[offset++] = 187;
  buf[offset++] = ADDRESS_TYPE_IPV4; // addressType IPv4 (1)
  buf.set([1, 1, 1, 1], offset); // address 1.1.1.1

  return buf;
}

describe("VLESS UUID Authentication & Short-Circuit Defense (Step 7)", () => {
  describe("Unit Tests: timingSafeEqual and validateUuid", () => {
    const validUuid = "b63f6402-998e-4a65-8b83-d1d78a9c4039";

    it("should return true for identical UUIDs", () => {
      expect(validateUuid(validUuid, validUuid)).toBe(true);
    });

    it("should return true for case-insensitive matching", () => {
      expect(validateUuid(validUuid, validUuid.toUpperCase())).toBe(true);
      expect(validateUuid(validUuid.toUpperCase(), validUuid)).toBe(true);
    });

    it("should return true when UUID has surrounding whitespace", () => {
      expect(validateUuid(`  ${validUuid}  `, validUuid)).toBe(true);
    });

    it("should return false for mismatched UUIDs", () => {
      const wrongUuid = "11111111-2222-3333-4444-555555555555";
      expect(validateUuid(validUuid, wrongUuid)).toBe(false);
    });

    it("FAIL-CLOSED: should return false when configured UUID is missing or undefined", () => {
      expect(validateUuid(validUuid, undefined)).toBe(false);
      expect(validateUuid(validUuid, "")).toBe(false);
    });

    it("FAIL-CLOSED: should return false when request UUID is empty or invalid", () => {
      expect(validateUuid("", validUuid)).toBe(false);
      expect(validateUuid("   ", validUuid)).toBe(false);
    });

    it("timingSafeEqual should handle strings of different lengths safely", () => {
      expect(timingSafeEqual("abc", "abcdef")).toBe(false);
      expect(timingSafeEqual("abcdef", "abc")).toBe(false);
      expect(timingSafeEqual("exact", "exact")).toBe(true);
    });
  });

  describe("Integration Tests: WebSocket VLESS Authentication Flow (Miniflare)", () => {
    const correctUuid = "b63f6402-998e-4a65-8b83-d1d78a9c4039";
    const wrongUuid = "00000000-0000-0000-0000-000000000000";

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
        bindings: {
          VLESS_UUID: correctUuid,
          ENVIRONMENT: "test",
        },
      });
    });

    afterAll(async () => {
      if (mf) {
        await mf.dispose();
      }
    });

    it("SUCCESS: should authenticate valid UUID and acknowledge with VLESS response header [0, 0]", async () => {
      const response = await mf.dispatchFetch("http://localhost/vless", {
        headers: { Upgrade: "websocket" },
      });

      expect(response.status).toBe(101);
      const ws = response.webSocket!;

      const responsePromise = new Promise<Uint8Array>((resolve) => {
        ws.addEventListener("message", (event) => {
          if (event.data instanceof ArrayBuffer) {
            resolve(new Uint8Array(event.data));
          }
        });
      });

      ws.accept();

      // Send valid VLESS packet
      const packet = buildTestPacket(correctUuid);
      ws.send(packet.buffer as ArrayBuffer);

      const respHeader = await responsePromise;
      expect(Array.from(respHeader)).toEqual([0x00, 0x00]);

      ws.close(1000, "Normal test completion");
    });

    it("SHORT-CIRCUIT DEFENSE: should immediately terminate with 1008 Policy Violation on wrong UUID", async () => {
      const response = await mf.dispatchFetch("http://localhost/vless", {
        headers: { Upgrade: "websocket" },
      });

      expect(response.status).toBe(101);
      const ws = response.webSocket!;

      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.addEventListener("close", (event: any) => {
          resolve({ code: event.code, reason: event.reason });
        });
      });

      ws.accept();

      // Send packet with unauthorized/wrong UUID
      const packet = buildTestPacket(wrongUuid);
      ws.send(packet.buffer as ArrayBuffer);

      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid User UUID");
    });

    it("PROTOCOL DEFENSE: should reject non-binary first frame with code 1003 Unsupported Data", async () => {
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
      ws.send("plain text hello");

      const closeCode = await closePromise;
      expect(closeCode).toBe(1003);
    });

    it("PROTOCOL DEFENSE: should reject malformed VLESS binary header with code 1002 Protocol Error", async () => {
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
      // Send truncated 5-byte corrupted packet
      ws.send(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));

      const closeCode = await closePromise;
      expect(closeCode).toBe(1002);
    });
  });
});
