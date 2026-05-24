# SSE → socket.io 事件通道重构

> 创建：2026-05-24 | 状态：待实现

## 问题

当前 SSE 方案极不稳定：手动 buffer 行解析、手动重连逻辑、双 SSE 通道（HandoffService + 内部 HTTP）维护成本高。iOS WebSocket 独立一路，共 4 条通道各自为政。

## 方案：socket.io 统一

用 socket.io 取代所有 SSE + 原生 WebSocket，1 条通道承载所有事件推送。

### 架构对比

```
【现状 4 通道】                          【目标 1 通道】

HandoffService ──SSE──→ 主进程           HandoffService (socket.io server)
HandoffService ──SSE──→ 主进程(内部)          │
HandoffService ──WS───→ iOS               ├─ admin (主进程) → IPC → 渲染进程
内部HTTP ───────SSE──→ 主进程              └─ peers (iOS)
```

### 事件协议

**主进程（admin room）：**

| 事件 | 替代 | 触发时机 |
|------|------|----------|
| `device:paired` | device-paired SSE | 设备注册后 |
| `device:revoked` | device-revoked SSE | 撤销配对后 |
| `transfer:recorded` | transfer-recorded SSE | 传输记录写入后 |
| `config:reloaded` | config-reloaded SSE | 热重载配置后 |
| `service:restarting` | restarting SSE | 重启前 |
| `service:error` | service-error SSE | 致命错误 |

**iOS（peers room）：**

| 事件 | 方向 | 用途 |
|------|------|------|
| `auth` | iOS → Server | 连接认证 {deviceId, deviceName, platform} |
| `auth:ok` | Server → iOS | 注册完成确认 |
| `clipboard` | 双向 | 剪贴板同步 {payload, hash} |
| `clipboard:latest` | iOS → Server | 请求最新剪贴板 |
| `file:offer` / `file:accept` | 双向 | 文件传输 |

### 认证流程

```
主进程连接:
  socket.emit('auth', { role: 'admin' })
  → 加入 admin room → 接收所有事件

iOS 连接:
  socket.emit('auth', { deviceId, deviceName, platform: 'ios' })
  → 验证 deviceId → POST /internal/paired-device → SQLite
  → 广播 'device:paired' → admin room
  → 加入 peers room
  → 回复 'auth:ok'
```

### 删除清单

| 文件 | 删除 |
|------|------|
| `ws-server.ts` | **整个文件** |
| `http-server.ts` | `/events` SSE 端点、`sseClients`、`broadcastSSE()` |
| `internal-http.ts` | `/internal/events` SSE 端点、`sseClients`、`broadcastInternalSSE()` |
| `handoff-ipc-client.ts` | `connectSSE()` 全部（重连/解析/清理）、`startHealthCheck()`/`stopHealthCheck()` |
| `ipc/handoff.ts` | 内部 SSE 连接代码、health check 逻辑 |

### 新增/修改

| 文件 | 改动 |
|------|------|
| `handoff-service/socket.ts` | **新建** — socket.io server、认证中间件、事件路由 |
| `handoff-service/index.ts` | ws-server → socket.ts |
| `handoff-ipc-client.ts` | 替换为 socket.io-client（~20 行，内置重连心跳） |
| `ipc/handoff.ts` | 收到 socket.io 事件 → IPC 转发（~15 行） |
| `http-server.ts` | 只保留 REST 端点，去 SSE |
| `internal-http.ts` | 只保留：transfer-record、paired-device、revoke-device、devices |
| `iOS ConnectionManager.swift` | URLSessionWebSocketTask → SocketIOClient（-140 行） |

### 内部 HTTP 保留端点

```
POST /internal/transfer-record  传输记录写入
POST /internal/paired-device    设备注册
POST /internal/revoke-device    撤销设备
GET  /internal/devices          查询设备列表
```

理由：REST 语义匹配请求-响应模式，`curl` 可直接调试，与 socket.io 实时推送互补。

### 依赖

```
socket.io (HandoffService)     — server
socket.io-client (主进程)      — client
Socket.IO-Client-Swift (iOS)   — client
```

### iOS 收益

- 删除：`webSocketTask`、`connectWebSocket()`、`receiveWSMessage()`、`scheduleReconnect()`、`handleWSMessage()`、`handleWSBinary()`、`sendRegister()`、`heartbeatTimer`、`checkHealth()`、`startHeartbeat()`、`stopHeartbeat()`、所有重连属性
- socket.io 内置：自动重连（指数退避）、自动心跳 ping/pong、消息帧完整
- 净减少 ~140 行手动管理代码
