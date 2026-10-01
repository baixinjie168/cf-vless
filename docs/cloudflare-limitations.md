# Cloudflare Workers 出站网络能力与平台限制实测记录 (Step 8)

本文档记录 Cloudflare Proxy Lab 针对 Cloudflare Workers 原生出站网络能力（`cloudflare:sockets`）的专项调研、实测表现与平台边界约束。

---

## 1. Cloudflare Workers 原生 TCP Sockets (`cloudflare:sockets`)

从 2023 年起，Cloudflare Workers 引入了原生 TCP Socket API，通过内置模块 `cloudflare:sockets` 提供标准流式能力：

```typescript
import { connect } from "cloudflare:sockets";

const socket = connect({
  hostname: "example.com",
  port: 443,
});

// 等待底层 TCP 三次握手完成
await socket.opened;

// 基于 Web Streams API 的全双工输入输出流
const readable: ReadableStream<Uint8Array> = socket.readable;
const writable: WritableStream<Uint8Array> = socket.writable;

// 主动断开
await socket.close();
```

### 核心运行时特征
- **原生边缘直连**：出站连接直接从就近的 Cloudflare Edge 数据中心向互联网目标 IP 发起 TCP SYN，无需前置代理中间人。
- **Web Streams 深度整合**：`socket.readable` 与 `socket.writable` 原生符合 WHATWG 标准流规范，可与 WebSocket 流进行零缓冲对敲（`pipeTo`）。

---

## 2. 目标端口限制与安全拦截策略

| 端口号 | 协议/用途 | 支持状态 | 行为特征与测试表现 |
| :--- | :--- | :---: | :--- |
| **80 / 443** | HTTP / HTTPS |  **完全支持** | 基础 Web 端口，支持最高优先级直连。 |
| **8080 / 8443** | 备用 HTTP 端口 |  **完全支持** | 常见代理与后端服务端口，无任何过滤。 |
| **22** | SSH 运维隧道 |  **完全支持** | 可正常进行 SSH 协议握手，保持全双工交互。 |
| **53** | DNS (TCP) |  **完全支持** | 支持通过 TCP 查询标准 DNS 服务器（如 1.1.1.1:53）。 |
| **25** | SMTP 邮件发送 | ❌ **永久封禁** | **平台硬性阻断**，无论免费计划还是 Enterprise 均禁止直连，防止垃圾邮件滥用。 |

---

## 3. Cloudflare 自身域名回环阻断机制 (Cross-Worker Self-Loop)

这是 Cloudflare 边缘代理场景下**最关键的平台限制**：

### 核心现象
- 当 Worker 尝试通过 `connect()` 连接的目标域名或目标 IP 同样托管在 **Cloudflare CDN** 下（即开启了“橙色小云朵”代理的域名），Cloudflare Anycast 路由与边缘安全机制会判定该流量为自回环（Cross-Worker Loop）。
- **实测表现**：连接会被直接拒绝（抛出网络异常，或触发 HTTP 1000 / 1006 保护阻断），无法直接完成三次握手。

### 对代理场景的影响
- 用户使用基于 Worker 的 VLESS 代理时，能够顺畅访问非 Cloudflare 托管的外网（如 Google、GitHub、AWS 等）。
- 但直接访问其他托管在 Cloudflare 上的站点时，直连连接会被平台阻断。

### 应对与工程架构演进方案（第二阶段规划）
- **ProxyIP 机制**：将出站流量重定向至一个反向代理节点或中继出口（Clean IP）。
- **WARP / Cloudflare Tunnel 出口**：通过 WARP 接口使出站流量脱离 Cloudflare 内部回环拦截网段后再注入互联网。

---

## 4. 长连接生命周期与保活超时 (Idle Timeout)

### TCP Socket 空闲超时
- Worker 发起的 TCP Socket 连接若处于**空闲状态（即持续没有字节收发）**，平台底层会在 **30 秒 ~ 60 秒** 后自动下发 `TCP RST` 终止连接。
- **解决方案**：应用层协议必须维持心跳包（例如 TCP Keep-Alive 或客户端 Ping）。

### CPU 时间与流传输（Wall-Clock Time）
- **CPU Time 计费机制**：Cloudflare Workers 的执行超时限制（免费版为 10ms CPU 时间）**仅统计 v8 虚拟机主动执行 JavaScript 代码的计算耗时**。
- **I/O 等待零消耗**：当流通过 `pipeTo` 在客户端与出站 TCP 之间直接流转时，属于底层 C++ 驱动的异步 I/O，不计入 CPU 时间。因此长达数十分钟的大文件传输或视频流不会被 CPU 预算超时截断。

---

## 5. 协议与计划额度限制

1. **UDP 协议不可直连**：
   - 目前 `cloudflare:sockets` **仅支持 TCP 连接**，Cloudflare 尚未开放用于通用 UDP 出站的 Socket API（无 raw `dgram` 支持）。
   - VLESS 的 UDP 指令（`Command = 2`）无法在当前标准 Worker 下通过原生 Socket 转发，通常需要降级为 TCP 封装、DoH（DNS-over-HTTPS）或通过 WARP 接口处理。
2. **并发连接数限制**：
   - 免费计划每个请求最多并发保持 6 个活动出站连接。
   - 内存上限为 128 MB。

---

## 6. 结论与架构策略

Cloudflare Workers **可以且能够充当高性能的 TCP 代理枢纽**，但必须恪守以下工程纪律：
1. 出站连接必须通过 `OutboundConnector` 接口抽象，隔离真实 `DirectTcpConnector` 与测试 `MockConnector`。
2. 必须对端口 25 等高危端口及非法地址做前置短路拦截。
3. 必须做好异常断开的互斥清理，在 TCP 异常中断时同步通知客户端 WebSocket 销毁。
