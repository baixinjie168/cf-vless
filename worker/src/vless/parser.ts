import { VlessRequest } from "./types";

/**
 * Parses VLESS header from raw binary buffer.
 * Pure function: strictly no network calls or external side effects.
 */
export function parseVlessHeader(buffer: Uint8Array): VlessRequest {
  throw new Error("VLESS Parser not yet implemented (scheduled for Step 5)");
}
