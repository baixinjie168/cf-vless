# Cloudflare Proxy Lab 架构设计文档

本文档记录 Cloudflare Proxy Lab 的总体架构与各模块职责划分。

## 模块分层与职责
- `worker/src/http`: HTTP 诊断与状态接口（`/`, `/health`, `/info`）
- `worker/src/websocket`: WebSocket 连接升级、生命周期与回显处理
- `worker/src/vless`: VLESS 协议纯函数解析器与类型定义（无网络副作用）
- `worker/src/outbound`: 出站网络抽象层与策略模式连接器（`DirectTcpConnector`, `MockConnector`）
- `worker/src/config`: 环境配置读取与 Secret 鉴权隔离

## HTTP 诊断接口规范 (Step 2)
- **`GET /`**: 返回服务基本运行状态与版本信息 (`name`, `status`, `version`)。
- **`GET /health`**: 极简健康探针，固定返回 `{"status": "ok"}`。
- **`GET /info`**: 实验环境元数据探针（安全隔离，严禁输出 `VLESS_UUID` 或任何敏感 Secret）。
- **方法限制与容错**: 非 GET 方法统一拒绝并返回 `405 Method Not Allowed`，未注册路由返回 `404 Not Found`。

## VLESS 鉴权与短路安全机制 (Step 7)
- **密钥注入隔离**：源码中零硬编码，UUID 严格由环境变量/Secret `VLESS_UUID` 动态注入。
- **恒定时间校验 (`timingSafeEqual`)**：消除逐位对比的时间侧信道攻击风险。
- **Fail-Closed 默认拒绝**：未配置 Secret 或客户端凭证空缺时统一判负。
- **短路阻断 (`1008 Policy Violation`)**：鉴权失败立即关闭 WebSocket 并阻断后续任意出站转发，彻底保护 Worker 边缘资源。
