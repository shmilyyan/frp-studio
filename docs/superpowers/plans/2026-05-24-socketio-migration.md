# SSE → socket.io 迁移 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 socket.io 统一替代 HandoffService 的 SSE + 原生 WebSocket，1 条通道承载所有事件推送，内置自动重连和心跳。

**Architecture:** HandoffService 起 socket.io server（端口复用 19528 HTTP server），主进程和 iOS 作为 socket.io 客户端连接。admin 客户端收所有事件通过内存 IPC 转发渲染进程；iOS 客户端通过 `auth` 事件自动注册设备。内部 HTTP REST 端点保留不变（传输记录、设备管理）。

**Tech Stack:** socket.io (server), socket.io-client (Node.js main process), Socket.IO-Client-Swift (iOS)

---

### Task 1: 安装依赖 + 删除 ws-server.ts

**Files:**
- Modify: `package.json` (dependencies)
- Delete: `src/handoff-service/ws-server.ts`

- [ ] **Step 1: 安装 socket.io 和 socket.io-client**

```bash
pnpm add socket.io socket.io-client
```

Expected: packages installed to node_modules

- [ ] **Step 2: 删除 ws-server.ts**

```bash
rm src/handoff-service/ws-server.ts
```

- [ ] **Step 3: 验证 pnpm build:handoff 编译（此时会因 index.ts 引用 ws-server 而失败——预期行为）**

Run: `pnpm build:handoff`
Expected: FAIL — `Cannot find module './ws-server'`

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git rm src/handoff-service/ws-server.ts
git commit -m "chore: install socket.io, socket.io-client; remove ws-server.ts"
```

---

### Task 2: 创建 socket.ts（HandoffService 服务端）

**Files:**
- Create: `src/handoff-service/socket.ts`

- [ ] **Step 1: 创建 socket.ts**

```typescript
import { Server as SocketIOServer, Socket } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import http from 'http'

interface DeviceInfo {
  deviceId: string
  deviceName: string
  platform: string
}

let io: SocketIOServer | null = null

export function startSocketServer(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 5000,
    connectTimeout: 10000
  })

  io.on('connection', (socket: Socket) => {
    console.log(`[socket.io] Client connected: ${socket.id}`)

    // All clients must authenticate within 5 seconds
    const authTimer = setTimeout(() => {
      if (!socket.data.authenticated) {
        console.log(`[socket.io] Auth timeout: ${socket.id}`)
        socket.emit('error', { message: 'authentication required' })
        socket.disconnect()
      }
    }, 5000)

    socket.on('auth', (msg: { role?: string; deviceId?: string; deviceName?: string; platform?: string }) => {
      clearTimeout(authTimer)

      if (msg.role === 'admin') {
        socket.data.authenticated = true
        socket.data.role = 'admin'
        socket.join('admin')
        console.log(`[socket.io] Admin authenticated: ${socket.id}`)
        socket.emit('auth:ok', { role: 'admin' })
        return
      }

      // iOS peer: auto-register device
      if (msg.deviceId && msg.deviceName) {
        socket.data.authenticated = true
        socket.data.role = 'peer'
        socket.data.deviceId = msg.deviceId
        socket.join('peers')

        // Register device in SQLite via internal HTTP
        const postData = JSON.stringify({
          deviceId: msg.deviceId,
          deviceName: msg.deviceName,
          publicKey: msg.deviceId,
          platform: msg.platform || 'ios'
        })
        const req = http.request({
          hostname: '127.0.0.1', port: 19529, path: '/internal/paired-device',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, () => {})
        req.on('error', (e: Error) => console.error('[socket.io] Failed to save device:', e.message))
        req.write(postData)
        req.end()

        // Notify admin
        io.to('admin').emit('device:paired', { deviceId: msg.deviceId, deviceName: msg.deviceName })
        socket.emit('auth:ok', { role: 'peer', deviceId: msg.deviceId })
        console.log(`[socket.io] Peer registered: ${msg.deviceName} (${msg.deviceId})`)
        return
      }

      // Invalid auth
      socket.emit('error', { message: 'invalid authentication' })
      socket.disconnect()
    })

    // Clipboard from iOS peer → broadcast to admin + other peers
    socket.on('clipboard', (msg: { payload: string; hash?: string }) => {
      if (!socket.data.authenticated) return
      const { writeClipboard, getLatestClipboard } = require('./clipboard')
      if (msg.payload && typeof msg.payload === 'string') {
        writeClipboard(msg.payload)
        const { hash } = getLatestClipboard()
        socket.to('admin').emit('clipboard', { payload: msg.payload, hash, sourceId: socket.id })
        socket.to('peers').emit('clipboard', { payload: msg.payload, hash, sourceId: socket.id })
        console.log(`[socket.io] Clipboard from ${socket.id.slice(0,8)} (${msg.payload.length} chars)`)
      }
    })

    socket.on('clipboard:latest', () => {
      const { getLatestClipboard } = require('./clipboard')
      socket.emit('clipboard', getLatestClipboard())
    })

    socket.on('file:offer', (msg) => {
      socket.to('peers').emit('file:offer', msg)
    })

    socket.on('file:accept', (msg) => {
      socket.to('peers').emit('file:accept', msg)
    })

    socket.on('disconnect', (reason) => {
      console.log(`[socket.io] Client disconnected: ${socket.id} (${reason})`)
      if (socket.data.role === 'peer') {
        io.to('admin').emit('peer:disconnected', { socketId: socket.id, deviceId: socket.data.deviceId })
      }
    })
  })

  console.log('[HandoffService] socket.io server attached')
  return io
}

// For clipboard watcher: broadcast Windows clipboard changes to all peers
export function broadcastClipboard(payload: string, hash: string): void {
  if (!io) return
  io.to('peers').emit('clipboard', { payload, hash, sourceId: 'server', timestamp: Date.now() })
}

// For notifying admin of events
export function notifyAdmin(event: string, data: unknown): void {
  if (!io) return
  io.to('admin').emit(event, data)
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm build:handoff`
Expected: PASS (socket.ts 编译成功，但 index.ts 仍引用 ws-server——将在 Task 3 修复)

- [ ] **Step 3: Commit**

```bash
git add src/handoff-service/socket.ts
git commit -m "feat: socket.io server with auth, clipboard, file event routing"
```

---

### Task 3: 修改 index.ts 接入 socket.ts

**Files:**
- Modify: `src/handoff-service/index.ts:35-87`

- [ ] **Step 1: 替换 ws-server 导入和 handler 注册**

读取 `src/handoff-service/index.ts`。替换第 35-87 行（从 `const { startWebSocketServer...` 到 `startClipboardWatcher` 回调结束）：

```typescript
  // Attach socket.io server to the same HTTP server
  const { startSocketServer, broadcastClipboard } = await import('./socket')
  const io = startSocketServer(server)

  // Register socket.io event handlers (done in socket.ts)
  // Clipboard watcher: broadcast Windows changes to all peers
  const { startClipboardWatcher } = await import('./clipboard')
  startClipboardWatcher((content) => {
    const { getLatestClipboard } = require('./clipboard')
    const { hash } = getLatestClipboard()
    broadcastClipboard(content, hash)
  })
```

注：删除所有 `registerHandler(...)` 调用（file:offer, file:accept, clipboard:latest, clipboard），删除 `handleFileOffer` 导入，删除 `startWebSocketServer` 导入和调用。

- [ ] **Step 2: 删除不再使用的导入**

第 39 行 `const { handleFileOffer } = await import('./file-transfer')` — 删除。

- [ ] **Step 3: pnpm build:handoff**

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/handoff-service/index.ts
git commit -m "refactor: replace ws-server with socket.io in HandoffService entry"
```

---

### Task 4: 清理 http-server.ts — 删 SSE 端点

**Files:**
- Modify: `src/handoff-service/http-server.ts:24-57`

- [ ] **Step 1: 删除 sseClients、broadcastSSE、/events 端点**

删除以下代码块：

```typescript
// 删除第 24 行:
const sseClients: Set<SSEClient> = new Set()

// 删除第 26-31 行:
export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    client.write(payload)
  }
}

// 删除第 47-58 行 (/events 端点):
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })
    res.write(`event: connected\ndata: {}\n\n`)
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return
  }
```

- [ ] **Step 2: 删除 /pair/confirm 中的 broadcastSSE 调用**

找到 `/pair/confirm` handler 中 `broadcastSSE('device-paired', ...)` — 删除该行（socket.io 在 auth 流程中处理）。

- [ ] **Step 3: 删除 /register 中的 broadcastSSE 调用**

找到 `/register` handler 中 `broadcastSSE('device-paired', ...)` — 删除该行。

- [ ] **Step 4: 删除其他 broadcastSSE 调用**

搜索 `broadcastSSE(` 在 http-server.ts 中，删除所有调用（`restarting`，`config-reloaded`，`ws-connection`/`ws-disconnection`（已在 ws-server.ts 中随文件删除））。

- [ ] **Step 5: pnpm build:handoff**

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/handoff-service/http-server.ts
git commit -m "refactor: remove SSE endpoint and broadcastSSE from http-server"
```

---

### Task 5: 清理 internal-http.ts — 删 /internal/events SSE

**Files:**
- Modify: `src/main/internal-http.ts:120-132`

- [ ] **Step 1: 删除 /internal/events SSE 端点**

删除 `GET /internal/events` 的处理块（约 13 行）：

```typescript
// 删除这些行:
    if (req.method === 'GET' && url === '/internal/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      res.write('event: connected\ndata: {}\n\n')
      sseClients.add(res)
      const cleanup = () => sseClients.delete(res)
      req.on('close', cleanup)
      req.on('error', cleanup)
      return
    }
```

- [ ] **Step 2: 删除 sseClients、broadcastInternalSSE**

删除 `sseClients` Set 和 `broadcastInternalSSE()` 函数（约 12 行）。

- [ ] **Step 3: 删除 transfer-record 中的 broadcastInternalSSE 调用**

删除 `POST /internal/transfer-record` handler 中的 `broadcastInternalSSE('transfer-recorded', record)` 行。

- [ ] **Step 4: 删除 paired-device 和 revoke-device 中的 broadcastInternalSSE 调用**

搜索并删除 `broadcastInternalSSE(` 在 internal-http.ts 中的所有调用。

- [ ] **Step 5: pnpm build**

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/internal-http.ts
git commit -m "refactor: remove /internal/events SSE from internal HTTP server"
```

---

### Task 6: 重写 handoff-ipc-client.ts — socket.io-client

**Files:**
- Modify: `src/main/handoff-ipc-client.ts`（整个文件重写）

- [ ] **Step 1: 读取当前文件，重写为 socket.io-client**

```typescript
import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let config = { port: 19528 }

export function loadHandoffConfig(cfg: { port?: number }): void {
  if (cfg.port) config.port = cfg.port
}

export function connectClient(onEvent: (event: string, data: unknown) => void): () => void {
  if (socket) socket.disconnect()

  socket = io(`http://127.0.0.1:${config.port}`, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    timeout: 10000
  })

  socket.on('connect', () => {
    console.log('[FRP Studio] socket.io connected')
    socket!.emit('auth', { role: 'admin' })
  })

  socket.on('auth:ok', () => {
    onEvent('connected', {})
  })

  socket.on('disconnect', (reason) => {
    console.log(`[FRP Studio] socket.io disconnected: ${reason}`)
  })

  socket.on('connect_error', (err) => {
    console.error(`[FRP Studio] socket.io error: ${err.message}`)
  })

  // Forward all admin events to renderer
  socket.on('device:paired', (data) => onEvent('device:paired', data))
  socket.on('device:revoked', (data) => onEvent('device:revoked', data))
  socket.on('transfer:recorded', (data) => onEvent('transfer:recorded', data))
  socket.on('config:reloaded', (data) => onEvent('config:reloaded', data))
  socket.on('service:error', (data) => onEvent('service:error', data))
  socket.on('clipboard', (data) => onEvent('clipboard', data))

  return () => {
    socket?.disconnect()
    socket = null
  }
}

export function getHealth(): Promise<{ status: string; uptime: number; connections: number; version: string }> {
  return new Promise((resolve) => {
    if (socket?.connected) {
      const engine = (socket.io as any).engine
      const serverInfo = {
        status: 'running',
        uptime: 0,
        connections: engine?.clientsCount ?? 0,
        version: '0.0.0'
      }
      resolve(serverInfo)
    } else {
      resolve({ status: 'stopped', uptime: 0, connections: 0, version: '0.0.0' })
    }
  })
}

export function stopClient(): void {
  socket?.disconnect()
  socket = null
}
```

注：删除原有的 `httpGet`、`httpPost`、`connectSSE`、`startHealthCheck`、`stopHealthCheck`、`getPairedDevices`、`notifyConfigChanged`、`restartService`、`generatePairingQR`、`confirmPairing`、`revokeDevice` 函数——这些要么已被 socket.io 替代，要么不再需要。

- [ ] **Step 2: pnpm build**

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/handoff-ipc-client.ts
git commit -m "refactor: replace SSE client with socket.io-client"
```

---

### Task 7: 简化 ipc/handoff.ts

**Files:**
- Modify: `src/main/ipc/handoff.ts`

- [ ] **Step 1: 更新导入**

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import {
  listTransferHistory,
  clearTransferHistory,
  listPairedDevices,
  deletePairedDevice
} from '../db'
import {
  startHandoffService,
  stopHandoffService,
  restartHandoffService,
  getServiceStatus,
  getServiceUptime
} from '../handoff-service-manager'
import { connectClient, stopClient } from '../handoff-ipc-client'
```

注：删除 `http` 导入、`getHealth`/`notifyConfigChanged`/`generatePairingQR`/`connectSSE`/`startHealthCheck`/`stopHealthCheck` 导入。

- [ ] **Step 2: 简化 service-status handler**

```typescript
  ipcMain.handle('handoff:service-status', async () => {
    return {
      status: getServiceStatus(),
      uptime: getServiceUptime()
    }
  })
```

- [ ] **Step 3: 简化 notify-config handler**

```typescript
  ipcMain.handle('handoff:notify-config', async () => {
    return { success: true }
  })
```

- [ ] **Step 4: 删除 generate-pairing handler**

删除 `ipcMain.handle('handoff:generate-pairing', ...)` —— 配对改为前端直接调用 HTTP POST `/pair/generate`（或在后续任务中加回为 HTTP proxy）。

保留 `handoff:generate-pairing` handler 但改为 HTTP proxy：

```typescript
  ipcMain.handle('handoff:generate-pairing', async (_e, deviceName: string, devicePublicKey: string) => {
    return new Promise((resolve) => {
      const body = JSON.stringify({ deviceName, devicePublicKey })
      const req = require('http').request({
        hostname: '127.0.0.1', port: 19528, path: '/pair/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
          catch { resolve({ success: false, error: 'parse error' }) }
        })
      })
      req.on('error', (e: Error) => resolve({ success: false, error: e.message }))
      req.write(body)
      req.end()
    })
  })
```

- [ ] **Step 5: 重写 connect-sse → connect-events**

```typescript
  let eventCleanup: (() => void) | null = null

  ipcMain.handle('handoff:connect-sse', async (event) => {
    const rendererWin = BrowserWindow.fromWebContents(event.sender)
    if (!rendererWin) return

    if (eventCleanup) eventCleanup()

    eventCleanup = connectClient((evt, data) => {
      if (rendererWin.isDestroyed()) return
      rendererWin.webContents.send('handoff:event', { event: evt, data })
    })
  })

  ipcMain.handle('handoff:disconnect-sse', async () => {
    if (eventCleanup) {
      eventCleanup()
      eventCleanup = null
    }
  })
```

- [ ] **Step 6: 保留其他 handler 不变**

保留 `list-devices`、`delete-device`、`transfer-history`、`clear-history`、`clipboard-get`、`clipboard-send`、`start-service`、`stop-service`、`restart-service` —— 这些不依赖 SSE。

- [ ] **Step 7: pnpm build**

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/handoff.ts
git commit -m "refactor: simplify IPC handlers for socket.io migration"
```

---

### Task 8: iOS ConnectionManager.swift — SocketIOClient

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift`

- [ ] **Step 1: 删除 WebSocket + 心跳相关代码**

删除以下属性和方法：
- `webSocketTask`、`reconnectAttempts`、`maxReconnectDelay`、`heartbeatTimer`、`isWebSocketConnected` 属性
- `connectWebSocket()`、`receiveWSMessage()`、`scheduleReconnect()`、`handleWSMessage()`、`handleWSBinary()` 方法
- `startHeartbeat()`、`stopHeartbeat()`、`checkHealth()`、`updateDeviceConnectionStatus()` 方法
- `sendRegister()` HTTP 方法
- `baseURL` didSet 中的 `connectWebSocket()` 和 `startHeartbeat()` 调用

- [ ] **Step 2: 添加 SocketIOClient 属性和连接**

```swift
import SocketIO

class ConnectionManager: ObservableObject {
    // ... 保留现有属性 ...

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    func connectSocketIO(host: String, port: Int) {
        guard let url = URL(string: "http://\(host):\(port)") else { return }
        manager = SocketManager(socketURL: url, config: [
            .log(false),
            .reconnects(true),
            .reconnectWait(1),
            .reconnectWaitMax(15),
            .extraHeaders(["User-Agent": "Handoff-iOS"])
        ])
        socket = manager?.defaultSocket

        socket?.on(clientEvent: .connect) { [weak self] data, ack in
            self?.logger.info("socket.io 已连接")
            self?.updateDeviceConnectionStatus(true)
            // Authenticate
            self?.socket?.emit("auth", [
                "deviceId": self?.deviceId ?? "",
                "deviceName": UIDevice.current.name,
                "platform": "ios"
            ])
        }

        socket?.on("auth:ok") { [weak self] data, ack in
            self?.logger.info("设备已注册: \(self?.deviceId ?? "")")
        }

        socket?.on("clipboard") { [weak self] data, ack in
            guard let self = self,
                  let items = data as? [[String: Any]],
                  let msg = items.first else { return }
            let payload = msg["payload"] as? String ?? ""
            let hash = msg["hash"] as? String ?? ""
            if !payload.isEmpty && hash != self.lastRemoteClipboardHash {
                let now = Date()
                if now.timeIntervalSince(self.lastLocalCopyTime) > 2.0 {
                    self.lastRemoteClipboardHash = hash
                    UIPasteboard.general.string = payload
                    self.clipboardContent = payload
                    self.logger.info("剪贴板已同步 (\(payload.count) 字符)")
                }
            }
        }

        socket?.on(clientEvent: .disconnect) { [weak self] data, ack in
            self?.logger.info("socket.io 断开")
            self?.updateDeviceConnectionStatus(false)
        }

        socket?.on(clientEvent: .error) { [weak self] data, ack in
            self?.logger.error("socket.io 错误: \(data)")
        }

        socket?.connect()
    }

    func sendClipboardViaSocket(_ text: String) {
        lastLocalCopyTime = Date()
        socket?.emit("clipboard", ["payload": text])
        logger.info("剪贴板已发送 (\(text.count) 字符)")
    }
```

- [ ] **Step 3: 修改 baseURL didSet**

```swift
var baseURL: String = "" {
    didSet {
        if !baseURL.isEmpty {
            startPolling()
            let parts = baseURL.split(separator: ":")
            if parts.count == 2, let port = Int(parts[1]) {
                connectSocketIO(host: String(parts[0]), port: port)
            }
        } else {
            stopPolling()
            socket?.disconnect()
            socket = nil
        }
    }
}
```

- [ ] **Step 4: 修改 sendClipboard() 调用 sendClipboardViaSocket()**

原 `sendClipboard` 的 HTTP POST 方式改为 socket.io emit。

- [ ] **Step 5: Commit**

```bash
git add ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift
git commit -m "refactor: iOS URLSessionWebSocketTask → SocketIOClient (~140 lines removed)"
```

---

### Task 9: 最终验证

- [ ] **Step 1: 构建 HandoffService**

```bash
pnpm build:handoff
```

Expected: PASS, 无错误

- [ ] **Step 2: 构建主进程 + 渲染进程**

```bash
pnpm build
```

Expected: PASS, 安装包生成

- [ ] **Step 3: 验证无残留引用**

```bash
git grep "ws-server" src/ && echo "FOUND STALE REFS" || echo "Clean"
git grep "broadcastSSE" src/ && echo "FOUND STALE REFS" || echo "Clean"
git grep "broadcastInternalSSE" src/ && echo "FOUND STALE REFS" || echo "Clean"
git grep "sseClients" src/ && echo "FOUND STALE REFS" || echo "Clean"
git grep "connectSSE" src/main/ && echo "FOUND STALE REFS" || echo "Clean"
```

Expected: all "Clean"

- [ ] **Step 4: Commit 最终清理**

```bash
git add -A
git commit -m "chore: final cleanup, verify no residual SSE references"
```

---

### 最终验证 checklist

```
pnpm dev:full
  → HandoffService 启动 → 日志: "socket.io server attached"
  → 主进程连接 → 日志: "socket.io connected" / "Admin authenticated"
  → 诊断页 → 事件日志: "内部 SSE 已连接" 改为 "[debug] connected: {}"
  → curl http://127.0.0.1:19528/health → {"status":"running",...}
  → 生成配对码 → iOS 扫码 → 设备管理页自动出现设备
  → 剪贴板双向同步正常
  → 传输记录自动刷新
  → Ctrl+C → 进程全部退出，端口释放
```
