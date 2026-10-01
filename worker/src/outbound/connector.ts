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
 */
export class DirectTcpConnector implements OutboundConnector {
  async connect(address: string, port: number): Promise<OutboundConnection> {
    try {
      const socket = cfConnect({ hostname: address, port });
      // Await socket.opened to detect connection errors early
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
    } catch (err) {
      throw new Error(
        `Direct TCP connection to ${address}:${port} failed: ${
          err instanceof Error ? err.message : String(err)
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
