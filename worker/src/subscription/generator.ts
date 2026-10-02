import { VlessNodeConfig } from "./types";

export interface CleanTarget {
  name: string;
  server: string;
}

/**
 * Curated high-availability Cloudflare Anycast clean targets for domestic connectivity.
 */
export const DEFAULT_CLEAN_TARGETS: CleanTarget[] = [
  { name: "香港优选-HK", server: "icook.hk" },
  { name: "亚太官方-CF", server: "cf.090227.xyz" },
  { name: "授时优选-TIME", server: "time.is" },
  { name: "官方优选-IP1", server: "104.16.88.88" },
  { name: "官方优选-IP2", server: "104.18.88.88" },
  { name: "官方优选-IP3", server: "162.159.192.1" },
];

/**
 * Expands a single base node config into a multi-path Clean IP Node Matrix.
 */
export function getAllNodeConfigs(
  baseConfig: VlessNodeConfig,
  cleanTargets: CleanTarget[] = DEFAULT_CLEAN_TARGETS
): VlessNodeConfig[] {
  const list: VlessNodeConfig[] = [
    {
      ...baseConfig,
      name: `【直连】${baseConfig.name}`,
    },
  ];

  for (const t of cleanTargets) {
    list.push({
      ...baseConfig,
      name: `【优选】${t.name}`,
      host: t.server, // Physical connect server target (Clean IP/domain)
      sni: baseConfig.sni, // SNI strictly locked to Worker domain
    });
  }

  return list;
}

/**
 * Generates standard vless:// URI compatible with modern proxy clients.
 */
export function generateVlessUri(config: VlessNodeConfig): string {
  const encPath = encodeURIComponent(config.path);
  const encName = encodeURIComponent(config.name);
  const security = config.tls ? "tls" : "none";

  return `vless://${config.uuid}@${config.host}:${config.port}?encryption=none&security=${security}&sni=${config.sni}&fp=chrome&type=ws&host=${config.sni}&path=${encPath}#${encName}`;
}

/**
 * Generates Base64 subscription string containing one or more VLESS URIs.
 */
export function generateBase64Subscription(
  configs: VlessNodeConfig | VlessNodeConfig[],
  cleanTargets: CleanTarget[] = DEFAULT_CLEAN_TARGETS
): string {
  const list = Array.isArray(configs)
    ? configs
    : getAllNodeConfigs(configs, cleanTargets);

  const text = list.map((c) => generateVlessUri(c)).join("\n");

  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generates complete Clash Verge / Clash Meta (Mihomo) compatible YAML configuration
 * with auto-injected Clean IP node matrix and automatic latency optimization group.
 */
export function generateClashYaml(
  config: VlessNodeConfig,
  cleanTargets: CleanTarget[] = DEFAULT_CLEAN_TARGETS
): string {
  const allNodes = getAllNodeConfigs(config, cleanTargets);

  const proxiesYaml = allNodes
    .map(
      (n) => `  - name: "${n.name}"
    type: vless
    server: ${n.host}
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
        Host: ${config.sni}`
    )
    .join("\n\n");

  const proxyNames = allNodes.map((n) => `      - "${n.name}"`).join("\n");

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
      - "AUTO-自动优选"
      - "FALLBACK-故障转移"
${proxyNames}
      - DIRECT

  - name: "AUTO-自动优选"
    type: url-test
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
${proxyNames}

  - name: "FALLBACK-故障转移"
    type: fallback
    url: "http://www.gstatic.com/generate_204"
    interval: 300
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
  const allNodes = getAllNodeConfigs(config);

  const outbounds = allNodes.map((n) => ({
    type: "vless",
    tag: n.name,
    server: n.host,
    server_port: n.port,
    uuid: config.uuid,
    transport: {
      type: "ws",
      path: config.path,
      headers: {
        Host: config.sni,
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
  }));

  return JSON.stringify({ outbounds }, null, 2);
}
