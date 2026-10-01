import { handleHttp } from "./http/handler";
import { handleWebSocket } from "./websocket/handler";

export interface Env {
  VLESS_UUID?: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade");

    if (url.pathname === "/ws" || upgradeHeader === "websocket") {
      return handleWebSocket(request);
    }

    return handleHttp(request, env);
  },
};
