# Cloudflare Proxy Lab (`cf-vless`)

> **Cloudflare Workers & Pages 边缘网络代理、全双工长连接与 VLESS 协议实证实验项目**

本项目从零构建了一个最小化、模块化、高可测性的 Cloudflare 边缘网络代理实验台，用于深度探究 Cloudflare Workers 的网络能力、`cloudflare:sockets` TCP 出站能力、WebSocket 双向流式转发机制以及平台对长连接与代理场景的各项边界约束。

---

## 目录

- [1. 核心设计原则与边界准则](#1-核心设计原则与边界准则)
- [2. 项目工程结构](#2-项目工程结构)
- [3. 里程碑与 12 步演进成果](#3-里程碑与-12-步演进成果)
- [4. 本地启动与离线自动化验证](#4-本地启动与离线自动化验证)
- [5. Pages 实验控制台使用指引](#5-pages-实验控制台使用指引)
- [6. 第一阶段核心技术问答 (验收标准)](#6-第一阶段核心技术问答-验收标准)
  - [Cloudflare Worker 网络机制](#cloudflare-worker-网络机制)
  - [VLESS 协议与鉴权机制](#vless-协议与鉴权机制)
  - [Outbound 出站网络能力与平台限制](#outbound-出站网络能力与平台限制)
  - [架构思考与 Phase 2 演进规划](#架构思考与-phase-2-演进规划)
- [7. 详细专题技术文档](#7-详细专题技术文档)

---

## 1. 核心设计原则与边界准则

- **纯离线可测性优先**：无需购买域名、无需 VPS，全套协议解析与端到端网络转发可在本地 100% 离线通过自动化测试套件（基于 Vitest 与 Miniflare）闭环复现。
- **架构彻底解耦**：
  - `worker/` 负责承载 HTTP、WebSocket、VLESS 解析与 TCP 出站核心代理转发逻辑。
  - `pages/` 仅作为独立的诊断与测试前端控制台，绝不作为代理中继，彻底杜绝强耦合。
- **纯函数协议切片**：VLESS 解析层保持严格无副作用，内存零不必要拷贝，全防截断与越界攻击。
- **高安全防范标准**：
  - 源码零硬编码 UUID，严格通过 Secret 动态注入。
  - 采用无分支位异或运算的恒定时间比较算法（`timingSafeEqual`），杜绝侧信道时间差攻击（Timing Attack）。
  - Fail-Closed 默认拒绝策略；拦截高危端口（如 SMTP 25 端口）。

---

## 2. 项目工程结构

本项目采用现代 npm workspaces 单体仓库（Monorepo）结构，统一采用 TypeScript 开发：

```text
cloudflare-proxy-lab/
├── worker/                           # Cloudflare Worker 核心网络引擎
│   ├── src/
│   │   ├── config/
│   │   │   └── config.ts             # 环境变量读取与鉴权 Secret 安全隔离
│   │   ├── http/
│   │   │   └── handler.ts            # HTTP 诊断端点 (/, /health, /info) 与 CORS
│   │   ├── websocket/
│   │   │   └── handler.ts            # WebSocket 升级、全双工 Echo 与 VLESS 转发管道
│   │   ├── vless/
│   │   │   ├── parser.ts             # VLESS 协议纯函数解析器与序列化工具
│   │   │   ├── auth.ts               # 恒定时间 UUID 鉴权与短路防御 (timingSafeEqual)
│   │   │   └── types.ts              # VLESS 协议数据结构与指令枚举
│   │   ├── outbound/
│   │   │   ├── connector.ts          # OutboundConnector 策略接口 (DirectTcp 与 Mock)
│   │   │   └── stub.ts               # 本地测试与打包桩
│   │   └── index.ts                  # Worker 入口与协议分发中枢
│   ├── test/
│   │   ├── http.spec.ts              # HTTP 端点与 CORS 自动化测试
│   │   ├── websocket.spec.ts         # WebSocket 握手与全双工 Echo 测试 (Miniflare)
│   │   ├── vless.spec.ts             # VLESS 纯函数解析器全场景覆盖测试
│   │   ├── auth.spec.ts              # UUID 鉴权与短路阻断测试
│   │   ├── outbound.spec.ts          # OutboundConnector 策略测试
│   │   ├── pipeline.spec.ts          # 端到端 VLESS 出站流式管道集成测试
│   │   └── index.spec.ts             # 入口路由集成测试
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── wrangler.toml
│
├── pages/                            # Cloudflare Pages 独立实验控制台
│   ├── src/
│   │   ├── index.html                # 现代化暗色系诊断控制台界面
│   │   └── app.ts                    # 浏览器端 HTTP/WS/VLESS 握手测试客户端
│   ├── tsconfig.json
│   └── package.json
│
├── docs/                             # 专题深度技术沉淀文档
│   ├── architecture.md               # 总体架构设计与生命周期规范
│   ├── vless.md                      # VLESS 协议规范与纯函数解析要点
│   ├── websocket.md                  # WebSocket 全双工流传输与生命周期机制
│   └── cloudflare-limitations.md     # Workers 出站能力与平台硬性限制实测记录
│
├── package.json                      # Monorepo 统一调度脚本
└── README.md                         # 项目综合交付与技术报告
```

---

## 3. 里程碑与 12 步演进成果

本项目严格按照 12 步渐进式路线图规划并全部高质量实施落地：

```text
【里程碑 1】通信底座构建 (Step 1 ~ 4)
  Step 1: Monorepo 脚手架搭建与 TypeScript / Vitest / Wrangler 初始化
  Step 2: HTTP 诊断端点实现 (/, /health, /info) 与敏感信息脱敏隔离
  Step 3: WebSocket 升级协商与全双工 Echo 引擎实现
  Step 4: Miniflare 真实边缘环境自动化集成测试驱动

【里程碑 2】VLESS 协议与纯函数解析 (Step 5 ~ 7)
  Step 5: VLESS 二进制解析器纯函数实现 (无副作用、零多余拷贝)
  Step 6: 解析器单测全矩阵覆盖 (IPv4/IPv6/域名/畸变包防截断防护)
  Step 7: UUID 恒定时间鉴权 (timingSafeEqual) 与 1008 短路防御

【里程碑 3】出站探针与流式管道打通 (Step 8 ~ 10)
  Step 8: Cloudflare connect() 原生出站实测调研与平台限制记录
  Step 9: OutboundConnector 抽象层设计 (DirectTcp 与 Mock 多态策略)
  Step 10: VLESS 至出站端到端全双工流管道流转与双侧互斥优雅销毁

【里程碑 4】实验控制台与技术沉淀 (Step 11 ~ 12)
  Step 11: Pages 独立实验控制台开发 (可视化 HTTP/WebSocket/VLESS 握手测试)
  Step 12: 完善项目综合技术文档与第一阶段验收交付总结
```

---

## 4. 本地启动与离线自动化验证

### 环境准备
- Node.js $\ge 18.0.0$ (推荐 Node 20 LTS 或 Node 22+)
- npm $\ge 9.0.0$

### 快速命令

```bash
# 1. 运行全部自动化测试 (7 个测试套件，61 个测试用例，100% 通过)
npm test

# 2. 执行全工程静态类型检查 (Worker + Pages 零报错)
npm run typecheck

# 3. 启动本地 Cloudflare Worker 边缘服务 (默认端口 8787)
npm run dev

# 4. 启动 Pages 实验控制台前端界面 (默认端口 5173)
npm run pages:dev

# 5. 构建 Pages 纯静态生产产物
npm run pages:build
```

---

## 5. Pages 实验控制台使用指引

Pages 模块（`pages/`）为纯静态调试控制台，支持直接对本地或远端部署的 Worker 进行全维度功能探测：

1. **目标地址配置**：默认指向 `http://localhost:8787`，支持一键切换至远端生产环境 URL；支持快速 Ping 测定端到端 HTTP 延迟。
2. **HTTP 诊断面板**：
   - 快速测试 `/`、`/health` 与 `/info` 路由。
   - 自动验证 CORS 跨域响应头及 Secret 脱敏安全机制。
3. **WebSocket Echo 测试仪**：
   - 一键握手连接 Worker 的 `/ws` 路径。
   - 发送文本消息与随机 16 字节二进制报文，实时测量往返时延（RTT）与回显一致性。
   - 支持主动断开并观测 Code 1000 正常关闭事件。
4. **VLESS 协议握手测试仪**：
   - 浏览器原生构造合规 VLESS 二进制请求首包（包含指定 UUID、目标地址与端口）。
   - 发送握手报文，实时展示发送字节的 Hex 视图。
   - 捕获 Worker 返回的 VLESS 握手响应（`[0x00, 0x00]` 代表成功），或观测非法 UUID 及安全封禁端口（如 Port 25）触发的 `1008 Policy Violation` 阻断反馈。
5. **实时控制台终端 (Live Logs)**：
   - 带时间戳的深色终端日志流，清晰区分 `INFO`、`SUCCESS`、`WARN`、`ERROR`、`WS-TX`、`WS-RX` 等标签，支持一键清空与日志复制。

---

## 6. 第一阶段核心技术问答 (验收标准)

针对第一阶段立项时的核心问题，实验给出了确定性、有工程代码验证的技术解答：

### Cloudflare Worker 网络机制

#### Q1: Worker 如何接收并处理 HTTP？
- **机制**：通过在 Worker 入口导出的标准 `fetch(request, env, ctx)` 处理函数接收原生 WHATWG `Request`。
- **路由分发**：解析 `request.url` 的 `pathname`，针对不同路径（如 `/`, `/health`, `/info`）分别交由对应的处理函数返回原生 `Response`。
- **容错规范**：对非预期请求方法统一返回 `405 Method Not Allowed`，未注册路由返回 `404 Not Found`。

#### Q2: Worker 如何处理 WebSocket 连接？
- **协议升级协商**：通过检查请求头 `Upgrade: websocket` 判定是否为 WebSocket 握手请求。
- **配对创建**：使用 Cloudflare 提供的 `new WebSocketPair()` 原生 API，瞬间解构出两个配对套接字：
  ```typescript
  const { 0: client, 1: server } = new WebSocketPair();
  ```
- **建立握手**：服务端调用 `server.accept()` 激活套接字，同时向客户端返回 HTTP 响应码 `101 Switching Protocols` 并挂载 `webSocket: client`。

#### Q3: WebSocket 如何保持全双工双向通信？
- **事件监听机制**：在 `server` 套接字上通过 `addEventListener("message", ...)` 异步监听客户端上传的文本帧或二进制帧（`ArrayBuffer`）。
- **主动推送机制**：在任意生命周期内，通过 `server.send(data)` 将下行数据推送给客户端，无需轮询。
- **状态感知**：通过 `close` 和 `error` 事件全面跟踪对端状态，实现双向独立且相互级联的闭环。

#### Q4: Worker 可以保持多久的长连接？
- **空闲超时 (Idle Timeout)**：若连接处于绝对静默状态（持续无任何数据传输），底层基础设施通常会在 **30 秒 ~ 60 秒** 内发送 `TCP RST` 或触发连接终止。
- **心跳保活**：只要客户端或服务端维持应用层的心跳 Ping/Pong 或周期性数据传输，连接可以持续保持数十分钟甚至数小时。
- **计费与 CPU 预算**：Cloudflare 免费版限制单次调用的 CPU 执行时间为 10ms，但**长连接的异步 I/O 等待与流式转发（Stream Piping）属于底层 C++ 驱动的异步操作，完全不计入 CPU 执行时间**。

---

### VLESS 协议与鉴权机制

#### Q5: VLESS 请求报文头结构是什么？
客户端在建立 WebSocket 连接后，首帧必须发送二进制格式的 VLESS 请求首部：
```text
+---------+----------------+---------+--------+---------+--------+-------------+---------+---------+
| Version |      UUID      | AddonsL | Addons | Command |  Port  | AddressType | Address | Payload |
| (1 B)   |    (16 B)      |  (1 B)  |  (M B) |  (1 B)  | (2 B)  |    (1 B)    |  (N B)  | (剩余)  |
+---------+----------------+---------+--------+---------+--------+-------------+---------+---------+
```
1. **Version (1 Byte)**: 协议版本，固定为 `0x00`。
2. **UUID (16 Bytes)**: 用户唯一身份认证凭证原始二进制。
3. **Addons Length $M$ (1 Byte)**: 附加元数据长度（通常为 `0x00`）。
4. **Command (1 Byte)**: 转发模式，`0x01` 为 TCP 代理，`0x02` 为 UDP 代理。
5. **Port (2 Bytes)**: 目标端口（大端序，网络字节序）。
6. **Address Type (1 Byte)**: 目标地址类型：`0x01` (IPv4, 4 字节)，`0x02` (Domain, 1 字节长度 + 字符串)，`0x03` (IPv6, 16 字节)。
7. **Payload (剩余字节)**: 应用层握手首包（如 TLS ClientHello），服务端必须提取并在建立 TCP 连接后第一时间注入目标服务器。

#### Q6: UUID 是如何验证的？如何防范侧信道攻击？
- **环境变量动态解耦**：UUID 严格由环境变量/Secret 注入，运行时转换为规范化小写格式。
- **恒定时间算法 (`timingSafeEqual`)**：JavaScript 标准 `===` 运算符在遇到首个不匹配字符时会立即跳出循环，造成微小的时间耗时差异。本项目采用按位异或累加算法：
  $$\Delta = \sum_{i=0}^{N-1} (A_i \oplus B_i)$$
  只有当每一位都完全相同时累加和才为 0，且执行耗时在所有情况下完全一致，杜绝了时间侧信道分析（Timing Attack）。
- **短路阻断**：鉴权不匹配时，立即执行 `server.close(1008, "Policy Violation")`，直接释放所有资源，绝不发起出站请求。

#### Q7: 为什么 VLESS 协议本身不需要加解密？
- **分工明确的协议分层**：VLESS（V2Ray Lightweight Essential Security System）的设计初衷是“只做必要的路由索引，不做冗余加密”。
- **下层传输安全由 TLS / WSS 承载**：客户端与 Cloudflare Edge 之间通过安全的 HTTPS / WSS 传输层建立 TLS 握手，所有在公网上传输的数据包（包括 VLESS Header 与后续用户数据）已被外层 TLS 高强度加密。
- **性能最大化**：避免了传统 Shadowsocks / VMess 在 TLS 隧道内进行“二次套娃加密”带来的昂贵 CPU 损耗，使边缘 Worker 能够以极致性能进行流式直通转发。

---

### Outbound 出站网络能力与平台限制

#### Q8: Worker 能连接哪些目标？
- **公网标准 TCP 目标**：只要目标主机是合法的公网 IPv4 / IPv6 地址或可通过公开 DNS 解析的域名，且开放标准 TCP 端口（如 80、443、8080、8443、22、53 等），Worker 均可通过 `cloudflare:sockets` 发起原生直连。

#### Q9: Worker 不能连接哪些目标？
- **高危滥用端口（Port 25）**：Cloudflare 平台级硬性阻断对 TCP 25 端口（SMTP）的出站连接，防止垃圾邮件泛滥。
- **Cloudflare 自身域名回环（Cross-Worker Loop）**：若尝试通过 `connect()` 访问托管在 Cloudflare CDN 上的其他域名或 IP，Cloudflare 边缘路由会判定为自回环（触发 HTTP 1000 / 1006 保护阻断）。
- **原生 UDP 协议**：当前 `cloudflare:sockets` 仅支持标准 TCP 协议，不支持无状态 raw UDP 出站。

#### Q10: Cloudflare 对网络代理存在哪些限制？
1. **连接数限制**：免费计划单次请求最多维持 6 个并发出站连接。
2. **内存限制**：单个 Worker 实例内存上限为 128 MB。
3. **空闲断流**：TCP 连接无数据流动达 30~60 秒即被切断。
4. **回环阻断**：需要引入 ProxyIP 或 WARP 机制作为中继出口以解决 CF 自身站点的访问。

---

### 架构思考与 Phase 2 演进规划

#### Q11: Worker + Pages 的关系应该如何设计？
- **绝不强行耦合**：不要将所有请求都通过 Pages Functions 再路由到 Worker，这会徒增延迟且混淆关注点。
- **边界明确的星型拓扑**：
  - Worker 作为核心网络服务（Core Proxy Engine）。
  - Pages 作为独立部署的 Web 控制台与管理前端（Console UI / Docs）。
  - 两者仅通过公开的 HTTP/WebSocket API 进行松耦合交互。

#### Q12: 如果后续要支持 Clash Verge 订阅，应该怎么扩展？
- **扩展 `/sub` 接口**：在 Worker 中增加 `/sub` 路由，根据配置动态生成兼容 Clash Meta / sing-box 的 YAML 或 Base64 订阅文本。
- **动态节点参数下发**：将用户 UUID、当前 Worker 节点域名、传输路径（`/vless`）、TLS 配置等组装为标准的 `vless://` URI 或 Clash `proxies` 结构体。
- **Pages 一键导入**：在 Pages 控制台提供 `clash://install-config?url=...` 协议快捷按钮，实现一键调起客户端导入。

---

## 7. 详细专题技术文档

- 🏛️ [架构设计与生命周期规范 (docs/architecture.md)](docs/architecture.md)
- 📜 [VLESS 协议规范与纯函数解析要点 (docs/vless.md)](docs/vless.md)
- 🔌 [WebSocket 双向流传输机制与测试沉淀 (docs/websocket.md)](docs/websocket.md)
- 🚧 [Cloudflare Workers 出站能力与平台硬性限制实测记录 (docs/cloudflare-limitations.md)](docs/cloudflare-limitations.md)

---

## 许可证与免责声明

本项目仅供计算机网络、边缘计算架构以及 Cloudflare 平台协议特性的学术与工程探索使用。
严禁将本项目用于违反所在地区法律法规及服务提供商使用条款的场景。