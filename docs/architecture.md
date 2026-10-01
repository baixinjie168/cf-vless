# Cloudflare Proxy Lab 架构设计文档

本文档记录 Cloudflare Proxy Lab 的总体架构与各模块职责划分。

## 模块分层与职责
- `worker/src/http`: HTTP 诊断与状态接口（`/`, `/health`, `/info`）
- `worker/src/websocket`: WebSocket 连接升级、生命周期与回显处理
- `worker/src/vless`: VLESS 协议纯函数解析器与类型定义（无网络副作用）
- `worker/src/outbound`: 出站网络抽象层与策略模式连接器（`DirectTcpConnector`, `MockConnector`）
- `worker/src/config`: 环境配置读取与 Secret 鉴权隔离
