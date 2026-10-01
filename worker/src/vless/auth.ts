/**
 * VLESS UUID Authentication & Security Module (Step 7)
 * Implements constant-time validation and fail-closed security policies.
 */

/**
 * Constant-time string comparison to prevent side-channel timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validates a request's extracted UUID against the configured environment secret UUID.
 *
 * Security policies:
 * - Fail-closed: If configuredUuid is undefined, empty or non-string, returns false.
 * - Normalized: Canonical lowercase comparison.
 * - Constant-time: Uses timingSafeEqual to defeat timing analysis.
 */
export function validateUuid(
  requestUuid: string,
  configuredUuid?: string
): boolean {
  if (!configuredUuid || typeof configuredUuid !== "string" || configuredUuid.trim() === "") {
    return false;
  }

  if (!requestUuid || typeof requestUuid !== "string" || requestUuid.trim() === "") {
    return false;
  }

  const normalizedReq = requestUuid.trim().toLowerCase();
  const normalizedConf = configuredUuid.trim().toLowerCase();

  return timingSafeEqual(normalizedReq, normalizedConf);
}
