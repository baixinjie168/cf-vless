import { getConfig } from "../config/config";
import { VlessNodeConfig } from "../subscription/types";
import {
  generateClashYaml,
  generateBase64Subscription,
  generateSingboxJson,
} from "../subscription/generator";
import { renderDashboardHtml } from "../subscription/html";

/**
 * HTTP Request Handler
 * Handles:
 * - /: Web Subscription & Management Dashboard (HTML) or Diagnostic Status (JSON)
 * - /sub: Clash Verge / Base64 / sing-box Subscription Distribution
 * - /health: Health probe
 * - /info: Environment metadata probe (secrets masked)
 */
export async function handleHttp(request: Request, env: unknown): Promise<Response> {
  const url = new URL(request.url);

  // Handle CORS preflight options
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
  };

  const config = getConfig((env || {}) as Record<string, unknown>);

  // Helper to construct current node configuration
  const host = url.hostname;
  const isHttps = url.protocol === "https:";
  const port = url.port
    ? parseInt(url.port, 10)
    : isHttps
    ? 443
    : 80;
  const tls = isHttps || port === 443;
  const nodeName = host.split(".")[0] || "open-window";

  const nodeConfig: VlessNodeConfig = {
    name: nodeName,
    host: host,
    port: tls ? 443 : port,
    uuid: config.uuid || "d34db33f-9999-4444-8888-123456789abc",
    path: "/vless",
    sni: host,
    tls: tls,
  };
  const subUrl = `${url.origin}/sub`;

  // --- Route 1: Root (/) ---
  if (url.pathname === "/") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET", ...corsHeaders },
      });
    }

    const accept = request.headers.get("Accept") || "";
    const format = url.searchParams.get("format")?.toLowerCase();

    // If browser request or explicitly requesting html, serve Web Dashboard
    if (format === "html" || (accept.includes("text/html") && format !== "json")) {
      return new Response(renderDashboardHtml(nodeConfig, subUrl), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...corsHeaders,
        },
      });
    }

    // Default API response (maintains Phase 1 backward compatibility)
    return new Response(
      JSON.stringify({
        name: "cloudflare-proxy-lab",
        status: "ok",
        version: "0.2.0",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
        },
      }
    );
  }

  // --- Route 2: Subscription (/sub) ---
  if (url.pathname === "/sub") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET", ...corsHeaders },
      });
    }

    const format = url.searchParams.get("format")?.toLowerCase();
    const ua = request.headers.get("User-Agent")?.toLowerCase() || "";
    const accept = request.headers.get("Accept") || "";

    // 1. If explicit html requested or standard browser visit without format
    if (format === "html" || (!format && accept.includes("text/html") && !ua.includes("clash"))) {
      return new Response(renderDashboardHtml(nodeConfig, subUrl), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...corsHeaders,
        },
      });
    }

    // 2. Clash Verge / Clash Meta (Mihomo) YAML format
    if (
      format === "clash" ||
      ua.includes("clash") ||
      ua.includes("meta") ||
      ua.includes("mihomo")
    ) {
      return new Response(generateClashYaml(nodeConfig), {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${nodeConfig.name}.yaml"`,
          "profile-update-interval": "24",
          ...corsHeaders,
        },
      });
    }

    // 3. sing-box JSON format
    if (format === "singbox" || ua.includes("sing-box")) {
      return new Response(generateSingboxJson(nodeConfig), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
        },
      });
    }

    // 4. Default: Base64 VLESS subscription (v2rayN, Shadowrocket, etc.)
    return new Response(generateBase64Subscription(nodeConfig), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "profile-update-interval": "24",
        ...corsHeaders,
      },
    });
  }

  // --- Route 3: Health Probe (/health) ---
  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET", ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({
        status: "ok",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
        },
      }
    );
  }

  // --- Route 4: Info Probe (/info) ---
  if (url.pathname === "/info") {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET", ...corsHeaders },
      });
    }

    // Strictly ensure no secrets (such as UUID) are leaked
    return new Response(
      JSON.stringify({
        name: "cloudflare-proxy-lab",
        status: "ok",
        version: "0.2.0",
        environment: config.environment,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
        },
      }
    );
  }

  return new Response("Not Found", {
    status: 404,
    headers: corsHeaders,
  });
}
