# Handoff 模块深度优化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Handoff 模块 5 个核心问题：剪贴板双向自动同步、Bonjour 自动发现与保活、设备管理 SQLite 重构、传输记录写入、编码乱码修复。

**Architecture:** 恢复 iOS WebSocket 长连接用于 Windows→iOS 剪贴板实时推送（hash 去重 + 本地操作保护）；新增主进程内部 HTTP server (127.0.0.1:19529) 供 HandoffService 回调写入传输记录和查询设备列表；设备管理从 handoff.json 迁移到 SQLite 为唯一真实来源。

**Tech Stack:** TypeScript (Electron main + HandoffService Node.js), Swift (iOS), SQLite (sql.js), WebSocket (ws)

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/handoff-service/clipboard.ts` | 剪贴板读写 + 哈希缓存 + PowerShell UTF-8 编码 |
| `src/handoff-service/http-server.ts` | HTTP 端点 + SSE + 内部回调主进程 |
| `src/handoff-service/ws-server.ts` | WebSocket 管理 + 客户端追踪 + 定向广播 |
| `src/handoff-service/index.ts` | HandoffService 入口，注册 WS handler |
| `src/handoff-service/mdns.ts` | mDNS 广播（动态版本号） |
| `src/main/internal-http.ts` | **新建** — 内部 HTTP server (127.0.0.1:19529) |
| `src/main/ipc/handoff.ts` | IPC handler：设备 CRUD 直读 SQLite、新增 confirm-pairing |
| `src/main/handoff-ipc-client.ts` | HTTP 客户端（Buffer 数组修复） |
| `src/main/handoff-service-manager.ts` | 子进程管理（spawn env UTF-8） |
| `src/renderer/src/stores/handoff.ts` | Pinia store：SSE 事件新增 |
| `src/renderer/src/components/PairingQRModal.vue` | 配对码生成（移除 placeholder-key） |
| `ios/.../DiscoveryService.swift` | Bonjour 浏览 — 改为单例 |
| `ios/.../ConnectionManager.swift` | 连接管理 — WebSocket/心跳/去重/RSA/confirm |
| `ios/.../ClipboardService.swift` | 剪贴板 — 新增 changeCount 检测 |
| `ios/.../ContentView.swift` | UI — 发现设备 + 在线状态 |
| `ios/.../Device.swift` | 数据模型 — 新增字段 |

---

### Task 1: 编码乱码修复（HandoffService + 主进程）

**Files:**
- Modify: `src/handoff-service/clipboard.ts:17-19`
- Modify: `src/handoff-service/http-server.ts:36-38`
- Modify: `src/main/handoff-ipc-client.ts:12-18` (httpGet), `:24-36` (httpPost)
- Modify: `src/main/ipc/handoff.ts:98-106` (clipboard-get), `:110-127` (clipboard-send)
- Modify: `src/main/handoff-service-manager.ts:63-67`

- [ ] **Step 1: clipboard.ts — PowerShell UTF-8 输出**

修改 `getClipboardText()` 函数 (line 17-19)，在 PowerShell 命令前设置 OutputEncoding：

```typescript
async function getClipboardText(): Promise<string> {
  return execPowerShell('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Format Text')
}
```

- [ ] **Step 2: http-server.ts — charset=utf-8 响应头**

修改 `handleRequest()` 函数中所有 `res.writeHead` 的 Content-Type 行 (lines 36-38 附近及各处)：

```typescript
res.setHeader('Access-Control-Allow-Origin', '*')
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
res.setHeader('Content-Type', 'application/json; charset=utf-8')  // 替换之前各端点内的单独设置
```

将原来每个端点里的 `res.writeHead(200, { 'Content-Type': 'application/json' })` 统一改为不带 Content-Type（已在 setHeader 预设），或逐个改为 `'application/json; charset=utf-8'`。

- [ ] **Step 3: handoff-ipc-client.ts — Buffer 数组累加**

修改 `httpGet()` 和 `httpPost()` 中的数据接收方式：

`httpGet()` (line 12-18) 改为：

```typescript
async function httpGet(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${config.port}${path}`, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    }).on('error', reject)
  })
}
```

`httpPost()` (line 24-36) 中 `res.on('data')` / `res.on('end')` 同方式修改。

- [ ] **Step 4: ipc/handoff.ts — Buffer 数组累加**

`clipboard-get` handler (line 98-106) 中 `res.on('data')` / `res.on('end')` 同 Task 1 Step 3 方式修改。

`clipboard-send` handler (line 110-127) 中 `res.on('data')` / `res.on('end')` 同方式修改。

- [ ] **Step 5: handoff-service-manager.ts — spawn env UTF-8**

修改 `spawn` 调用 (line 63-67)，添加 env 变量：

```typescript
serviceProcess = spawn('node', [jsPath, userDataPath], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, LC_ALL: 'en_US.UTF-8' }
})
```

- [ ] **Step 6: 验证编码修复**

Run: `pnpm dev:full`
Verification:
1. 在 Windows 复制中文文本
2. 诊断页 → 获取 Windows 剪贴板 → 中文应正常显示
3. HandoffService 日志中中文应正常显示

Commit:
```bash
git add src/handoff-service/clipboard.ts src/handoff-service/http-server.ts src/main/handoff-ipc-client.ts src/main/ipc/handoff.ts src/main/handoff-service-manager.ts
git commit -m "fix: UTF-8 encoding for clipboard, HTTP responses, and spawn env"
```

---

### Task 2: WebSocket 剪贴板推送 + hash 去重 + 来源排除

**Files:**
- Modify: `src/handoff-service/ws-server.ts:64-77` (broadcastToAll + 客户端 ID 追踪)
- Modify: `src/handoff-service/index.ts:56-63` (clipboard handler 带 clientId)
- Modify: `src/handoff-service/index.ts:72-74` (startClipboardWatcher 回调)

- [ ] **Step 1: ws-server.ts — 客户端 ID 映射 + broadcastToAll excludeClientId**

修改 `ws-server.ts`：

```typescript
let wss: WebSocketServer | null = null
const connectedClients: Map<string, WebSocket> = new Map()
const clientIdByWs: WeakMap<WebSocket, string> = new WeakMap()  // 新增：反向映射
```

`wss.on('connection', ...)` 中添加反向映射：

```typescript
wss.on('connection', (ws, _req) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  connectedClients.set(clientId, ws)
  clientIdByWs.set(ws, clientId)  // 新增
  // ... rest unchanged
})
```

`ws.on('close', ...)` 和 `ws.on('error', ...)` 中清理 `clientIdByWs.delete(ws)`。

`broadcastToAll()` 改为：

```typescript
export function broadcastToAll(type: string, data: Record<string, unknown>, excludeClientId?: string): void {
  const payload = JSON.stringify({ type, ...data })
  for (const [id, ws] of connectedClients.entries()) {
    if (id === excludeClientId) continue
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}
```

新增导出：

```typescript
export function getClientId(ws: WebSocket): string | undefined {
  return clientIdByWs.get(ws)
}
```

- [ ] **Step 2: index.ts — clipboard WS handler 使用 clientId 排除**

修改 `index.ts` 中 `clipboard` handler (line 56-63)：

```typescript
registerHandler('clipboard', (ws, msg) => {
  const { writeClipboard } = require('./clipboard')
  const { getClientId, broadcastToAll } = require('./ws-server')
  const payload = (msg as { payload: string }).payload
  if (payload && typeof payload === 'string' && payload.length > 0) {
    writeClipboard(payload)
    const sourceId = getClientId(ws)
    broadcastToAll('clipboard', { payload, hash: '', sourceId }, sourceId)
    console.log(`[HandoffService] Clipboard received from iOS (${payload.length} chars)`)
  }
})
```

- [ ] **Step 3: index.ts — startClipboardWatcher 回调带 hash + exclude**

修改 `startClipboardWatcher` 回调 (line 72-74)：

```typescript
const { broadcastToAll } = await import('./ws-server')
startClipboardWatcher((content) => {
  const { getLatestClipboard } = require('./clipboard')
  const { hash } = getLatestClipboard()
  broadcastToAll('clipboard', { payload: content, hash, timestamp: Date.now() })
})
```

- [ ] **Step 4: 验证**

Run: `pnpm dev:full`
Verification:
1. 启动后检查 HandoffService 日志中 "Clipboard watcher started"
2. 在 Windows 复制文本，确认日志中 broadcast 事件
3. WebSocket 客户端连接后应能收到 clipboard 消息

Commit:
```bash
git add src/handoff-service/ws-server.ts src/handoff-service/index.ts
git commit -m "feat: WebSocket clipboard push with hash dedup and source exclusion"
```

---

### Task 3: 主进程内部 HTTP server (127.0.0.1:19529)

**Files:**
- Create: `src/main/internal-http.ts`
- Modify: `src/main/index.ts:14` (import + 启动)

- [ ] **Step 1: 创建 internal-http.ts**

创建 `src/main/internal-http.ts`：

```typescript
import http from 'http'
import { addTransferHistory, listPairedDevices, addPairedDevice } from './db'

let server: http.Server | null = null
let sseClients: Set<http.ServerResponse> = new Set()

export function broadcastInternalSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    client.write(payload)
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || '/'
  let body = ''
  req.on('data', (chunk: Buffer) => { body += chunk.toString('utf-8') })

  req.on('end', () => {
    // GET /internal/devices — 供 HandoffService 查询已配对设备
    if (req.method === 'GET' && url === '/internal/devices') {
      const devices = listPairedDevices().map((d) => ({
        deviceId: d.device_id,
        deviceName: d.device_name,
        publicKey: d.public_key,
        enabled: !!d.enabled
      }))
      res.writeHead(200)
      res.end(JSON.stringify(devices))
      return
    }

    // POST /internal/transfer-record — HandoffService 写传输记录
    if (req.method === 'POST' && url === '/internal/transfer-record') {
      try {
        const { deviceId, type, direction, detail, size, status } = JSON.parse(body || '{}')
        // 查找 device_id 对应的内部 id
        const devices = listPairedDevices()
        const device = devices.find((d) => d.device_id === deviceId)
        const record = addTransferHistory({
          device_id: device?.id || 0,
          type: type || 'clipboard',
          direction: direction || 'send',
          detail: detail || '',
          size: size || 0,
          status: status || 'success'
        })
        broadcastInternalSSE('transfer-recorded', record)
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    // POST /internal/paired-device — 配对确认时写入 SQLite
    if (req.method === 'POST' && url === '/internal/paired-device') {
      try {
        const { deviceId, deviceName, publicKey, platform } = JSON.parse(body || '{}')
        const existing = listPairedDevices().find((d) => d.device_id === deviceId)
        if (!existing) {
          addPairedDevice({
            device_id: deviceId,
            device_name: deviceName,
            platform: platform || 'ios',
            public_key: publicKey
          })
        }
        broadcastInternalSSE('device-paired', { deviceId, deviceName })
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    // GET /internal/events — SSE 供主进程 IPC 转发
    if (req.method === 'GET' && url === '/internal/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      res.write('event: connected\ndata: {}\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  })
}

export function startInternalHTTPServer(): void {
  server = http.createServer(handleRequest)
  server.listen(19529, '127.0.0.1', () => {
    console.log('[FRP Studio] Internal HTTP server on 127.0.0.1:19529')
  })
}

export function stopInternalHTTPServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
```

- [ ] **Step 2: index.ts — 启动/停止内部 server**

在 `src/main/index.ts` 顶部添加 import：

```typescript
import { startInternalHTTPServer, stopInternalHTTPServer } from './internal-http'
```

在 `app.whenReady()` 中 `startHandoffService()` 之后添加：

```typescript
startInternalHTTPServer()
```

在 `app.on('will-quit', ...)` 回调中添加：

```typescript
app.on('will-quit', () => {
  frpcManager.stopAll()
  stopHandoffService()
  stopInternalHTTPServer()
})
```

- [ ] **Step 3: 编译验证**

Run: `pnpm build:handoff`
Expected: 编译成功

Run: `pnpm dev:full`
Verification: 主进程日志显示 "Internal HTTP server on 127.0.0.1:19529"

Commit:
```bash
git add src/main/internal-http.ts src/main/index.ts
git commit -m "feat: internal HTTP server for HandoffService callbacks"
```

---

### Task 4: 设备管理重构 — SQLite 为主

**Files:**
- Modify: `src/main/ipc/handoff.ts:55-66` (list-devices, delete-device)
- Modify: `src/main/ipc/handoff.ts` (新增 confirm-pairing handler)
- Modify: `src/handoff-service/http-server.ts` (/pair/confirm 回调主进程)
- Modify: `src/handoff-service/config.ts:23-28` (移除 HandoffConfig.pairedDevices)
- Modify: `src/handoff-service/http-server.ts:82-195` (/devices 废弃, /pair/confirm 改为回调)

- [ ] **Step 1: config.ts — 移除 pairedDevices**

修改 `src/handoff-service/config.ts`：

```typescript
const defaultConfig: HandoffConfig = {
  server: { port: 19528, bindAddress: '0.0.0.0' },
  device: { name: 'My-Windows-PC', downloadDir: '' },
  features: { clipboardSync: true, fileTransfer: true, clipboardMaxSize: 1048576 },
  frpTunnel: { enabled: false, nodeId: null, remotePort: 19528 }
  // 删除 pairedDevices: []
}
```

删除 `HandoffConfig` 接口中的 `pairedDevices` 字段 (line 23-28)。

`loadConfig()` 中删除 `pairedDevices` 相关逻辑。如 `handoff.json` 中存在旧 `pairedDevices` 字段，迁移打印警告但不保留：

```typescript
if (parsed.pairedDevices && parsed.pairedDevices.length > 0) {
  console.log(`[HandoffService] Found ${parsed.pairedDevices.length} legacy paired devices in config — migrating to main process is handled separately`)
}
```

- [ ] **Step 2: http-server.ts — /pair/confirm 回调主进程**

修改 `/pair/confirm` 处理函数中写文件的部分 (line 165-172)，替换为内部 HTTP 回调：

```typescript
// 替换原来的 fs.writeFileSync(configPath, ...) 块
const postData = JSON.stringify({
  deviceId: deviceInfo?.deviceId || pending.publicKey.slice(0, 16),
  deviceName: pending.deviceName,
  publicKey: pending.publicKey,
  platform: deviceInfo?.platform || 'ios'
})
const req = http.request({
  hostname: '127.0.0.1', port: 19529, path: '/internal/paired-device',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
}, (cbRes) => {
  let cbData = ''
  cbRes.on('data', (c: Buffer) => { cbData += c.toString('utf-8') })
  cbRes.on('end', () => {
    try { const result = JSON.parse(cbData); console.log('[HandoffService] Device saved to main process:', result) }
    catch { /* ignore */ }
  })
})
req.on('error', (e) => console.error('[HandoffService] Failed to save device to main process:', e.message))
req.write(postData)
req.end()

broadcastSSE('device-paired', { deviceName: pending.deviceName })
res.writeHead(200, { 'Content-Type': 'application/json' })
res.end(JSON.stringify({ success: true }))
```

确保文件顶部已 import `http`：

```typescript
import http from 'http'
```

- [ ] **Step 3: http-server.ts — 废弃 /devices 端点**

将 `/devices` 端点 (line 82-88) 改为代理主进程：

```typescript
// List paired devices — 代理到主进程 SQLite
if (req.method === 'GET' && url === '/devices') {
  http.get('http://127.0.0.1:19529/internal/devices', (proxyRes) => {
    let data = ''
    proxyRes.on('data', (c: Buffer) => { data += c.toString('utf-8') })
    proxyRes.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(data)
    })
  }).on('error', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('[]')
  })
  return
}
```

- [ ] **Step 4: ipc/handoff.ts — list-devices 直读 SQLite**

将 `handoff:list-devices` handler (line 55-61) 改为：

```typescript
ipcMain.handle('handoff:list-devices', async () => {
  const { listPairedDevices } = require('../db')
  return listPairedDevices().map((d) => ({
    deviceId: d.device_id,
    deviceName: d.device_name,
    publicKey: d.public_key,
    enabled: !!d.enabled
  }))
})
```

- [ ] **Step 5: ipc/handoff.ts — delete-device 直删 SQLite**

将 `handoff:delete-device` handler (line 63-66) 改为：

```typescript
ipcMain.handle('handoff:delete-device', async (_e, deviceId: string) => {
  const { listPairedDevices, deletePairedDevice } = require('../db')
  const device = listPairedDevices().find((d) => d.device_id === deviceId)
  if (device) {
    deletePairedDevice(device.id)
    return { success: true }
  }
  return { success: false }
})
```

- [ ] **Step 6: ipc/handoff.ts — 连接内部 SSE 事件**

修改 `handoff:connect-sse` handler。在现有 `connectSSE()` 调用之外，同时连接内部 HTTP server 的 SSE：

```typescript
ipcMain.handle('handoff:connect-sse', async (event) => {
  const rendererWin = BrowserWindow.fromWebContents(event.sender)
  if (!rendererWin) return

  if (sseCleanup) sseCleanup()

  sseCleanup = connectSSE((evt, data) => {
    if (rendererWin.isDestroyed()) return
    rendererWin.webContents.send('handoff:event', { event: evt, data })
  })

  // 同时连接内部 HTTP server 的 SSE (transfer-recorded, device-paired)
  const internalReq = http.get('http://127.0.0.1:19529/internal/events', (res) => {
    let buffer = ''
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      let currentEvent = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (rendererWin.isDestroyed()) return
            rendererWin.webContents.send('handoff:event', { event: currentEvent, data })
          } catch { /* ignore */ }
        }
      }
    })
  })
  internalReq.on('error', () => { /* internal SSE not critical */ })

  startHealthCheck((status) => {
    if (rendererWin.isDestroyed()) return
    if (status !== lastServiceStatus) {
      lastServiceStatus = status
      rendererWin.webContents.send('handoff:service-status-change', { status })
    }
  })
})
```

- [ ] **Step 7: 编译验证**

Run: `pnpm build:handoff && pnpm build`

Commit:
```bash
git add src/main/ipc/handoff.ts src/handoff-service/http-server.ts src/handoff-service/config.ts
git commit -m "refactor: device management to SQLite as single source of truth"
```

---

### Task 5: 传输记录写入 + SSE 推送

**Files:**
- Modify: `src/handoff-service/clipboard.ts:25-53` (startClipboardWatcher — 写入后回调)
- Modify: `src/handoff-service/http-server.ts:225-247` (/clipboard — 写入后回调)
- Modify: `src/renderer/src/stores/handoff.ts:83-99` (connectSSE — 处理 transfer-recorded 事件)

- [ ] **Step 1: clipboard.ts — writeClipboard 后通知主进程**

新增辅助函数 `notifyTransferRecord()`：

```typescript
import http from 'http'

function notifyTransferRecord(type: string, direction: string, detail: string, size: number): void {
  const body = JSON.stringify({ type, direction, detail, size, status: 'success' })
  const req = http.request({
    hostname: '127.0.0.1', port: 19529, path: '/internal/transfer-record',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, () => {})
  req.on('error', () => { /* internal server may not be running */ })
  req.write(body)
  req.end()
}
```

在 `startClipboardWatcher` 的 `onChange` 回调中，调用 `broadcastToAll` 之后：

```typescript
notifyTransferRecord('clipboard', 'send', content.slice(0, 100), content.length)
```

- [ ] **Step 2: http-server.ts — iOS 剪贴板写入后通知**

在 `/clipboard` POST handler 中 `writeClipboard(payload)` 之后，添加内部回调：

```typescript
const recordBody = JSON.stringify({
  type: 'clipboard', direction: 'receive', detail: payload.slice(0, 100), size: payload.length, status: 'success'
})
const recordReq = http.request({
  hostname: '127.0.0.1', port: 19529, path: '/internal/transfer-record',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(recordBody) }
}, () => {})
recordReq.on('error', () => {})
recordReq.write(recordBody)
recordReq.end()
```

- [ ] **Step 3: stores/handoff.ts — SSE 新增 transfer-recorded**

在 `connectSSE()` 函数 (line 83-99) 的事件处理中新增：

```typescript
} else if (event === 'transfer-recorded') {
  // 追加新记录到列表头部
  const record = data as TransferRecord
  transferHistory.value.unshift(record)
}
```

- [ ] **Step 4: 验证**

Run: `pnpm dev:full`
Verification:
1. 诊断页 → 发送剪贴板测试文本
2. 切换到传输记录页 → 应显示一条记录

Commit:
```bash
git add src/handoff-service/clipboard.ts src/handoff-service/http-server.ts src/renderer/src/stores/handoff.ts
git commit -m "feat: transfer history recording via internal HTTP callback"
```

---

### Task 6: mDNS 动态版本号

**Files:**
- Modify: `src/handoff-service/mdns.ts:43-44`

- [ ] **Step 1: mdns.ts — 动态读取 VERSION**

```typescript
function getVersion(): string {
  try {
    const fs = require('fs')
    const path = require('path')
    const versionPath = path.join(process.cwd(), 'VERSION')
    if (fs.existsSync(versionPath)) {
      return fs.readFileSync(versionPath, 'utf-8').trim()
    }
  } catch { /* fall through */ }
  return '0.1.0'
}
```

修改 TXT record 的 version 字段 (line 43-44)：

```typescript
data: Buffer.from(JSON.stringify({
  deviceName: deviceName,
  platform: 'windows',
  version: getVersion()
}))
```

- [ ] **Step 2: 编译验证**

Run: `pnpm build:handoff`

Commit:
```bash
git add src/handoff-service/mdns.ts
git commit -m "fix: dynamic version in mDNS TXT record from VERSION file"
```

---

### Task 7: 渲染进程修复

**Files:**
- Modify: `src/renderer/src/components/PairingQRModal.vue:42`
- Modify: `src/renderer/src/stores/handoff.ts:83-99`

- [ ] **Step 1: PairingQRModal.vue — 移除 placeholder-key**

将 `generateQR()` (line 42)：

```typescript
// Before:
const result = await store.generatePairing('My iPhone', 'placeholder-key')
// After — publicKey 由 HandoffService 自己生成，前端不传：
const result = await store.generatePairing('My iPhone', '')
```

- [ ] **Step 2: ipc/handoff.ts — generate-pairing handler 适配空 publicKey**

确认 `handoff:generate-pairing` handler (line 75-81) 可接受空 publicKey，HandoffService 的 `/pair/generate` 收到空 publicKey 时使用服务端自己的 publicKey：

`http-server.ts` 的 `/pair/generate` 端点 (line 109-136) 修改：

```typescript
const { deviceName, devicePublicKey } = JSON.parse(body)
const { generatePairRequest, getDeviceIdentity } = require('./pairing')
const effectivePublicKey = devicePublicKey || getDeviceIdentity().publicKey
const result = generatePairRequest(deviceName, effectivePublicKey)
```

- [ ] **Step 3: stores/handoff.ts — SSE 事件处理完整化**

确认 `connectSSE()` 中已处理 `device-paired`、`device-revoked`、`transfer-recorded`、`config-reloaded` 事件（Task 5 已添加 transfer-recorded 处理）。

- [ ] **Step 4: 验证**

Run: `pnpm dev:full`
Verification: 设备管理页 → 生成配对码 → 二维码正常显示

Commit:
```bash
git add src/renderer/src/components/PairingQRModal.vue src/renderer/src/stores/handoff.ts src/handoff-service/http-server.ts
git commit -m "fix: remove placeholder-key from pairing flow"
```

---

### Task 8: iOS — DiscoveryService 单例化 + App 启动

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/DiscoveryService.swift:1-34`
- Modify: `ios/HandoffApp/HandoffApp/App.swift:8-23`
- Modify: `ios/HandoffApp/HandoffApp/Views/ContentView.swift:1-99`

- [ ] **Step 1: DiscoveryService.swift — 改为单例 + ObservableObject**

重写 `DiscoveryService.swift`：

```swift
import Foundation

class DiscoveryService: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    static let shared = DiscoveryService()

    @Published var discoveredDevices: [DiscoveredDevice] = []

    private var browser: NetServiceBrowser?
    private var resolvingServices: Set<NetService> = []
    private let logger = DebugLogger.shared

    override private init() {
        super.init()
    }

    func startBrowsing() {
        logger.info("Bonjour 浏览器启动: _handoff._tcp.")
        browser = NetServiceBrowser()
        browser?.delegate = self
        browser?.searchForServices(ofType: "_handoff._tcp.", inDomain: "local.")
    }

    func stopBrowsing() {
        browser?.stop()
        browser = nil
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        logger.info("发现服务: \(service.name)")
        service.delegate = self
        resolvingServices.insert(service)
        service.resolve(withTimeout: 5)
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        discoveredDevices.removeAll { $0.name == service.name }
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        defer { resolvingServices.remove(sender) }
        guard let hostName = sender.hostName else { return }
        let port = sender.port
        let txtData = NetService.dictionary(fromTXTRecord: sender.txtRecordData() ?? Data())
        var info: [String: String] = [:]
        for (key, value) in txtData {
            info[key] = String(data: value, encoding: .utf8)
        }
        let device = DiscoveredDevice(
            name: info["deviceName"] ?? sender.name,
            host: hostName,
            port: UInt16(port),
            platform: info["platform"] ?? "unknown",
            version: info["version"] ?? "?"
        )
        // 去重
        if !discoveredDevices.contains(where: { $0.host == hostName && $0.port == port }) {
            DispatchQueue.main.async { [weak self] in
                self?.discoveredDevices.append(device)
                self?.logger.info("设备已发现: \(device.name) @ \(hostName):\(port)")
            }
        }
    }

    func connectToDevice(_ device: DiscoveredDevice) {
        // 将由 ConnectionManager 处理
        NotificationCenter.default.post(name: .discoveryDidSelectDevice, object: device)
    }
}

struct DiscoveredDevice: Identifiable {
    var id: String { "\(host):\(port)" }
    let name: String
    let host: String
    let port: UInt16
    let platform: String
    let version: String
}

extension Notification.Name {
    static let discoveryDidSelectDevice = Notification.Name("discoveryDidSelectDevice")
}
```

- [ ] **Step 2: Device.swift — 新增字段**

```swift
struct PairedDevice: Identifiable, Codable {
    var id: String { deviceId }
    let deviceId: String
    var name: String
    let platform: String
    var isConnected: Bool = false
    var lastSeen: Date = Date()
    var host: String = ""
    var port: UInt16 = 19528

    var status: String {
        isConnected ? "在线" : "离线"
    }
}
```

- [ ] **Step 3: App.swift — 启动发现 + 注入**

```swift
@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared

    init() {
        logger.info("HandoffApp 启动")
        DiscoveryService.shared.startBrowsing()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
                .environmentObject(discoveryService)
                .environmentObject(logger)
        }
    }
}
```

- [ ] **Step 4: 构建验证**

Run CI: 手动触发 `ios-build.yml`
Verification: IPA 构建成功

Commit:
```bash
git add ios/HandoffApp/HandoffApp/Services/DiscoveryService.swift ios/HandoffApp/HandoffApp/App.swift ios/HandoffApp/HandoffApp/Models/Device.swift
git commit -m "feat: iOS DiscoveryService singleton with Bonjour browsing on startup"
```

---

### Task 9: iOS — WebSocket 重连 + 心跳保活

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift:1-242`

- [ ] **Step 1: ConnectionManager.swift — WebSocket 连接 + 自动重连**

新增属性：

```swift
private var webSocketTask: URLSessionWebSocketTask?
private var reconnectAttempts = 0
private let maxReconnectDelay: TimeInterval = 30
private var heartbeatTimer: Timer?
private var isWebSocketConnected = false
```

新增 `connectWebSocket()` 方法：

```swift
private func connectWebSocket() {
    guard !baseURL.isEmpty else { return }
    let wsURL = URL(string: "ws://\(baseURL)")!
    logger.info("WebSocket 连接: \(wsURL.absoluteString)")
    webSocketTask = session.webSocketTask(with: wsURL)
    webSocketTask?.resume()
    receiveWSMessage()
}

private func receiveWSMessage() {
    webSocketTask?.receive { [weak self] result in
        switch result {
        case .success(let message):
            self?.reconnectAttempts = 0
            if !self!.isWebSocketConnected {
                self?.isWebSocketConnected = true
                self?.updateDeviceConnectionStatus(true)
            }
            switch message {
            case .string(let text):
                self?.handleWSMessage(text)
            case .data(let data):
                self?.handleWSBinary(data)
            @unknown default: break
            }
            self?.receiveWSMessage()
        case .failure(let error):
            self?.logger.error("WebSocket 断开: \(error.localizedDescription)")
            self?.isWebSocketConnected = false
            self?.updateDeviceConnectionStatus(false)
            self?.scheduleReconnect()
        }
    }
}

private func scheduleReconnect() {
    let delay = min(5.0 * pow(2.0, Double(reconnectAttempts)), maxReconnectDelay)
    reconnectAttempts += 1
    logger.info("WebSocket 重连: \(Int(delay))s 后 (第 \(reconnectAttempts) 次)")
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.connectWebSocket()
    }
}

private func handleWSMessage(_ text: String) {
    guard let data = text.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = json["type"] as? String else {
        logger.warn("WebSocket 消息解析失败")
        return
    }

    DispatchQueue.main.async {
        switch type {
        case "clipboard":
            let payload = json["payload"] as? String ?? ""
            let hash = json["hash"] as? String ?? ""
            if !payload.isEmpty && hash != self.lastRemoteClipboardHash {
                let now = Date()
                if now.timeIntervalSince(self.lastLocalCopyTime) > 2.0 {
                    self.lastRemoteClipboardHash = hash
                    UIPasteboard.general.string = payload
                    self.logger.info("远程剪贴板已同步 (\(payload.count) 字符)")
                }
            }
        case "file:offer":
            if let filename = json["filename"] as? String,
               let size = json["size"] as? Int {
                self.logger.info("收到文件传输请求: \(filename) (\(size) bytes)")
            }
        default:
            self.logger.debug("未处理的消息类型: \(type)")
        }
    }
}

private func handleWSBinary(_ data: Data) {
    logger.debug("收到二进制数据: \(data.count) bytes")
}
```

- [ ] **Step 2: ConnectionManager.swift — 心跳保活**

新增心跳逻辑：

```swift
private func startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
        self?.checkHealth()
    }
}

private func stopHeartbeat() {
    heartbeatTimer?.invalidate()
    heartbeatTimer = nil
}

private func checkHealth() {
    guard !baseURL.isEmpty else { return }
    let url = URL(string: "http://\(baseURL)/health")!
    URLSession.shared.dataTask(with: url) { [weak self] _, response, error in
        DispatchQueue.main.async {
            if error == nil, let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 {
                self?.updateDeviceConnectionStatus(true)
            } else {
                self?.updateDeviceConnectionStatus(false)
            }
        }
    }.resume()
}

private func updateDeviceConnectionStatus(_ connected: Bool) {
    if let idx = pairedDevices.firstIndex(where: { $0.deviceId == currentDeviceId }) {
        pairedDevices[idx].isConnected = connected
        pairedDevices[idx].lastSeen = connected ? Date() : pairedDevices[idx].lastSeen
        saveDevices()
    }
}
```

- [ ] **Step 3: ConnectionManager.swift — baseURL didSet 联动**

修改 `baseURL` 的 `didSet`：

```swift
var baseURL: String = "" {
    didSet {
        if !baseURL.isEmpty {
            startPolling()
            startHeartbeat()
            connectWebSocket()
        } else {
            stopPolling()
            stopHeartbeat()
        }
    }
}
```

同时把 `currentDeviceId` 属性添加，在 `handleQRCode` 中设置。

- [ ] **Step 4: 构建验证**

Run CI: 手动触发 `ios-build.yml`
Verification: IPA 构建成功

Commit:
```bash
git add ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift
git commit -m "feat: iOS WebSocket reconnect, heartbeat keepalive, clipboard hash dedup"
```

---

### Task 10: iOS — 剪贴板 changeCount + RSA 密钥对 + /pair/confirm

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/ClipboardService.swift:1-14`
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift:81-141` (handleQRCode)

- [ ] **Step 1: ClipboardService.swift — changeCount 检测**

重写 `ClipboardService.swift`：

```swift
import UIKit

class ClipboardService: NSObject, ObservableObject {
    static let shared = ClipboardService()

    private var lastChangeCount: Int = 0
    private var lastSentHash: String = ""
    private var pollTimer: Timer?
    var onClipboardChanged: ((String) -> Void)?

    override private init() {
        super.init()
        lastChangeCount = UIPasteboard.general.changeCount
    }

    func startMonitoring(interval: TimeInterval = 2.0) {
        stopMonitoring()
        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.checkForChanges()
        }
    }

    func stopMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func checkForChanges() {
        let current = UIPasteboard.general.changeCount
        guard current != lastChangeCount else { return }
        lastChangeCount = current

        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        let hash = sha256(text)
        guard hash != lastSentHash else { return }

        lastSentHash = hash
        onClipboardChanged?(text)
    }

    private func sha256(_ input: String) -> String {
        // Use CryptoKit
        var hasher = SHA256()
        hasher.update(data: Data(input.utf8))
        let digest = hasher.finalize()
        return digest.compactMap { String(format: "%02x", $0) }.joined()
    }

    func getClipboard() -> String? {
        return UIPasteboard.general.string
    }

    func setClipboard(_ text: String) {
        UIPasteboard.general.string = text
        lastSentHash = sha256(text)
    }
}
```

需要 import CryptoKit：

```swift
import UIKit
import CryptoKit
```

- [ ] **Step 2: ConnectionManager.swift — RSA 密钥生成 + /pair/confirm**

在 `ConnectionManager` 中新增属性：

```swift
private var rsaPrivateKey: SecKey?
private var rsaPublicKey: SecKey?
private var deviceId: String = ""
private let storageKey = "handoff_paired_devices"
private let identityKey = "handoff_identity"
private var lastRemoteClipboardHash: String = ""
private var lastLocalCopyTime: Date = Date()
private var currentDeviceId: String = ""
```

新增 RSA 密钥生成：

```swift
private func ensureIdentity() {
    if let saved = UserDefaults.standard.data(forKey: identityKey),
       let dict = try? JSONSerialization.jsonObject(with: saved) as? [String: String],
       let savedDeviceId = dict["deviceId"] {
        deviceId = savedDeviceId
        logger.info("设备身份已加载: \(deviceId)")
        return
    }

    // 生成 RSA 2048 密钥对
    let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
        kSecAttrKeySizeInBits as String: 2048,
        kSecAttrIsPermanent as String: false
    ]
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, nil),
          let publicKey = SecKeyCopyPublicKey(privateKey) else {
        logger.error("RSA 密钥生成失败")
        return
    }
    rsaPrivateKey = privateKey
    rsaPublicKey = publicKey

    // 生成 deviceId
    var randomBytes = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, 16, &randomBytes)
    deviceId = randomBytes.map { String(format: "%02x", $0) }.joined()

    let identity: [String: String] = ["deviceId": deviceId]
    if let data = try? JSONSerialization.data(withJSONObject: identity) {
        UserDefaults.standard.set(data, forKey: identityKey)
    }
    logger.info("新设备身份已生成: \(deviceId)")
}
```

在 `init()` 中调用 `ensureIdentity()`。

- [ ] **Step 3: ConnectionManager.swift — handleQRCode 中调用 /pair/confirm**

在 `handleQRCode()` 方法末尾（设置 baseURL 和添加设备后），新增：

```swift
// 调用 /pair/confirm 完成 Windows 端配对
if let token = json["token"] as? String {
    // 签名 token
    let signature = signToken(token)
    let confirmBody: [String: Any] = [
        "token": token,
        "signedToken": signature ?? "",
        "deviceInfo": [
            "deviceId": deviceId,
            "deviceName": UIDevice.current.name,
            "platform": "ios"
        ]
    ]
    sendPairConfirm(host: host, port: port, body: confirmBody)
}
```

新增辅助方法：

```swift
private func signToken(_ token: String) -> String? {
    guard let privateKey = rsaPrivateKey,
          let tokenData = token.data(using: .utf8) else { return nil }

    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(privateKey, .rsaSignatureMessagePKCS1v15SHA256, tokenData as CFData, &error) else {
        logger.error("签名失败: \(error?.takeRetainedValue().localizedDescription ?? "unknown")")
        return nil
    }
    return (signature as Data).base64EncodedString()
}

private func sendPairConfirm(host: String, port: Int, body: [String: Any]) {
    guard let url = URL(string: "http://\(host):\(port)/pair/confirm"),
          let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = jsonData

    URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
        if let error = error {
            self?.logger.error("pair/confirm 失败: \(error.localizedDescription)")
        } else {
            self?.logger.info("pair/confirm 成功")
        }
    }.resume()
}
```

- [ ] **Step 4: 构建验证**

Run CI: 手动触发 `ios-build.yml`

Commit:
```bash
git add ios/HandoffApp/HandoffApp/Services/ClipboardService.swift ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift
git commit -m "feat: iOS clipboard changeCount detection, RSA identity, /pair/confirm"
```

---

### Task 11: iOS — ContentView UI 更新

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Views/ContentView.swift:1-99`

- [ ] **Step 1: ContentView.swift — 发现设备 + 在线状态**

在 "连接状态" Section 之后新增"发现的设备" Section：

```swift
// After the "连接状态" Section:
Section("发现的设备") {
    if discoveryService.discoveredDevices.isEmpty {
        Text("正在搜索...").foregroundColor(.secondary)
    }
    ForEach(discoveryService.discoveredDevices) { device in
        HStack {
            VStack(alignment: .leading) {
                Text(device.name).font(.subheadline)
                Text("\(device.host):\(device.port)").font(.caption).foregroundColor(.secondary)
            }
            Spacer()
            Button("连接") {
                discoveryService.connectToDevice(device)
            }
        }
    }
}
```

在 `ContentView` 中添加 `@EnvironmentObject var discoveryService: DiscoveryService`。

修改"已配对设备" Section 中在线状态标签改为实时：

```swift
Text(device.isConnected ? "在线" : "离线")
    .font(.caption)
    .foregroundColor(device.isConnected ? .green : .secondary)
```

添加本地剪贴板保护：在 `onAppear` 中注册 `ClipboardService.shared.startMonitoring()`，`onDisappear` 中 `stopMonitoring()`。

- [ ] **Step 2: 构建验证**

Run CI: 手动触发 `ios-build.yml`

Commit:
```bash
git add ios/HandoffApp/HandoffApp/Views/ContentView.swift
git commit -m "feat: iOS ContentView discovered devices section and real-time online status"
```

---

## 最终验证

全部 Task 完成后：

Run: `pnpm dev:full`
Verification checklist:
1. HandoffService 日志无乱码 ✓
2. 诊断页 → 获取 Windows 剪贴板 → 中文正常 ✓
3. 设备管理 → 生成配对码 → 二维码显示 ✓
4. iOS 扫码配对 → Windows 设备列表出现设备 ✓
5. iOS 连接状态显示"在线" ✓
6. Windows 复制文本 → iOS 剪贴板自动获得 ✓
7. iOS 复制文本 → Windows 剪贴板自动获得 ✓
8. 传输记录页有记录 ✓
