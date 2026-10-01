export interface OutboundConnection {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface OutboundConnector {
  connect(address: string, port: number): Promise<OutboundConnection>;
}
