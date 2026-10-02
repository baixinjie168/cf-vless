import { VlessNodeConfig } from "./types";

/**
 * Generates standard vless:// URI compatible with modern proxy clients.
 */
export function generateVlessUri(config: VlessNodeConfig): string {
  const encPath = encodeURIComponent(config.path);
  const encName = encodeURIComponent(config.name);
  const security = config.tls ? "tls" : "none";

  return `vless://${config.uuid}@${config.host}:${config.port}?encryption=none&security=${security}&sni=${config.sni}&fp=chrome&type=ws&host=${config.host}&path=${encPath}#${encName}`;
}

/**
 * Generates Base64 subscription string containing one or more VLESS URIs.
 */
export function generateBase64Subscription(
  configs: VlessNodeConfig | VlessNodeConfig[]
): string {
  const list = Array.isArray(configs) ? configs : [configs];
  const text = list.map((c) => generateVlessUri(c)).join("\n");

  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generates complete Clash Verge / Clash Meta (Mihomo) compatible YAML configuration.
 */
export function generateClashYaml(
  config: VlessNodeConfig,
  cleanIps?: string[]
): string {
  const nodes: { name: string; server: string; port: number }[] = [
    {
      name: config.name,
      server: config.host,
      port: config.port,
    },
  ];

  if (cleanIps && cleanIps.length > 0) {
    cleanIps.forEach((ip, idx) => {
      nodes.push({
        name: `${config.name}-优选IP-${idx + 1}`,
        server: ip,
        port: config.port,
      });
    });
  }

  const proxiesYaml = nodes
    .map(
      (n) => `  - name: "${n.name}"
    type: vless
    server: ${n.server}
    port: ${n.port}
    uuid: ${config.uuid}
    network: ws
    tls: ${config.tls}
    udp: false
    sni: ${config.sni}
    client-fingerprint: chrome
    ws-opts:
      path: ${config.path}
      headers:
        Host: ${config.host}`
    )
    .join("\n\n");

  const proxyNames = nodes.map((n) => `      - "${n.name}"`).join("\n");

  return `port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info
unified-delay: true

proxies:
${proxiesYaml}

proxy-groups:
  - name: "PROXIES"
    type: select
    proxies:
${proxyNames}
      - "AUTO"
      - DIRECT

  - name: "AUTO"
    type: url-test
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
${proxyNames}

rules:
  - DOMAIN-SUFFIX,local,DIRECT
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,172.16.0.0/12,DIRECT
  - IP-CIDR,192.168.0.0/16,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT
  - IP-CIDR,100.64.0.0/10,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,PROXIES
`;
}

/**
 * Generates sing-box JSON configuration format.
 */
export function generateSingboxJson(config: VlessNodeConfig): string {
  const obj = {
    outbounds: [
      {
        type: "vless",
        tag: config.name,
        server: config.host,
        server_port: config.port,
        uuid: config.uuid,
        transport: {
          type: "ws",
          path: config.path,
          headers: {
            Host: config.host,
          },
        },
        tls: {
          enabled: config.tls,
          server_name: config.sni,
          utls: {
            enabled: true,
            fingerprint: "chrome",
          },
        },
      },
    ],
  };

  return JSON.stringify(obj, null, 2);
}
