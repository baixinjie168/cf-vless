import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    alias: {
      "cloudflare:sockets": path.resolve(__dirname, "./src/outbound/stub.ts"),
    },
  },
});
