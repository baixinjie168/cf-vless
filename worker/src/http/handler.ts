import { getConfig } from "../config/config";

/**
 * HTTP Request Handler
 * Handles diagnostic endpoints: /, /health, /info
 */
export async function handleHttp(request: Request, env: unknown): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }

    return new Response(
      JSON.stringify({
        name: "cloudflare-proxy-lab",
        status: "ok",
        version: "0.1.0",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }

    return new Response(
      JSON.stringify({
        status: "ok",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  if (url.pathname === "/info") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }

    const config = getConfig((env || {}) as Record<string, unknown>);

    // Strictly ensure no secrets (such as UUID) are leaked
    return new Response(
      JSON.stringify({
        name: "cloudflare-proxy-lab",
        status: "ok",
        version: "0.1.0",
        environment: config.environment,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  return new Response("Not Found", { status: 404 });
}
