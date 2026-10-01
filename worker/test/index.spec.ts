import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";

describe("Worker Initialization Baseline", () => {
  it("should respond with 200 and ok status on basic fetch", async () => {
    const request = new Request("http://localhost/");
    const env: Env = { ENVIRONMENT: "test" };
    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);

    const body = await response.json() as { name: string; status: string; version: string };
    expect(body.name).toBe("cloudflare-proxy-lab");
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });
});
