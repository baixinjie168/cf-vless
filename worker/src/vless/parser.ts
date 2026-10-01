import {
  VLESS_COMMAND_TCP,
  VLESS_COMMAND_UDP,
  VLESS_COMMAND_MUX,
  ADDRESS_TYPE_IPV4,
  ADDRESS_TYPE_DOMAIN,
  ADDRESS_TYPE_IPV6,
} from "./protocol";
import { VlessRequest } from "./types";

/**
 * Converts 16-byte buffer into canonical lowercase UUID string (8-4-4-4-12).
 */
export function formatUuid(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < 16; i++) {
    parts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return [
    parts.slice(0, 4).join(""),
    parts.slice(4, 6).join(""),
    parts.slice(6, 8).join(""),
    parts.slice(8, 10).join(""),
    parts.slice(10, 16).join(""),
  ].join("-").toLowerCase();
}

/**
 * Converts 16-byte buffer into 8-group hexadecimal IPv6 string.
 */
export function formatIpv6(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 16);
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    parts.push(view.getUint16(i * 2).toString(16));
  }
  return parts.join(":");
}

/**
 * Parses VLESS header from raw binary buffer.
 * Pure function: strictly no network calls or external side effects.
 *
 * Packet binary layout:
 * - 1 byte: Protocol version (typically 0x00)
 * - 16 bytes: User UUID
 * - 1 byte: Addons length M
 * - M bytes: Addons payload
 * - 1 byte: Command (0x01: TCP, 0x02: UDP, 0x03: MUX)
 * - 2 bytes: Port (Big-endian, 1~65535)
 * - 1 byte: Address type (0x01: IPv4, 0x02: Domain, 0x03: IPv6)
 * - Address data:
 *     - IPv4: 4 bytes -> "a.b.c.d"
 *     - Domain: 1 byte length L + L ASCII bytes -> "example.com"
 *     - IPv6: 16 bytes -> 8 hex groups joined by ":"
 * - Remainder: Application payload (e.g. TLS ClientHello)
 */
export function parseVlessHeader(buffer: Uint8Array): VlessRequest {
  if (!buffer || buffer.length < 24) {
    throw new Error(
      `Invalid VLESS header: buffer too short (${buffer?.length ?? 0} bytes, minimum 24 bytes required)`
    );
  }

  const version = buffer[0];

  const uuid = formatUuid(buffer.subarray(1, 17));

  const addonsLen = buffer[17];
  if (buffer.length < 18 + addonsLen) {
    throw new Error(
      `Invalid VLESS header: truncated addons data (addons length ${addonsLen}, buffer length ${buffer.length})`
    );
  }
  let offset = 18 + addonsLen;

  if (buffer.length < offset + 4) {
    throw new Error(
      `Invalid VLESS header: buffer truncated before command/port/addressType metadata`
    );
  }

  const command = buffer[offset++];
  if (
    command !== VLESS_COMMAND_TCP &&
    command !== VLESS_COMMAND_UDP &&
    command !== VLESS_COMMAND_MUX
  ) {
    throw new Error(`Invalid VLESS command: ${command}`);
  }

  const port = (buffer[offset] << 8) | buffer[offset + 1];
  offset += 2;
  if (port <= 0 || port > 65535) {
    throw new Error(`Invalid VLESS port: ${port}`);
  }

  const addressType = buffer[offset++];
  let address = "";

  if (addressType === ADDRESS_TYPE_IPV4) {
    if (buffer.length < offset + 4) {
      throw new Error(`Invalid VLESS header: truncated IPv4 address`);
    }
    address = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
    offset += 4;
  } else if (addressType === ADDRESS_TYPE_DOMAIN) {
    if (buffer.length < offset + 1) {
      throw new Error(`Invalid VLESS header: missing domain length`);
    }
    const domainLen = buffer[offset++];
    if (domainLen === 0) {
      throw new Error(`Invalid VLESS header: empty domain name`);
    }
    if (buffer.length < offset + domainLen) {
      throw new Error(
        `Invalid VLESS header: truncated domain name (expected ${domainLen} bytes, got ${buffer.length - offset})`
      );
    }
    address = new TextDecoder().decode(buffer.subarray(offset, offset + domainLen));
    offset += domainLen;
  } else if (addressType === ADDRESS_TYPE_IPV6) {
    if (buffer.length < offset + 16) {
      throw new Error(`Invalid VLESS header: truncated IPv6 address`);
    }
    address = formatIpv6(buffer.subarray(offset, offset + 16));
    offset += 16;
  } else {
    throw new Error(`Invalid VLESS address type: ${addressType}`);
  }

  const payload = buffer.subarray(offset);

  return {
    version,
    uuid,
    command,
    port,
    addressType,
    address,
    payload,
  };
}
