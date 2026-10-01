export interface AppConfig {
  uuid?: string;
  environment: string;
}

export function getConfig(env: Record<string, unknown>): AppConfig {
  return {
    uuid: typeof env.VLESS_UUID === "string" ? env.VLESS_UUID : undefined,
    environment: typeof env.ENVIRONMENT === "string" ? env.ENVIRONMENT : "development",
  };
}
