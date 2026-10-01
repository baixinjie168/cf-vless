# Cloudflare Proxy Lab 架构设计文档

本文档记录 Cloudflare Proxy Lab 的总体架构、分层职责、网络生命周期与演进规划。

---

## 1. 架构定位与解耦设计原则

Cloudflare Proxy Lab 坚持**职责高度隔离、架构彻底解耦**的工程准则：

```text
                      Cloudflare Edge
                            │
            ┌───────────────┴───────────────┐
            │                               │
       Pages 控制台                    Worker 代理引擎
     (Diagnostic Client)            (Network Core Engine)
            │                               │
    • HTTP 状态诊断卡片              • HTTP 诊断路由 (/, /health, /info)
    • WebSocket Echo 测试仪         • WebSocket 升级与全双工 Echo (/ws)
    • VLESS 报文构建与握手测试       • VLESS 纯函数解析与 UUID 鉴权 (/vless)
    • 实时交互控制台 (Terminal)      • Outbound TCP 出站流式管道
```

- **Pages 绝不充当代理中间人**：Pages 仅作为独立的诊断与测试控制台，直接向 Worker 发送测试探针与 VLESS 握手测试包。
- **Worker 负责核心网络管道**：作为高吞吐、低延迟的边缘无状态转发枢纽。

---

## 2. 模块分层与职责划分

- `worker/src/http`: HTTP 诊断与状态接口（`/`, `/health`, `/info`，内置 CORS 支持）。
- `worker/src/websocket`: WebSocket 连接升级、生命周期管理与全双工回显处理。
- `worker/src/vless`: VLESS 协议纯函数解析器、格式化工具与类型定义（无网络副作用）。
- `worker/src/outbound`: 出站网络抽象层与策略模式连接器（`DirectTcpConnector`, `MockConnector`）。
- `worker/src/config`: 环境配置读取与 Secret 鉴权隔离。
- `pages/src`: 独立的纯前端测试控制台（HTML + TypeScript），提供可视化协议调试与连通性验证。

---

## 3. HTTP 诊断接口规范 (Step 2)

- **`GET /`**: 返回服务基本运行状态与版本信息 (`name`, `status`, `version`)。
- **`GET /health`**: 极简健康探针，固定返回 `{"status": "ok"}`。
- **`GET /info`**: 实验环境元数据探针（安全隔离，严禁输出 `VLESS_UUID` 或任何敏感 Secret）。
- **CORS 支持**: 统一注入 `Access-Control-Allow-Origin: *`，支持浏览器端 Pages 控制台跨域直连探测。
- **方法限制与容错**: 非 GET 方法统一拒绝并返回 `405 Method Not Allowed`，未注册路由返回 `404 Not Found`。

---

## 4. VLESS 鉴权与短路安全机制 (Step 7)

- **密钥注入隔离**：源码中零硬编码，UUID 严格由环境变量/Secret `VLESS_UUID` 动态注入。
- **恒定时间校验 (`timingSafeEqual`)**：消除逐位对比的时间侧信道攻击风险（Timing Attack）。
- **Fail-Closed 默认拒绝**：未配置 Secret 或客户端凭证空缺时统一判负。
- **短路阻断 (`1008 Policy Violation`)**：鉴权失败立即关闭 WebSocket 并阻断后续任意出站转发，彻底保护 Worker 边缘资源。

---

## 5. 全双工流管道转发规范 (Step 10)

- **首包载荷注入**：剥离并验证 VLESS Header 后，将其携带的首包 Payload（如 TLS ClientHello）优先写入出站 Socket。
- **协议响应握手**：向客户端回传 `[0x00, 0x00]` VLESS 响应头确认握手就绪。
- **双向对敲流传输**：
  - 上行方向：客户端 WebSocket 消息帧 $\to$ 出站 TCP WritableStream
  - 下行方向：出站 TCP ReadableStream $\to$ 客户端 WebSocket 二进制帧
- **互斥级联销毁**：任意单侧断开（TCP FIN 或 WebSocket Close）或抛出异常时，均显式触发对侧资源彻底释放，杜绝悬挂连接。
- **高危端口阻断**：严格拦截 Port 25 (SMTP)，阻断垃圾邮件滥用。

---

## 6. 第二阶段（Phase 2）演进预留

在完成第一阶段核心原型验证后，系统已为以下产品化扩展预留良好接口：

1. **Clash Verge 订阅下发**：
   - 在 Worker 扩展 `/sub` 路由，动态生成兼容 Clash Meta / sing-box 的 YAML 或 Base64 订阅配置。
2. **WARP / Tunnel 出口扩展**：
   - 在 `worker/src/outbound` 中基于 `OutboundConnector` 接口增加 `WarpConnector` 或 `ProxyIpConnector`，解决访问 Cloudflare CDN 自身托管站点的自回环阻断问题。
3. **Pages 订阅管理面板**：
   - 为用户提供一键导入 Clash Verge / ClashX 的 `clash://install-config` 快速集成按钮。
