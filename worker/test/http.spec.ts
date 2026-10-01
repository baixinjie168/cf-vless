import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";
import { handleHttp } from "../src/http/handler";

describe("HTTP Diagnostic Routes (Step 2)", () => {
  const dummyCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  describe("GET /", () => {
    it("should return 200 with lab status metadata and JSON content-type", async () => {
      const request = new Request("http://localhost/");
      const response = await handleHttp(request, {});

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");

      const data = await response.json() as { name: string; status: string; version: string };
      expect(data).toEqual({
        name: "cloudflare-proxy-lab",
        status: "ok",
        version: "0.1.0",
      });
    });

    it("should return 405 Method Not Allowed on non-GET requests", async () => {
      const request = new Request("http://localhost/", { method: "POST" });
      const response = await handleHttp(request, {});

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
    });
  });

  describe("GET /health", () => {
    it("should return 200 with { status: 'ok' }", async () => {
      const request = new Request("http://localhost/health");
      const response = await handleHttp(request, {});

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");

      const data = await response.json() as { status: string };
      expect(data).toEqual({ status: "ok" });
    });

    it("should return 405 on POST /health", async () => {
      const request = new Request("http://localhost/health", { method: "POST" });
      const response = await handleHttp(request, {});

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
    });
  });

  describe("GET /info", () => {
    it("should return 200 with runtime environment info", async () => {
      const request = new Request("http://localhost/info");
      const env = { ENVIRONMENT: "staging" };
      const response = await handleHttp(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");

      const data = await response.json() as Record<string, unknown>;
      expect(data.name).toBe("cloudflare-proxy-lab");
      expect(data.status).toBe("ok");
      expect(data.version).toBe("0.1.0");
      expect(data.environment).toBe("staging");
    });

    it("should default to development environment if not set", async () => {
      const request = new Request("http://localhost/info");
      const response = await handleHttp(request, {});

      expect(response.status).toBe(200);
      const data = await response.json() as { environment: string };
      expect(data.environment).toBe("development");
    });

    it("SECURITY: must never leak VLESS_UUID or any secret in response body", async () => {
      const secretUuid = "d34db33f-9999-4444-8888-123456789abc";
      const request = new Request("http://localhost/info");
      const env = {
        ENVIRONMENT: "production",
        VLESS_UUID: secretUuid,
      };

      const response = await handleHttp(request, env);
      expect(response.status).toBe(200);

      const rawText = await response.text();
      // Ensure the raw text does not contain the secret string anywhere
      expect(rawText).not.toContain(secretUuid);

      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      expect(parsed.uuid).toBeUndefined();
      expect(parsed.VLESS_UUID).toBeUndefined();
      expect(parsed.environment).toBe("production");
    });

    it("should return 405 on POST /info", async () => {
      const request = new Request("http://localhost/info", { method: "POST" });
      const response = await handleHttp(request, {});

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
    });
  });

  describe("CORS Support for Diagnostic Console", () => {
    it("should respond to OPTIONS preflight with 204 and CORS headers", async () => {
      const request = new Request("http://localhost/health", { method: "OPTIONS" });
      const response = await handleHttp(request, {});

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    });

    it("should include Access-Control-Allow-Origin header on GET responses", async () => {
      const request = new Request("http://localhost/health");
      const response = await handleHttp(request, {});

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("Unknown routes (404)", () => {
    it("should return 404 on non-existent path", async () => {
      const request = new Request("http://localhost/random-non-existent-path");
      const response = await handleHttp(request, {});

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    });
  });

  describe("Worker fetch integration dispatch", () => {
    it("should route standard HTTP GET requests to handleHttp via worker.fetch", async () => {
      const request = new Request("http://localhost/health");
      const env: Env = { ENVIRONMENT: "test" };

      const response = await worker.fetch(request, env, dummyCtx);
      expect(response.status).toBe(200);

      const data = await response.json() as { status: string };
      expect(data.status).toBe("ok");
    });

    it("should route /info through worker.fetch without leaking VLESS_UUID", async () => {
      const secretUuid = "test-secret-uuid-12345";
      const request = new Request("http://localhost/info");
      const env: Env = { ENVIRONMENT: "test", VLESS_UUID: secretUuid };

      const response = await worker.fetch(request, env, dummyCtx);
      expect(response.status).toBe(200);

      const raw = await response.text();
      expect(raw).not.toContain(secretUuid);
    });
  });
});
