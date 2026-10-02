import { connect as cfConnect } from "cloudflare:sockets";

export interface OutboundConnection {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface OutboundConnector {
  connect(address: string, port: number): Promise<OutboundConnection>;
}

/**
 * Direct TCP Outbound Connector (Production).
 * Leverages Cloudflare Workers native TCP Sockets API (cloudflare:sockets connect()).
 * Supports fallback to ProxyIP when Cloudflare anti-loopback or connection errors occur.
 */
export class DirectTcpConnector implements OutboundConnector {
  private proxyIp?: string;

  constructor(proxyIp?: string) {
    this.proxyIp = proxyIp || "proxyip.aliyun.fxxk.dedyn.io";
  }

  async connect(address: string, port: number): Promise<OutboundConnection> {
    try {
      // 1. Try direct connection first
      const socket = cfConnect({ hostname: address, port });
      await socket.opened;

      return {
        readable: socket.readable as ReadableStream<Uint8Array>,
        writable: socket.writable as WritableStream<Uint8Array>,
        close: async () => {
          try {
            await socket.close();
          } catch {
            // Already closed or half closed
          }
        },
      };
    } catch (directErr) {
      // 2. If direct connection fails (e.g. Cloudflare anti-loopback on cp.cloudflare.com)
      // and proxyIp is available, fallback to proxyIp
      if (this.proxyIp && this.proxyIp !== address) {
        try {
          const fallbackSocket = cfConnect({ hostname: this.proxyIp, port });
          await fallbackSocket.opened;

          return {
            readable: fallbackSocket.readable as ReadableStream<Uint8Array>,
            writable: fallbackSocket.writable as WritableStream<Uint8Array>,
            close: async () => {
              try {
                await fallbackSocket.close();
              } catch {}
            },
          };
        } catch (fallbackErr) {
          throw new Error(
            `Connection to ${address}:${port} failed (direct: ${
              directErr instanceof Error ? directErr.message : String(directErr)
            }, proxyIp ${this.proxyIp}: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            })`
          );
        }
      }

      throw new Error(
        `Direct TCP connection to ${address}:${port} failed: ${
          directErr instanceof Error ? directErr.message : String(directErr)
        }`
      );
    }
  }
}

/**
 * In-memory Mock Outbound Connection.
 * Provides virtual streams for testing without public network side effects.
 */
export class MockConnection implements OutboundConnection {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  isClosed = false;
  writtenChunks: Uint8Array[] = [];

  constructor(options?: {
    customResponse?: Uint8Array;
    echo?: boolean;
    onWrite?: (chunk: Uint8Array) => void;
  }) {
    const echo = options?.echo ?? true;
    const customResponse = options?.customResponse;

    let readableController: ReadableStreamDefaultController<Uint8Array>;

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        readableController = controller;
        if (customResponse && customResponse.length > 0) {
          controller.enqueue(customResponse);
        }
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.writtenChunks.push(chunk);
        if (options?.onWrite) {
          options.onWrite(chunk);
        }
        if (echo) {
          try {
            readableController.enqueue(chunk);
          } catch {
            // Controller might be closed
          }
        }
      },
      close: () => {
        this.isClosed = true;
        try {
          readableController.close();
        } catch {
          // Already closed
        }
      },
    });
  }

  async close(): Promise<void> {
    this.isClosed = true;
  }
}

/**
 * Mock Outbound Connector (Testing & Offline Simulation).
 */
export class MockConnector implements OutboundConnector {
  lastAddress?: string;
  lastPort?: number;
  shouldFail = false;
  failureError = "Mock connection refused";
  lastConnection?: MockConnection;
  customResponse?: Uint8Array;
  echo = true;

  async connect(address: string, port: number): Promise<OutboundConnection> {
    this.lastAddress = address;
    this.lastPort = port;

    if (this.shouldFail) {
      throw new Error(
        `Mock connection to ${address}:${port} failed: ${this.failureError}`
      );
    }

    const conn = new MockConnection({
      echo: this.echo,
      customResponse: this.customResponse,
    });
    this.lastConnection = conn;
    return conn;
  }
}
