/**
 * HTTP Request Handler
 * Handles diagnostic endpoints: /, /health, /info
 */
export async function handleHttp(request: Request, env: unknown): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return new Response(
      JSON.stringify({
        name: "cloudflare-proxy-lab",
        status: "ok",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  if (url.pathname === "/health") {
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

  return new Response("Not Found", { status: 404 });
}
