export interface Env {
  VLESS_UUID?: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response(
      JSON.stringify({
        name: "cloudflare-proxy-lab",
        status: "ok",
        version: "0.1.0",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  },
};
