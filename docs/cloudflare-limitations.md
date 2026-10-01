# Cloudflare 平台限制与出站边界记录

本文件专用于记录实测 Cloudflare Workers 在代理场景下的真实边界与限制，包括但不限于：
- 支持的目标端口
- connect() TCP Sockets 行为
- 长连接生命周期与超时特性
- 免费计划与付费计划的限制差异
