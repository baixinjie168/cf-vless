# WebSocket 通信与生命周期记录 (Step 3 & 4)

本文档记录 Cloudflare Worker 对 WebSocket 双向通信、连接生命周期以及端到端自动化测试的实测与工程实现细节。

---

## 1. WebSocket 握手升级机制

Cloudflare Workers 提供了原生 `WebSocketPair` API，在边缘节点无需依赖外部 Node.js 扩展即可实现标准 RFC 6455 握手升级。

### 核心握手流程
1. **协议头检测**：检测客户端请求 Header 中是否存在 `Upgrade: websocket`（忽略大小写）。
   - 若缺失或不匹配，立即返回 `426 Upgrade Required`，避免无意义的资源占用。
   - 非 `GET` 请求统一返回 `405 Method Not Allowed`。
2. **WebSocket 实例配对**：
   ```typescript
   const webSocketPair = new WebSocketPair();
   const [client, server] = Object.values(webSocketPair);
   ```
3. **服务端激活与握手响应**：
   - 服务端必须显式调用 `server.accept()` 激活长连接。
   - 主 Worker 返回状态码为 `101 Switching Protocols` 的空响应体，并将 `client` 绑定至 `webSocket` 属性中返回给客户端：
   ```typescript
   return new Response(null, {
     status: 101,
     webSocket: client,
   });
   ```

---

## 2. 全双工通信与生命周期管理

### 握手欢迎信 (Welcome Greeting)
在 `server.accept()` 后，服务端主动下发 `"welcome"` 文本帧，供客户端快速校验连接就绪状态。

### 全双工回显 (Echo Engine)
服务端对接收到的所有帧进行原样反射，支持以下两种载荷类型：
- **文本帧 (Text Frames)**：UTF-8 字符串原样 `server.send(data)` 回显。
- **二进制帧 (Binary Frames)**：`ArrayBuffer` / `Uint8Array` 二进制数据原样回显，保持原始字节序列无损。

### 优雅关闭与异常释放
- 监听 `close` 事件：捕获客户端发起的正常断开（如状态码 `1000`），服务端调用 `server.close()` 对等释放。
- 监听 `error` 事件：捕获传输链路异常，以错误码 `1011 (Internal Error)` 强制终止，避免边缘节点连接悬挂。
- 所有关闭操作均包裹 `try / catch` 容错，防止重复关闭抛出运行时异常。

---

## 3. 本地 Miniflare 自动化测试实践 (Step 4)

为保证在脱离 Cloudflare 远程环境的本地开发阶段即可进行 100% 真实闭环验证，Step 4 集成了 `Miniflare`（基于 Cloudflare `workerd` 内核）。

### 测试矩阵与断言
- **升级拦截测试**：非 WebSocket 请求访问 `/ws` 返回 `426`；非 `GET` 请求返回 `405`。
- **握手协议测试**：验证返回 `101 Switching Protocols` 且 `response.webSocket` 正确返回。
- **欢迎帧测试**：验证客户端握手就绪后首包接收到 `"welcome"`。
- **文本回显测试**：发送 `"hello cloudflare"` 与 `"ping"`，验证有序接收回显。
- **二进制回显测试**：发送指定魔数序列 `[0x00, 0x01, 0xfe, 0xff, 0x42]`，断言回显字节精确匹配。
- **生命周期关闭测试**：客户端主动下发 `close(1000)`，断言关闭事件触发且双方正常销毁。

> **工程注意点**：在 `Miniflare / workerd` 模拟客户端测试中，客户端 WebSocket 在调用 `accept()` 前应先绑定 `message` 监听器，确保首条 `welcome` 缓冲消息不被丢弃。
