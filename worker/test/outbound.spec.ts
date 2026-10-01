import { describe, it, expect } from "vitest";
import {
  MockConnector,
  MockConnection,
  DirectTcpConnector,
  OutboundConnector,
} from "../src/outbound/connector";

describe("Outbound Connector Layer (Step 9)", () => {
  describe("MockConnector & MockConnection", () => {
    it("should record target host and port upon connect", async () => {
      const connector = new MockConnector();
      const conn = await connector.connect("1.1.1.1", 443);

      expect(connector.lastAddress).toBe("1.1.1.1");
      expect(connector.lastPort).toBe(443);
      expect(conn.readable).toBeDefined();
      expect(conn.writable).toBeDefined();
    });

    it("should echo data written to writable stream back to readable stream", async () => {
      const connector = new MockConnector();
      const conn = await connector.connect("echo.example.com", 80);

      const writer = conn.writable.getWriter();
      const reader = conn.readable.getReader();

      const testPayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const writePromise = writer.write(testPayload);
      const readPromise = reader.read();

      await writePromise;
      const { value, done } = await readPromise;

      expect(done).toBe(false);
      expect(Array.from(value!)).toEqual([0xde, 0xad, 0xbe, 0xef]);

      await writer.close();
      await conn.close();
    });

    it("should support simulated connection failures", async () => {
      const connector = new MockConnector();
      connector.shouldFail = true;
      connector.failureError = "Connection timed out";

      await expect(connector.connect("blocked.host", 25)).rejects.toThrow(
        /Mock connection to blocked.host:25 failed: Connection timed out/
      );
    });

    it("should support pre-loaded custom response in MockConnection", async () => {
      const connector = new MockConnector();
      connector.customResponse = new Uint8Array([0x00, 0x01, 0x02]);

      const conn = await connector.connect("backend.internal", 8080);
      const reader = conn.readable.getReader();

      const { value } = await reader.read();
      expect(Array.from(value!)).toEqual([0x00, 0x01, 0x02]);

      await reader.cancel();
      await conn.close();
    });

    it("should record all chunks written through writable stream", async () => {
      const connector = new MockConnector();
      const conn = (await connector.connect("target.host", 9000)) as MockConnection;

      const writer = conn.writable.getWriter();
      await writer.write(new Uint8Array([1, 2]));
      await writer.write(new Uint8Array([3, 4]));

      expect(conn.writtenChunks.length).toBe(2);
      expect(Array.from(conn.writtenChunks[0])).toEqual([1, 2]);
      expect(Array.from(conn.writtenChunks[1])).toEqual([3, 4]);

      await writer.close();
    });
  });

  describe("DirectTcpConnector Interface Contract", () => {
    it("should satisfy the OutboundConnector interface contract", () => {
      const connector: OutboundConnector = new DirectTcpConnector();
      expect(typeof connector.connect).toBe("function");
    });
  });
});
