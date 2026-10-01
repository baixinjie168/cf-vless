export interface VlessRequest {
  version: number;
  uuid: string;
  command: number;
  port: number;
  address: string;
  addressType: number;
  payload: Uint8Array;
}
