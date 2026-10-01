/**
 * Stub implementation of cloudflare:sockets for local Node.js Vitest test execution.
 */
export function connect(address: string | { hostname: string; port: number }) {
  throw new Error(
    "cloudflare:sockets is only available in Cloudflare Workers runtime. Use MockConnector for local tests."
  );
}
