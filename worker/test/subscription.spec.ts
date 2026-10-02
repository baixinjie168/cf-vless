import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";
import { handleHttp } from "../src/http/handler";
import {
  generateVlessUri,
  generateClashYaml,
  generateBase64Subscription,
  generateSingboxJson,
} from "../src/subscription/generator";
import { VlessNodeConfig } from "../src/subscription/types";

describe("Phase 2: Subscription & Web Dashboard", () => {
  const dummyCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  const sampleConfig: VlessNodeConfig = {
    name: "test-node",
    host: "proxy.example.com",
    port: 443,
    uuid: "d34db33f-9999-4444-8888-123456789abc",
    path: "/vless",
    sni: "proxy.example.com",
    tls: true,
  };

  describe("Subscription Generators", () => {
    it("should generate a valid vless:// URI", () => {
      const uri = generateVlessUri(sampleConfig);
      expect(uri).toContain("vless://d34db33f-9999-4444-8888-123456789abc@proxy.example.com:443");
      expect(uri).toContain("type=ws");
      expect(uri).toContain("security=tls");
      expect(uri).toContain("path=%2Fvless");
      expect(uri).toContain("#test-node");
    });

    it("should generate valid Clash YAML configuration with proxies and groups", () => {
      const yaml = generateClashYaml(sampleConfig);
      expect(yaml).toContain("port: 7890");
      expect(yaml).toContain("type: vless");
      expect(yaml).toContain("server: proxy.example.com");
      expect(yaml).toContain("uuid: d34db33f-9999-4444-8888-123456789abc");
      expect(yaml).toContain("path: /vless");
      expect(yaml).toContain("proxy-groups:");
      expect(yaml).toContain("AUTO-自动优选");
      expect(yaml).toContain("FALLBACK-故障转移");
      expect(yaml).toContain("http://www.gstatic.com/generate_204");
      expect(yaml).toContain("rules:");
    });

    it("should generate Base64 subscription containing the clean IP node matrix", () => {
      const b64 = generateBase64Subscription(sampleConfig);
      const decoded = atob(b64);
      expect(decoded).toContain("vless://d34db33f-9999-4444-8888-123456789abc@proxy.example.com:443");
      expect(decoded).toContain("icook.hk");
      expect(decoded).toContain("104.16.88.88");
      const lines = decoded.trim().split("\n");
      expect(lines.length).toBe(7);
    });

    it("should generate valid sing-box JSON configuration", () => {
      const jsonStr = generateSingboxJson(sampleConfig);
      const parsed = JSON.parse(jsonStr) as { outbounds: Array<{ type: string; uuid: string }> };
      expect(parsed.outbounds[0].type).toBe("vless");
      expect(parsed.outbounds[0].uuid).toBe(sampleConfig.uuid);
    });
  });

  describe("HTTP Routes Integration", () => {
    const env: Env = {
      ENVIRONMENT: "production",
      VLESS_UUID: "d34db33f-9999-4444-8888-123456789abc",
    };

    it("GET / with Accept: text/html should return the Web Dashboard HTML", async () => {
      const req = new Request("https://open-window.example.com/", {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const res = await worker.fetch(req, env, dummyCtx);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("VLESS 边缘节点面板");
      expect(html).toContain("d34db33f-9999-4444-8888-123456789abc");
      expect(html).toContain("clash://install-config");
    });

    it("GET / with Accept: application/json should return JSON status metadata (Phase 1 compatibility)", async () => {
      const req = new Request("https://open-window.example.com/", {
        headers: { Accept: "application/json" },
      });
      const res = await worker.fetch(req, env, dummyCtx);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      const json = await res.json() as { name: string; status: string };
      expect(json.name).toBe("cloudflare-proxy-lab");
      expect(json.status).toBe("ok");
    });

    it("GET /sub with Clash User-Agent should return Clash YAML", async () => {
      const req = new Request("https://open-window.example.com/sub", {
        headers: { "User-Agent": "ClashVerge/1.6.6" },
      });
      const res = await worker.fetch(req, env, dummyCtx);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/yaml");
      expect(res.headers.get("Content-Disposition")).toContain(".yaml");
      const text = await res.text();
      expect(text).toContain("proxies:");
      expect(text).toContain("type: vless");
    });

    it("GET /sub?format=clash should return Clash YAML regardless of User-Agent", async () => {
      const req = new Request("https://open-window.example.com/sub?format=clash");
      const res = await worker.fetch(req, env, dummyCtx);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/yaml");
      const text = await res.text();
      expect(text).toContain("proxies:");
    });

    it("GET /sub without special headers should return Base64 subscription", async () => {
      const req = new Request("https://open-window.example.com/sub");
      const res = await worker.fetch(req, env, dummyCtx);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      const b64 = await res.text();
      const decoded = atob(b64);
      expect(decoded).toContain("vless://");
    });

    it("GET /sub?format=html should return Web Dashboard", async () => {
      const req = new Request("https://open-window.example.com/sub?format=html");
      const res = await worker.fetch(req, env, dummyCtx);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("一键导入与订阅提取");
    });
  });
});
