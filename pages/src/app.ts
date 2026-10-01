/**
 * Cloudflare Proxy Lab - Experimental Test Console Client
 * Runs in browser / Cloudflare Pages environment
 */

// --- Logging Utility ---
type LogTag = "INFO" | "SUCCESS" | "WARN" | "ERROR" | "WS-TX" | "WS-RX";

const terminalBody = document.getElementById("terminalBody") as HTMLDivElement;

function addLog(tag: LogTag, msg: string): void {
  const line = document.createElement("div");
  line.className = "log-line";

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;

  const timeSpan = document.createElement("span");
  timeSpan.className = "log-time";
  timeSpan.textContent = timeStr;

  const tagSpan = document.createElement("span");
  tagSpan.className = `log-tag ${tag}`;
  tagSpan.textContent = tag;

  const msgSpan = document.createElement("span");
  msgSpan.className = "log-msg";
  msgSpan.textContent = msg;

  line.appendChild(timeSpan);
  line.appendChild(tagSpan);
  line.appendChild(msgSpan);

  terminalBody.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// --- Clipboard & Log Actions ---
document.getElementById("btnClearLogs")?.addEventListener("click", () => {
  terminalBody.innerHTML = "";
  addLog("INFO", "控制台日志已清空");
});

document.getElementById("btnCopyLogs")?.addEventListener("click", async () => {
  const text = Array.from(terminalBody.querySelectorAll(".log-line"))
    .map((l) => (l as HTMLElement).innerText)
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    addLog("SUCCESS", "已复制控制台全部日志到剪贴板");
  } catch (err) {
    addLog("WARN", `复制失败: ${String(err)}`);
  }
});

// --- URL & Endpoint Helpers ---
const workerUrlInput = document.getElementById("workerUrlInput") as HTMLInputElement;

function getWorkerBaseUrl(): string {
  let val = workerUrlInput.value.trim();
  if (!val) {
    val = "http://localhost:8787";
    workerUrlInput.value = val;
  }
  return val.replace(/\/+$/, "");
}

function getWebSocketUrl(path: string): string {
  const base = getWorkerBaseUrl();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (base.startsWith("https://")) {
    return `wss://${base.slice(8)}${cleanPath}`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice(7)}${cleanPath}`;
  }
  if (base.startsWith("wss://") || base.startsWith("ws://")) {
    return `${base}${cleanPath}`;
  }
  return `ws://${base}${cleanPath}`;
}

document.getElementById("btnSetLocalhost")?.addEventListener("click", () => {
  workerUrlInput.value = "http://localhost:8787";
  addLog("INFO", "Worker 地址已重置为: http://localhost:8787");
});

// --- Ping & Diagnostic Probing ---
const pingBadge = document.getElementById("pingBadge") as HTMLSpanElement;
const pingText = document.getElementById("pingText") as HTMLSpanElement;

async function pingWorker(): Promise<number | null> {
  const url = `${getWorkerBaseUrl()}/health`;
  pingBadge.className = "status-badge connecting";
  pingText.textContent = "探测中...";

  const start = performance.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const rtt = Math.round(performance.now() - start);
    if (res.ok) {
      pingBadge.className = "status-badge online";
      pingText.textContent = `在线 (${rtt}ms)`;
      addLog("SUCCESS", `Worker 健康检查就绪: ${url} 状态码=${res.status}, 往返耗时=${rtt}ms`);
      return rtt;
    } else {
      pingBadge.className = "status-badge error";
      pingText.textContent = `异常 (${res.status})`;
      addLog("WARN", `Worker 健康检查异常: ${url} 状态码=${res.status}`);
      return null;
    }
  } catch (err) {
    pingBadge.className = "status-badge error";
    pingText.textContent = "不可达";
    addLog("ERROR", `无法连接到 Worker (${url}): ${String(err)}`);
    return null;
  }
}

document.getElementById("btnPingWorker")?.addEventListener("click", pingWorker);

// --- HTTP Diagnostic Endpoints (Step 2) ---
const httpResponseBox = document.getElementById("httpResponseBox") as HTMLDivElement;

async function fetchHttpEndpoint(endpoint: string, label: string): Promise<void> {
  const targetUrl = `${getWorkerBaseUrl()}${endpoint}`;
  addLog("INFO", `发起 HTTP 请求: GET ${targetUrl}`);
  httpResponseBox.textContent = `请求发送中: GET ${targetUrl}...`;

  const start = performance.now();
  try {
    const res = await fetch(targetUrl, { method: "GET" });
    const rtt = Math.round(performance.now() - start);
    const text = await res.text();

    let formattedBody = text;
    try {
      const parsed = JSON.parse(text);
      formattedBody = JSON.stringify(parsed, null, 2);
    } catch {
      // not JSON, keep as text
    }

    httpResponseBox.textContent = `HTTP ${res.status} ${res.statusText} (${rtt}ms)\n\n${formattedBody}`;
    addLog("SUCCESS", `[${label}] HTTP ${res.status} (${rtt}ms)`);
  } catch (err) {
    httpResponseBox.textContent = `请求失败: ${String(err)}\n\n请确认 Worker 是否已启动 (wrangler dev) 以及目标地址是否正确。`;
    addLog("ERROR", `[${label}] 请求异常: ${String(err)}`);
  }
}

document.getElementById("btnTestRoot")?.addEventListener("click", () => fetchHttpEndpoint("/", "GET / (Root)"));
document.getElementById("btnTestHealth")?.addEventListener("click", () => fetchHttpEndpoint("/health", "GET /health"));
document.getElementById("btnTestInfo")?.addEventListener("click", () => fetchHttpEndpoint("/info", "GET /info"));

// --- WebSocket Echo Engine (Step 3 & 4) ---
let echoWs: WebSocket | null = null;
let textSendTime = 0;
let binarySendTime = 0;

const wsStatusBadge = document.getElementById("wsStatusBadge") as HTMLSpanElement;
const wsStatusText = document.getElementById("wsStatusText") as HTMLSpanElement;
const wsEchoBox = document.getElementById("wsEchoBox") as HTMLDivElement;

const btnWsConnect = document.getElementById("btnWsConnect") as HTMLButtonElement;
const btnWsDisconnect = document.getElementById("btnWsDisconnect") as HTMLButtonElement;
const btnWsSendText = document.getElementById("btnWsSendText") as HTMLButtonElement;
const btnWsSendBinary = document.getElementById("btnWsSendBinary") as HTMLButtonElement;
const wsTextInput = document.getElementById("wsTextInput") as HTMLInputElement;

function updateWsUiState(state: "disconnected" | "connecting" | "connected" | "error"): void {
  if (state === "connected") {
    wsStatusBadge.className = "status-badge online";
    wsStatusText.textContent = "已连接 (OPEN)";
    btnWsConnect.disabled = true;
    btnWsDisconnect.disabled = false;
    btnWsSendText.disabled = false;
    btnWsSendBinary.disabled = false;
  } else if (state === "connecting") {
    wsStatusBadge.className = "status-badge connecting";
    wsStatusText.textContent = "握手中...";
    btnWsConnect.disabled = true;
    btnWsDisconnect.disabled = false;
    btnWsSendText.disabled = true;
    btnWsSendBinary.disabled = true;
  } else if (state === "error") {
    wsStatusBadge.className = "status-badge error";
    wsStatusText.textContent = "连接错误";
    btnWsConnect.disabled = false;
    btnWsDisconnect.disabled = true;
    btnWsSendText.disabled = true;
    btnWsSendBinary.disabled = true;
  } else {
    wsStatusBadge.className = "status-badge";
    wsStatusText.textContent = "未连接";
    btnWsConnect.disabled = false;
    btnWsDisconnect.disabled = true;
    btnWsSendText.disabled = true;
    btnWsSendBinary.disabled = true;
  }
}

btnWsConnect.addEventListener("click", () => {
  const wsUrl = getWebSocketUrl("/ws");
  addLog("INFO", `正在建立 WebSocket 连接: ${wsUrl}`);
  updateWsUiState("connecting");

  try {
    echoWs = new WebSocket(wsUrl);
    echoWs.binaryType = "arraybuffer";

    echoWs.onopen = () => {
      updateWsUiState("connected");
      addLog("SUCCESS", `WebSocket 连接已打开 (${wsUrl})`);
      wsEchoBox.textContent = `WebSocket 连接成功！等待接收 Worker 欢迎报文及回显...`;
    };

    echoWs.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        const rtt = textSendTime > 0 ? ` (RTT: ${Math.round(performance.now() - textSendTime)}ms)` : "";
        textSendTime = 0;
        addLog("WS-RX", `收到文本消息: "${event.data}"${rtt}`);
        wsEchoBox.textContent = `[文本接收] ${event.data}${rtt}\n${wsEchoBox.textContent}`;
      } else if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        const rtt = binarySendTime > 0 ? ` (RTT: ${Math.round(performance.now() - binarySendTime)}ms)` : "";
        binarySendTime = 0;
        addLog("WS-RX", `收到二进制数据 [${bytes.length} bytes]: ${hex}${rtt}`);
        wsEchoBox.textContent = `[二进制接收 ${bytes.length}B] ${hex}${rtt}\n${wsEchoBox.textContent}`;
      }
    };

    echoWs.onerror = (err) => {
      addLog("ERROR", `WebSocket 通信异常: ${JSON.stringify(err)}`);
      updateWsUiState("error");
    };

    echoWs.onclose = (event: CloseEvent) => {
      addLog("WARN", `WebSocket 连接已关闭: code=${event.code}, reason="${event.reason}"`);
      updateWsUiState("disconnected");
      echoWs = null;
    };
  } catch (err) {
    addLog("ERROR", `创建 WebSocket 失败: ${String(err)}`);
    updateWsUiState("error");
  }
});

btnWsDisconnect.addEventListener("click", () => {
  if (echoWs) {
    addLog("INFO", "用户主动关闭 WebSocket 连接 (Code 1000)");
    echoWs.close(1000, "Client voluntary disconnect");
  }
});

btnWsSendText.addEventListener("click", () => {
  if (!echoWs || echoWs.readyState !== WebSocket.OPEN) {
    addLog("WARN", "WebSocket 未就绪，无法发送");
    return;
  }
  const msg = wsTextInput.value.trim();
  if (!msg) return;

  textSendTime = performance.now();
  echoWs.send(msg);
  addLog("WS-TX", `发送文本消息: "${msg}"`);
});

btnWsSendBinary.addEventListener("click", () => {
  if (!echoWs || echoWs.readyState !== WebSocket.OPEN) {
    addLog("WARN", "WebSocket 未就绪，无法发送");
    return;
  }
  // Construct 16 test bytes: [0xCA, 0xFE, 0xBA, 0xBE, ...]
  const testBytes = new Uint8Array(16);
  crypto.getRandomValues(testBytes);
  const hex = Array.from(testBytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");

  binarySendTime = performance.now();
  echoWs.send(testBytes.buffer);
  addLog("WS-TX", `发送二进制数据 [16 bytes]: ${hex}`);
});

// --- VLESS Protocol Binary Packer & Tester (Step 5 ~ 10) ---
const vlessUuidInput = document.getElementById("vlessUuidInput") as HTMLInputElement;
const vlessAddressInput = document.getElementById("vlessAddressInput") as HTMLInputElement;
const vlessPortInput = document.getElementById("vlessPortInput") as HTMLInputElement;
const vlessResultBox = document.getElementById("vlessResultBox") as HTMLDivElement;
const btnSendVlessHandshake = document.getElementById("btnSendVlessHandshake") as HTMLButtonElement;

// Presets
document.getElementById("btnPresetValidUuid")?.addEventListener("click", () => {
  vlessUuidInput.value = "d34db33f-9999-4444-8888-123456789abc";
  addLog("INFO", "已填入预设合法 UUID: d34db33f-9999-4444-8888-123456789abc");
});

document.getElementById("btnPresetInvalidUuid")?.addEventListener("click", () => {
  vlessUuidInput.value = "00000000-0000-0000-0000-000000000000";
  addLog("WARN", "已填入非法测试 UUID (预期将被 Worker 1008 阻断): 00000000-0000-0000-0000-000000000000");
});

document.getElementById("btnQuickPort80")?.addEventListener("click", () => {
  vlessPortInput.value = "80";
});

document.getElementById("btnQuickPort443")?.addEventListener("click", () => {
  vlessPortInput.value = "443";
});

document.getElementById("btnQuickPort25")?.addEventListener("click", () => {
  vlessPortInput.value = "25";
  addLog("WARN", "已切换至端口 25 (SMTP 阻断策略测试，预期返回 1008 Policy Violation)");
});

/**
 * Parses UUID string to 16-byte Uint8Array
 */
function parseUuidToBytes(uuidStr: string): Uint8Array {
  const clean = uuidStr.replace(/-/g, "").toLowerCase();
  if (clean.length !== 32 || !/^[0-9a-f]{32}$/.test(clean)) {
    throw new Error(`无效的 UUID 格式: "${uuidStr}" (必须为 32 位十六进制)`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Builds compliant VLESS request header packet
 */
function buildVlessRequestPacket(
  uuidBytes: Uint8Array,
  targetHost: string,
  targetPort: number
): Uint8Array {
  // Determine address type
  let addrType = 2; // Domain by default
  let addrBytes: Uint8Array;

  // Check if IPv4
  const ipv4Match = targetHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    addrType = 1;
    addrBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      addrBytes[i] = Number(ipv4Match[i + 1]);
    }
  } else {
    // Domain Name (length-prefixed)
    const encoder = new TextEncoder();
    const domainBytes = encoder.encode(targetHost);
    addrType = 2;
    addrBytes = new Uint8Array(1 + domainBytes.length);
    addrBytes[0] = domainBytes.length;
    addrBytes.set(domainBytes, 1);
  }

  // Header format:
  // Version (1) + UUID (16) + AddonsLen (1) + Command (1, TCP=1) + Port (2, BigEndian) + AddrType (1) + AddrBytes (N) + CRLF (2)
  const headerLen = 1 + 16 + 1 + 1 + 2 + 1 + addrBytes.length + 2;
  const packet = new Uint8Array(headerLen);

  let offset = 0;
  packet[offset++] = 0; // Version 0
  packet.set(uuidBytes, offset); // UUID 16 bytes
  offset += 16;
  packet[offset++] = 0; // Addons length 0
  packet[offset++] = 1; // Command: 1 (TCP)

  // Port Big-Endian
  packet[offset++] = (targetPort >> 8) & 0xff;
  packet[offset++] = targetPort & 0xff;

  // Address Type
  packet[offset++] = addrType;

  // Address data
  packet.set(addrBytes, offset);
  offset += addrBytes.length;

  // CRLF terminator
  packet[offset++] = 0x0d;
  packet[offset++] = 0x0a;

  return packet;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

btnSendVlessHandshake.addEventListener("click", () => {
  const uuidStr = vlessUuidInput.value.trim();
  const host = vlessAddressInput.value.trim();
  const port = parseInt(vlessPortInput.value, 10);

  if (!host || isNaN(port) || port <= 0 || port > 65535) {
    addLog("WARN", "请填写有效的目标地址与 1~65535 范围内的端口");
    return;
  }

  let uuidBytes: Uint8Array;
  try {
    uuidBytes = parseUuidToBytes(uuidStr);
  } catch (err) {
    addLog("ERROR", String(err));
    vlessResultBox.textContent = `UUID 解析错误: ${String(err)}`;
    return;
  }

  let packet: Uint8Array;
  try {
    packet = buildVlessRequestPacket(uuidBytes, host, port);
  } catch (err) {
    addLog("ERROR", `打包 VLESS 首部失败: ${String(err)}`);
    return;
  }

  const hexDump = bytesToHex(packet);
  const vlessWsUrl = getWebSocketUrl("/vless");

  addLog("INFO", `准备发送 VLESS 握手报文至: ${vlessWsUrl}`);
  addLog("WS-TX", `VLESS 二进制握手包 [${packet.length} bytes]: ${hexDump}`);

  vlessResultBox.textContent = `[发送 VLESS 握手首部]\n端点: ${vlessWsUrl}\n目标: ${host}:${port}\nUUID: ${uuidStr}\n字节数: ${packet.length} 字节\nHex: ${hexDump}\n\n正在建立 WebSocket 连接并发送握手...`;

  btnSendVlessHandshake.disabled = true;

  try {
    const ws = new WebSocket(vlessWsUrl);
    ws.binaryType = "arraybuffer";

    const startTime = performance.now();

    ws.onopen = () => {
      addLog("SUCCESS", `VLESS WebSocket 通道已建立，发送握手二进制包...`);
      ws.send(packet.buffer);
    };

    ws.onmessage = (evt: MessageEvent) => {
      const elapsed = Math.round(performance.now() - startTime);
      if (evt.data instanceof ArrayBuffer) {
        const respBytes = new Uint8Array(evt.data);
        const respHex = bytesToHex(respBytes);
        addLog("WS-RX", `收到 VLESS 服务端应答 [${respBytes.length} bytes]: ${respHex} (耗时: ${elapsed}ms)`);

        if (respBytes.length >= 2 && respBytes[0] === 0 && respBytes[1] === 0) {
          vlessResultBox.textContent = `✅ [VLESS 握手成功！]\n耗时: ${elapsed}ms\n服务端应答首部: [0x00, 0x00] (Version 0, Addons 0)\nHex: ${respHex}\n\n当前代理隧道已打通，数据转发管道处于激活状态。`;
          addLog("SUCCESS", "VLESS 握手验证通过！Worker 响应首部匹配协议预期 [0, 0]");
        } else {
          vlessResultBox.textContent = `⚠️ [收到未预期应答]\nHex: ${respHex}`;
        }
      } else {
        addLog("WARN", `收到非二进制消息: ${String(evt.data)}`);
      }
    };

    ws.onerror = (err) => {
      addLog("ERROR", `VLESS WebSocket 发生错误: ${JSON.stringify(err)}`);
    };

    ws.onclose = (evt: CloseEvent) => {
      const elapsed = Math.round(performance.now() - startTime);
      btnSendVlessHandshake.disabled = false;

      let explanation = "";
      if (evt.code === 1008) {
        explanation = "【1008 Policy Violation 策略阻断】\n原因：UUID 认证失败或目标端口被安全策略阻断（例如 SMTP 25 端口）。符合系统设计！";
      } else if (evt.code === 1002) {
        explanation = "【1002 Protocol Error 协议错误】\n原因：首部解析失败、不支持的指令或格式残缺。";
      } else if (evt.code === 1003) {
        explanation = "【1003 Unsupported Data 数据类型错误】\n原因：首帧并非合法的二进制数据。";
      } else if (evt.code === 1000) {
        explanation = "【1000 Normal Closure 正常关闭】";
      } else {
        explanation = `【关闭码 ${evt.code}】${evt.reason ? `原因: ${evt.reason}` : ""}`;
      }

      addLog("WARN", `VLESS 通道关闭: Code=${evt.code}, Reason="${evt.reason}" (耗时: ${elapsed}ms)`);
      vlessResultBox.textContent = `${vlessResultBox.textContent}\n\n[连接关闭]\n${explanation}\n耗时: ${elapsed}ms`;
    };
  } catch (err) {
    btnSendVlessHandshake.disabled = false;
    addLog("ERROR", `发起 VLESS 测试失败: ${String(err)}`);
    vlessResultBox.textContent = `发起测试异常: ${String(err)}`;
  }
});

// Initialization log
addLog("INFO", "Cloudflare Proxy Lab 实验控制台初始化完成");
addLog("INFO", "当前架构：Pages 独立诊断客户端 ⟷ Cloudflare Worker 网络引擎");
