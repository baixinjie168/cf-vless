# 变更日志 (CHANGELOG)

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 版本规范。

---

## [0.1.0] - 2026-10-02 (Phase 1 归档版本)

### 📌 阶段定位
第一阶段（Phase 1）核心目标达成：从零构建最小化、纯离线可测、模块化解耦的 Cloudflare 边缘网络代理实验台，全面打通 HTTP 诊断、WebSocket 全双工、VLESS 纯函数报文解析、恒定时间防侧信道鉴权、原生 TCP 出站直连以及 Pages 独立诊断控制台。

---

### 🚀 里程碑交付详单

#### 【里程碑 1】通信底座构建 (Step 1 ~ 4)
- **Monorepo 脚手架**：采用 npm workspaces 结构，配置 TypeScript、Vitest、Wrangler。
- **HTTP 诊断端点 (`/`, `/health`, `/info`)**：
  - 标准化 JSON 返回与 405 Method Not Allowed / 404 Not Found 容错。
  - 安全隔离策略：严格确保敏感凭证（如 `VLESS_UUID`）在 `/info` 中完全脱敏。
  - 支持跨域资源共享（CORS），方便前端控制台直连。
- **WebSocket 全双工 Echo 引擎 (`/ws`)**：
  - 基于 Cloudflare 原生 `new WebSocketPair()` 协商升级（101 Switching Protocols）。
  - 支持连接瞬间发送欢迎报文、文本/二进制全双工回显及 Code 1000 优雅断开。
- **Miniflare 真实边缘环境自动化集成测试**：7 项全双工端到端测试保证长连接通信可靠性。

#### 【里程碑 2】VLESS 协议与纯函数解析 (Step 5 ~ 7)
- **纯函数 VLESS 二进制解析器 (`worker/src/vless/parser.ts`)**：
  - 严格无副作用，采用 TypedArray 视图切片（`subarray`），杜绝不必要的内存深拷贝。
  - 支持 IPv4、域名（Domain）、IPv6 目标地址反序列化及提取初始载荷（Initial Payload）。
  - 防越界截断安全屏障：完备校验最小长度、Addons 标称边界、域名长度虚标及残缺报文。
- **解析器全场景自动化测试矩阵 (`worker/test/vless.spec.ts`)**：19 项正向与恶意畸变测试 100% 覆盖。
- **恒定时间 UUID 鉴权 (`worker/src/vless/auth.ts`)**：
  - 采用无分支位异或累加的 `timingSafeEqual()`，彻底抹除时间侧信道指纹（Timing Attack）。
  - 实施 **Fail-Closed 默认拒绝** 安全策略：未配置 Secret 或凭证不匹配时，立即执行 `server.close(1008, "Policy Violation")` 短路切断。

#### 【里程碑 3】出站探针与流式管道打通 (Step 8 ~ 10)
- **平台限制深度调研 (`docs/cloudflare-limitations.md`)**：
  - 调研并实测 Cloudflare Workers 原生 TCP 出站能力（`cloudflare:sockets`）。
  - 客观记录 Port 25 (SMTP) 平台硬性阻断、Cloudflare-to-Cloudflare CDN 自回环拦截（Cross-Worker Loop）以及 30~60s 空闲超时机制。
- **多态连接策略器 (`worker/src/outbound/connector.ts`)**：
  - 设计抽象接口 `OutboundConnector`。
  - 交付 `DirectTcpConnector`（生产原生 TCP 直连）与 `MockConnector`（测试虚拟双向管道）。
- **全双工 VLESS 至出站双向对敲流管道 (`worker/src/websocket/handler.ts`)**：
  - 握手首帧解析提取 Initial Payload（如 TLS ClientHello）优先写入出站 Socket。
  - 向客户端回传 `[0x00, 0x00]` 确认应答。
  - 实施 WebSocket 消息帧 $\leftrightarrow$ TCP Stream 的零缓冲双向流对敲。
  - 部署互斥级联销毁逻辑，杜绝资源悬挂泄漏；防御 Port 25 邮件滥用。

#### 【里程碑 4】实验控制台与技术沉淀 (Step 11 ~ 12)
- **Pages 独立实验控制台 (`pages/`)**：
  - 采用极简暗黑工程科技风前端界面，零外网 CDN 强依赖，支持离线渲染。
  - 集成 Worker 延迟探测、HTTP 诊断卡片、WebSocket 连通性测试仪及 VLESS 二进制报文 Hex 握手测试仪。
  - 集成实时终端日志流（Live Logs），支持时间戳分类高亮、一键清空与复制。
  - 本机浏览器现场测试验证：HTTP 200 (10ms)、WS Echo (welcome)、VLESS 握手成功 (52ms 回传 `00 00`) 闭环验证。
- **综合文档与成果固化**：
  - 旗舰文档 [`README.md`](README.md)：包含 Phase 1 验收标准的全部 12 项技术问题权威解答。
  - 专题规范文档：[`architecture.md`](docs/architecture.md)、[`vless.md`](docs/vless.md)、[`websocket.md`](docs/websocket.md)、[`cloudflare-limitations.md`](docs/cloudflare-limitations.md)。

---

### 📊 工程质量基准
- **自动化测试**：7 个测试套件，**61 个测试用例全部通过（100% 成功率）**。
- **静态类型**：Worker + Pages 双工作区 TypeScript 严格模式 **0 错误**。
- **网络开销**：无需外网 VPS、无需域名，本地开箱即测。
