import { VlessNodeConfig } from "./types";
import { generateVlessUri, generateClashYaml } from "./generator";

/**
 * Renders an all-in-one Web Subscription & Management Dashboard HTML page.
 */
export function renderDashboardHtml(
  config: VlessNodeConfig,
  subUrl: string
): string {
  const vlessUri = generateVlessUri(config);
  const clashYaml = generateClashYaml(config);
  const clashImportUrl = `clash://install-config?url=${encodeURIComponent(subUrl)}&name=${encodeURIComponent(config.name)}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name} · VLESS 边缘节点订阅管理</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-inner: #1f2937;
      --border: #374151;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --purple: #8b5cf6;
      --purple-hover: #7c3aed;
      --emerald: #10b981;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px 16px;
      line-height: 1.5;
      min-height: 100vh;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .title-group h1 {
      font-size: 1.5rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #fff;
    }
    .subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      font-family: var(--font-mono);
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
      box-shadow: 0 0 8px #34d399;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .card-title {
      font-size: 1.05rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--primary);
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.875rem;
      padding: 10px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-purple { background: var(--purple); }
    .btn-purple:hover { background: var(--purple-hover); }
    .btn-secondary {
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-secondary:hover { background: #2d3748; }
    
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--text-muted);
      font-weight: 600;
      width: 35%;
    }
    td {
      font-family: var(--font-mono);
      color: #e5e7eb;
      word-break: break-all;
    }
    .code-box {
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      color: #c9d1d9;
      max-height: 220px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .qr-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: white;
      border-radius: 12px;
      width: fit-content;
      margin: 0 auto;
    }
    #qrcode {
      width: 180px;
      height: 180px;
    }
    .qr-hint {
      margin-top: 8px;
      font-size: 0.75rem;
      color: #4b5563;
      font-weight: 600;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10b981;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
      z-index: 999;
    }
    .toast.show { opacity: 1; }
    .tips-box {
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.25);
      border-radius: 8px;
      padding: 14px;
      font-size: 0.8125rem;
      color: #93c5fd;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="title-group">
        <h1>⚡ ${config.name} · VLESS 边缘节点面板</h1>
        <p class="subtitle">Cloudflare Workers 原生边缘网络加速 · WSS 全双工长连接</p>
      </div>
      <div>
        <span class="badge">
          <span class="status-dot"></span>
          <span>节点状态: 正常运行中</span>
        </span>
      </div>
    </header>

    <!-- Quick Import Card -->
    <div class="card">
      <div class="card-title">
        <span>🚀</span>
        <span>一键导入与订阅提取</span>
      </div>
      <p style="font-size: 0.875rem; color: var(--text-muted);">
        支持 Clash Verge、Clash Meta、v2rayN、Shadowrocket 等主流客户端一键唤起与配置更新：
      </p>
      <div class="btn-row">
        <a href="${clashImportUrl}" class="btn btn-purple">
          <span>⚡ 一键导入 Clash Verge</span>
        </a>
        <button id="btnCopyClashSub" class="btn btn-secondary" type="button">
          <span>📋 复制 Clash 订阅链接</span>
        </button>
        <button id="btnCopyVlessUri" class="btn btn-secondary" type="button">
          <span>📋 复制 vless:// 节点链接</span>
        </button>
        <button id="btnCopyBase64Sub" class="btn btn-secondary" type="button">
          <span>📋 复制 Base64 通用订阅</span>
        </button>
      </div>
    </div>

    <!-- Node Params & QR Code Grid -->
    <div class="grid-2">
      <!-- Node Params -->
      <div class="card">
        <div class="card-title">
          <span>⚙️</span>
          <span>节点核心配置参数</span>
        </div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><th>节点名称</th><td>${config.name}</td></tr>
              <tr><th>协议类型</th><td>VLESS</td></tr>
              <tr><th>地址 (Server)</th><td>${config.host}</td></tr>
              <tr><th>端口 (Port)</th><td>${config.port} (TLS)</td></tr>
              <tr><th>用户 ID (UUID)</th><td>${config.uuid}</td></tr>
              <tr><th>传输协议</th><td>ws (WebSocket)</td></tr>
              <tr><th>伪装路径 (Path)</th><td>${config.path}</td></tr>
              <tr><th>TLS / SNI</th><td>${config.sni}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Mobile QR Code -->
      <div class="card" style="text-align: center;">
        <div class="card-title" style="justify-content: center;">
          <span>📱</span>
          <span>手机客户端扫码导入</span>
        </div>
        <div class="qr-container">
          <canvas id="qrcode"></canvas>
          <span class="qr-hint">支持 Shadowrocket / sing-box / v2rayN 扫码</span>
        </div>
      </div>
    </div>

    <!-- Clash Configuration Preview -->
    <div class="card">
      <div class="card-title" style="justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>📄</span>
          <span>Clash Verge 配置文件预览 (YAML)</span>
        </div>
        <button id="btnCopyYaml" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" type="button">复制 YAML</button>
      </div>
      <div id="yamlBox" class="code-box">${clashYaml}</div>
    </div>

    <!-- Clean IP Tips -->
    <div class="card">
      <div class="card-title">
        <span>💡</span>
        <span>进阶玩法：优选 IP / Clean IP 优化指引</span>
      </div>
      <div class="tips-box">
        1. <strong>国内直连优化</strong>：在客户端（如 Clash Verge 或 Shadowrocket）中，可将节点的 <code>server</code>（服务器地址）替换为您本地运营商测速最优的 Cloudflare Anycast IP（如 <code>104.16.x.x</code>、<code>1.1.1.1</code> 等）。<br>
        2. <strong>重要保持</strong>：请务必保持 <code>Host</code> 与 <code>SNI</code> 依然为您当前的 Worker 域名 <code>${config.host}</code>，即可获得极致的低延迟体验！
      </div>
    </div>
  </div>

  <div id="toast" class="toast">已复制到剪贴板！</div>

  <!-- Lightweight inline QR code renderer -->
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <script>
    const subUrl = "${subUrl}";
    const vlessUri = "${vlessUri}";
    const yamlContent = document.getElementById("yamlBox").innerText;

    // Toast helper
    const toast = document.getElementById("toast");
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2000);
    }

    async function copyText(text, label) {
      try {
        await navigator.clipboard.writeText(text);
        showToast("已成功复制 " + label);
      } catch (e) {
        prompt("请手动复制:", text);
      }
    }

    document.getElementById("btnCopyClashSub")?.addEventListener("click", () => copyText(subUrl, "Clash 订阅链接"));
    document.getElementById("btnCopyVlessUri")?.addEventListener("click", () => copyText(vlessUri, "vless:// 节点链接"));
    document.getElementById("btnCopyBase64Sub")?.addEventListener("click", () => copyText(subUrl + "?format=base64", "Base64 订阅链接"));
    document.getElementById("btnCopyYaml")?.addEventListener("click", () => copyText(yamlContent, "Clash YAML 配置"));

    // Render QR Code
    window.addEventListener("DOMContentLoaded", () => {
      const canvas = document.getElementById("qrcode");
      if (typeof QRCode !== "undefined" && canvas) {
        QRCode.toCanvas(canvas, vlessUri, { width: 180, margin: 1 }, function (error) {
          if (error) console.error("QR Code Error: ", error);
        });
      }
    });
  </script>
</body>
</html>
`;
}
