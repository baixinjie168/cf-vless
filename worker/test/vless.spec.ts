import { describe, it, expect } from "vitest";
import { parseVlessHeader, formatUuid, formatIpv6 } from "../src/vless/parser";
import {
  VLESS_COMMAND_TCP,
  VLESS_COMMAND_UDP,
  VLESS_COMMAND_MUX,
  ADDRESS_TYPE_IPV4,
  ADDRESS_TYPE_DOMAIN,
  ADDRESS_TYPE_IPV6,
} from "../src/vless/protocol";

interface BuildOptions {
  version?: number;
  uuid?: string;
  addons?: Uint8Array;
  command?: number;
  port?: number;
  addressType: number;
  address: string;
  payload?: Uint8Array;
}

function buildVlessPacket({
  version = 0,
  uuid = "b63f6402-998e-4a65-8b83-d1d78a9c4039",
  addons = new Uint8Array(0),
  command = VLESS_COMMAND_TCP,
  port = 443,
  addressType,
  address,
  payload = new Uint8Array(0),
}: BuildOptions): Uint8Array {
  const cleanUuid = uuid.replace(/-/g, "");
  const uuidBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(cleanUuid.slice(i * 2, i * 2 + 2), 16);
  }

  let addrBytes: Uint8Array;
  if (addressType === ADDRESS_TYPE_IPV4) {
    addrBytes = new Uint8Array(address.split(".").map(Number));
  } else if (addressType === ADDRESS_TYPE_DOMAIN) {
    const enc = new TextEncoder().encode(address);
    addrBytes = new Uint8Array(1 + enc.length);
    addrBytes[0] = enc.length;
    addrBytes.set(enc, 1);
  } else if (addressType === ADDRESS_TYPE_IPV6) {
    addrBytes = new Uint8Array(16);
    const view = new DataView(addrBytes.buffer);
    const parts = address.split(":");
    for (let i = 0; i < 8; i++) {
      view.setUint16(i * 2, parseInt(parts[i] || "0", 16));
    }
  } else {
    // Arbitrary raw byte for invalid addressType testing
    addrBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  }

  const totalLen =
    1 + 16 + 1 + addons.length + 1 + 2 + 1 + addrBytes.length + payload.length;
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  buf[offset++] = version;
  buf.set(uuidBytes, offset);
  offset += 16;

  buf[offset++] = addons.length;
  if (addons.length > 0) {
    buf.set(addons, offset);
    offset += addons.length;
  }

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

describe("VLESS Pure Function Parser (Step 5 & 6)", () => {
  const testUuid = "b63f6402-998e-4a65-8b83-d1d78a9c4039";

  describe("Positive Test Cases", () => {
    it("should correctly parse a standard IPv4 target request (1.1.1.1:53)", () => {
      const packet = buildVlessPacket({
        uuid: testUuid,
        command: VLESS_COMMAND_UDP,
        port: 53,
        addressType: ADDRESS_TYPE_IPV4,
        address: "1.1.1.1",
        payload: new Uint8Array([0x12, 0x34]),
      });

      const parsed = parseVlessHeader(packet);
      expect(parsed.version).toBe(0);
      expect(parsed.uuid).toBe(testUuid);
      expect(parsed.command).toBe(VLESS_COMMAND_UDP);
      expect(parsed.port).toBe(53);
      expect(parsed.addressType).toBe(ADDRESS_TYPE_IPV4);
      expect(parsed.address).toBe("1.1.1.1");
      expect(Array.from(parsed.payload)).toEqual([0x12, 0x34]);
    });

    it("should correctly parse a standard Domain target request (example.com:443)", () => {
      const payloadBytes = new Uint8Array([0x16, 0x03, 0x01, 0x00, 0xaa]);
      const packet = buildVlessPacket({
        uuid: testUuid,
        command: VLESS_COMMAND_TCP,
        port: 443,
        addressType: ADDRESS_TYPE_DOMAIN,
        address: "example.com",
        payload: payloadBytes,
      });

      const parsed = parseVlessHeader(packet);
      expect(parsed.version).toBe(0);
      expect(parsed.uuid).toBe(testUuid);
      expect(parsed.command).toBe(VLESS_COMMAND_TCP);
      expect(parsed.port).toBe(443);
      expect(parsed.addressType).toBe(ADDRESS_TYPE_DOMAIN);
      expect(parsed.address).toBe("example.com");
      expect(Array.from(parsed.payload)).toEqual(Array.from(payloadBytes));
    });

    it("should correctly parse an IPv6 target request (2606:4700:0:0:0:0:0:6810:443)", () => {
      const packet = buildVlessPacket({
        uuid: testUuid,
        command: VLESS_COMMAND_TCP,
        port: 443,
        addressType: ADDRESS_TYPE_IPV6,
        address: "2606:4700:0:0:0:0:0:6810",
      });

      const parsed = parseVlessHeader(packet);
      expect(parsed.version).toBe(0);
      expect(parsed.uuid).toBe(testUuid);
      expect(parsed.command).toBe(VLESS_COMMAND_TCP);
      expect(parsed.port).toBe(443);
      expect(parsed.addressType).toBe(ADDRESS_TYPE_IPV6);
      expect(parsed.address).toBe("2606:4700:0:0:0:0:0:6810");
      expect(parsed.payload.length).toBe(0);
    });

    it("should correctly handle empty payload (payload length === 0)", () => {
      const packet = buildVlessPacket({
        uuid: testUuid,
        addressType: ADDRESS_TYPE_DOMAIN,
        address: "cloudflare.com",
        port: 80,
        payload: new Uint8Array(0),
      });

      const parsed = parseVlessHeader(packet);
      expect(parsed.address).toBe("cloudflare.com");
      expect(parsed.payload.byteLength).toBe(0);
    });

    it("should correctly preserve large application payload (4KB TLS ClientHello)", () => {
      const largePayload = new Uint8Array(4096);
      for (let i = 0; i < largePayload.length; i++) {
        largePayload[i] = i % 256;
      }

      const packet = buildVlessPacket({
        uuid: testUuid,
        addressType: ADDRESS_TYPE_DOMAIN,
        address: "secure.gateway.net",
        port: 8443,
        payload: largePayload,
      });

      const parsed = parseVlessHeader(packet);
      expect(parsed.payload.byteLength).toBe(4096);
      expect(parsed.payload[0]).toBe(0);
      expect(parsed.payload[255]).toBe(255);
      expect(parsed.payload[4095]).toBe(4095 % 256);
    });

    it("should correctly parse packets with Addons (M > 0)", () => {
      const addons = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
      const packet = buildVlessPacket({
        uuid: testUuid,
        addons,
        command: VLESS_COMMAND_MUX,
        port: 1080,
        addressType: ADDRESS_TYPE_IPV4,
        address: "127.0.0.1",
        payload: new Uint8Array([0x99]),
      });

      const parsed = parseVlessHeader(packet);
      expect(parsed.command).toBe(VLESS_COMMAND_MUX);
      expect(parsed.port).toBe(1080);
      expect(parsed.address).toBe("127.0.0.1");
      expect(Array.from(parsed.payload)).toEqual([0x99]);
    });

    it("should support port boundary values (1 and 65535)", () => {
      const packetMin = buildVlessPacket({
        port: 1,
        addressType: ADDRESS_TYPE_IPV4,
        address: "10.0.0.1",
      });
      expect(parseVlessHeader(packetMin).port).toBe(1);

      const packetMax = buildVlessPacket({
        port: 65535,
        addressType: ADDRESS_TYPE_IPV4,
        address: "10.0.0.1",
      });
      expect(parseVlessHeader(packetMax).port).toBe(65535);
    });
  });

  describe("Negative and Edge-Case Robustness Tests", () => {
    it("should throw when buffer is null, undefined, or shorter than 24 bytes", () => {
      expect(() => parseVlessHeader(null as unknown as Uint8Array)).toThrow(
        /buffer too short/i
      );
      expect(() => parseVlessHeader(new Uint8Array(0))).toThrow(
        /buffer too short/i
      );
      expect(() => parseVlessHeader(new Uint8Array(23))).toThrow(
        /buffer too short/i
      );
    });

    it("should throw when addons declare length larger than remaining buffer", () => {
      // 24 bytes buffer, but addons length claims 20 bytes (overflowing available space)
      const corrupted = new Uint8Array(24);
      corrupted[17] = 20; // addonsLen = 20, 18 + 20 = 38 > 24
      expect(() => parseVlessHeader(corrupted)).toThrow(
        /truncated addons data/i
      );
    });

    it("should throw when buffer ends immediately after addons before command/port metadata", () => {
      // 24 bytes total, addonsLen = 4 (18 + 4 = 22 bytes), only 2 bytes left (< 4 needed)
      const corrupted = new Uint8Array(24);
      corrupted[17] = 4;
      expect(() => parseVlessHeader(corrupted)).toThrow(
        /buffer truncated before command\/port\/addressType metadata/i
      );
    });

    it("should throw on invalid VLESS command (e.g. 0, 4, 255)", () => {
      const invalidCmd0 = buildVlessPacket({
        command: 0,
        addressType: ADDRESS_TYPE_IPV4,
        address: "1.1.1.1",
      });
      expect(() => parseVlessHeader(invalidCmd0)).toThrow(
        /invalid vless command: 0/i
      );

      const invalidCmd4 = buildVlessPacket({
        command: 4,
        addressType: ADDRESS_TYPE_IPV4,
        address: "1.1.1.1",
      });
      expect(() => parseVlessHeader(invalidCmd4)).toThrow(
        /invalid vless command: 4/i
      );
    });

    it("should throw on invalid port (port 0)", () => {
      const packetPort0 = buildVlessPacket({
        port: 0,
        addressType: ADDRESS_TYPE_IPV4,
        address: "1.1.1.1",
      });
      expect(() => parseVlessHeader(packetPort0)).toThrow(
        /invalid vless port: 0/i
      );
    });

    it("should throw on unrecognized addressType", () => {
      const packetBadType = buildVlessPacket({
        addressType: 0x04,
        address: "1.1.1.1",
      });
      expect(() => parseVlessHeader(packetBadType)).toThrow(
        /invalid vless address type: 4/i
      );
    });

    it("should throw when domain length is 0", () => {
      // Packet with addressType = DOMAIN, but domain length = 0
      const base = buildVlessPacket({
        addressType: ADDRESS_TYPE_DOMAIN,
        address: "a", // placeholder
      });
      // Offset of addressType in standard packet without addons is 21
      // base[21] = 0x02, base[22] = domainLen = 1
      base[22] = 0; // set domainLen = 0
      expect(() => parseVlessHeader(base)).toThrow(/empty domain name/i);
    });

    it("should throw when domain is truncated (claims 50 bytes, has 5)", () => {
      const base = buildVlessPacket({
        addressType: ADDRESS_TYPE_DOMAIN,
        address: "short",
      });
      // Set domain length to 50 when only 5 bytes are present
      base[22] = 50;
      expect(() => parseVlessHeader(base)).toThrow(/truncated domain name/i);
    });

    it("should throw when IPv4 address is truncated", () => {
      const packet = buildVlessPacket({
        addressType: ADDRESS_TYPE_IPV4,
        address: "1.1.1.1",
      });
      // Truncate the last 2 bytes of IPv4
      const truncated = packet.subarray(0, packet.length - 2);
      expect(() => parseVlessHeader(truncated)).toThrow(/truncated ipv4 address/i);
    });

    it("should throw when IPv6 address is truncated", () => {
      const packet = buildVlessPacket({
        addressType: ADDRESS_TYPE_IPV6,
        address: "2606:4700:0:0:0:0:0:6810",
      });
      // Truncate the last 8 bytes of IPv6
      const truncated = packet.subarray(0, packet.length - 8);
      expect(() => parseVlessHeader(truncated)).toThrow(/truncated ipv6 address/i);
    });
  });

  describe("Helper Functions", () => {
    it("formatUuid should format 16 raw bytes into standard 36-char lowercase UUID", () => {
      const raw = new Uint8Array([
        0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
        0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
      ]);
      expect(formatUuid(raw)).toBe("01234567-89ab-cdef-fedc-ba9876543210");
    });

    it("formatIpv6 should format 16 raw bytes into 8 hex groups", () => {
      const raw = new Uint8Array([
        0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
      ]);
      expect(formatIpv6(raw)).toBe("2001:db8:0:0:0:0:0:1");
    });
  });
});
