# Handoff 设备重连与在线扫描 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS 下拉重连 + Bonjour 双向宣告 + Windows 定时/手动扫描在线 iOS 设备，设备列表展示在线状态

**Architecture:** 数据层新增 `last_ip` 列 + `updateDeviceStatus`；HandoffService 新增 `scanner.ts`（mDNS 定时扫描 + 设备匹配）和修改 `socket.ts`（连接/断开更新状态）；主进程新增 IPC handler（scanDevices/setScanInterval）；渲染进程新增在线状态 UI + 扫描按钮 + 设置项；iOS 新增 `AdvertiseService` Bonjour 宣告 + 下拉重连

**Tech Stack:** TypeScript, electron-vite, Vue 3, Ant Design Vue, multicast-dns, socket.io, SwiftUI, NetService

---

## 任务总览

| 序号 | 任务 | 涉及模块 |
|------|------|----------|
| 1 | 数据库：`last_ip` 列迁移 + `updateDeviceStatus` | schema.ts, db/index.ts |
| 2 | HandoffService 配置：新增 `scannerInterval` | config.ts |
| 3 | HandoffService：socket.io 连接/断开更新设备状态 | socket.ts |
| 4 | HandoffService：新建 `scanner.ts` mDNS 定时扫描 | scanner.ts (新建) |
| 5 | HandoffService：mDNS 查询增强 + index.ts 集成 | mdns.ts, index.ts |
| 6 | Internal HTTP：`device-status` 端点 + `/devices` 增强 | internal-http.ts |
| 7 | 主进程：IPC handler + 事件转发 + preload | ipc/handoff.ts, handoff-ipc-client.ts, preload/index.ts, env.d.ts |
| 8 | 渲染进程：Store + DeviceList UI + HandoffSettings | stores/handoff.ts, DeviceList.vue, HandoffSettings.vue |
| 9 | iOS：Bonjour 宣告 `AdvertiseService` | AdvertiseService.swift (新建) |
| 10 | iOS：下拉重连 + UI 集成 | ConnectionManager.swift, ContentView.swift, App.swift |

---

### Task 1: 数据库 — `last_ip` 列迁移 + `updateDeviceStatus`

**Spec 覆盖：** 三.1 数据库变更

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/index.ts`

- [ ] **Step 1: 在 schema.ts 的 MIGRATIONS 数组中添加 last_ip 列迁移**

```typescript
// src/main/db/schema.ts — MIGRATIONS 数组追加一行
`ALTER TABLE paired_devices ADD COLUMN last_ip TEXT DEFAULT '';`,
```

- [ ] **Step 2: 在 db/index.ts 新增 `updateDeviceStatus` 函数**

在 `deletePairedDevice` 函数之后添加：

```typescript
// src/main/db/index.ts
export function updateDeviceStatus(deviceId: string, data: {
  last_seen?: number
  last_ip?: string
}): void {
  const device = getPairedDeviceByDeviceId(deviceId)
  if (!device) return
  const fields: string[] = []
  const values: (string | number)[] = []
  if (data.last_seen !== undefined) {
    fields.push('last_seen = ?')
    values.push(data.last_seen)
  }
  if (data.last_ip !== undefined) {
    fields.push('last_ip = ?')
    values.push(data.last_ip)
  }
  if (fields.length === 0) return
  values.push(device.id)
  getDb().run(`UPDATE paired_devices SET ${fields.join(', ')} WHERE id = ?`, values)
  saveDatabase()
}
```

- [ ] **Step 3: 验证数据库操作**

```bash
pnpm build
# 确认编译通过，移除了未使用的 updatePairedDevice 引用
```

- [ ] **Step 4: 提交**

```bash
git add src/main/db/schema.ts src/main/db/index.ts
git commit -m "feat: add last_ip column migration + updateDeviceStatus function"
```

---

### Task 2: HandoffService 配置 — 新增 `scannerInterval`

**Spec 覆盖：** 三.4 定时扫描配置

**Files:**
- Modify: `src/handoff-service/config.ts`

- [ ] **Step 1: 在 HandoffConfig 接口和默认值中添加 scannerInterval**

```typescript
// src/handoff-service/config.ts

// 在 HandoffConfig 接口中添加新字段（在 frpTunnel 之后）：
export interface HandoffConfig {
  // ... 已有字段保持不变 ...
  scanner: {
    interval: number  // 单位：秒，最小值 5
  }
}

// 在 defaultConfig 中添加默认值：
const defaultConfig: HandoffConfig = {
  server: { port: 19528, bindAddress: '0.0.0.0' },
  device: { name: 'My-Windows-PC', downloadDir: '' },
  features: { clipboardSync: true, fileTransfer: true, clipboardMaxSize: 1048576 },
  frpTunnel: { enabled: false, nodeId: null, remotePort: 19528 },
  scanner: { interval: 30 }
}

// 在 loadConfig 的 parsed 合并中添加 scanner：
config = {
  ...defaultConfig,
  ...parsed,
  server: { ...defaultConfig.server, ...(parsed.server || {}) },
  device: { ...defaultConfig.device, ...(parsed.device || {}) },
  features: { ...defaultConfig.features, ...(parsed.features || {}) },
  frpTunnel: { ...defaultConfig.frpTunnel, ...(parsed.frpTunnel || {}) },
  scanner: { ...defaultConfig.scanner, ...(parsed.scanner || {}) }
}

// reloadConfig 同样添加 scanner 合并
```

- [ ] **Step 2: 验证**

```bash
cd src/handoff-service && npx tsc --noEmit --skipLibCheck config.ts 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add src/handoff-service/config.ts
git commit -m "feat: add scannerInterval to HandoffService config"
```

---

### Task 3: HandoffService — socket.io 连接/断开更新设备状态

**Spec 覆盖：** 三.2 socket.io 事件 → 更新 last_seen / last_ip

**Files:**
- Modify: `src/handoff-service/socket.ts`

- [ ] **Step 1: 修改 iOS peer auth 成功时通知设备上线**

在 `socket.ts` 的 iOS peer `auth` 处理分支中，`console.log` 注册日志之后添加 HTTP 调用：

```typescript
// src/handoff-service/socket.ts — iOS peer auth 成功分支（约第 56 行之后）

// 在现有的 console.log(`[socket.io] Peer registered: ...`) 之前添加：
// 通过内部 HTTP 更新设备状态（last_seen + last_ip）
const statusPost = JSON.stringify({
  deviceId: msg.deviceId,
  online: true,
  ip: socket.handshake.address
})
const statusReq = http.request({
  hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(statusPost) }
}, () => {})
statusReq.on('error', (e: Error) => console.error('[socket.io] Failed to update device status:', e.message))
statusReq.write(statusPost)
statusReq.end()
```

- [ ] **Step 2: 修改 disconnect 事件通知设备离线**

在现有的 `socket.on('disconnect', ...)` 处理中添加：

```typescript
// socket.on('disconnect', (reason) => { ... }) 内部，现有逻辑之后添加：

// 更新设备离线状态
if (socket.data.role === 'peer' && socket.data.deviceId) {
  io!.to('admin').emit('peer:disconnected', { deviceId: socket.data.deviceId })

  const offlinePost = JSON.stringify({
    deviceId: socket.data.deviceId,
    online: false
  })
  const req = http.request({
    hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(offlinePost) }
  }, () => {})
  req.on('error', () => { /* silent */ })
  req.write(offlinePost)
  req.end()
}
```

同时，在 auth 成功的 `console.log` 之后添加 admin 通知：

```typescript
// 在 auth 成功注册 peer 之后添加：
io!.to('admin').emit('peer:connected', {
  deviceId: msg.deviceId,
  ip: socket.handshake.address
})
```

- [ ] **Step 3: 验证编译**

```bash
cd src/handoff-service && npx tsc --noEmit --skipLibCheck socket.ts 2>&1 | head
```

- [ ] **Step 4: 提交**

```bash
git add src/handoff-service/socket.ts
git commit -m "feat: update device last_seen/last_ip on socket.io connect/disconnect"
```

---

### Task 4: HandoffService — 新建 `scanner.ts`

**Spec 覆盖：** 三.3 mDNS 定时扫描

**Files:**
- Create: `src/handoff-service/scanner.ts`

- [ ] **Step 1: 创建 scanner.ts**

```typescript
// src/handoff-service/scanner.ts
import http from 'http'
import { getConfig } from './config'

let scanTimer: ReturnType<typeof setInterval> | null = null
let knownOnlineDevices: Set<string> = new Set()

function notifyDeviceFound(deviceId: string, ip: string): void {
  if (knownOnlineDevices.has(deviceId)) return
  knownOnlineDevices.add(deviceId)

  console.log(`[scanner] Bonjour 发现设备: ${deviceId} @ ${ip}`)

  // 通过内部 HTTP 更新设备状态
  const postData = JSON.stringify({ deviceId, online: true, ip, source: 'bonjour' })
  const req = http.request({
    hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
  }, () => {})
  req.on('error', () => { /* silent */ })
  req.write(postData)
  req.end()
}

function notifyDevicesOffline(): void {
  // Mark all Bonjour-discovered devices as offline (those not backed by socket.io)
  for (const deviceId of knownOnlineDevices) {
    const postData = JSON.stringify({ deviceId, online: false, source: 'bonjour' })
    const req = http.request({
      hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, () => {})
    req.on('error', () => { /* silent */ })
    req.write(postData)
    req.end()
  }
  knownOnlineDevices.clear()
}

export function refreshScan(): void {
  // 触发一次即时扫描：不需要额外的逻辑，因为 mDNS 响应由 mdns.ts 的 query 处理
  // mdns.ts 中的 response handler 会解析 TXT 记录并调用 scanner 的回调
  console.log('[scanner] 手动扫描触发')
  // 先标记上一轮所有设备为离线
  notifyDevicesOffline()
  // query 逻辑在 mdns.ts 中触发
}

export function startScanner(onScan: () => void): void {
  stopScanner()
  const config = getConfig()
  const interval = Math.max(5, config.scanner.interval || 30) * 1000
  console.log(`[scanner] 定时扫描已启动 (间隔 ${interval / 1000}s)`)

  scanTimer = setInterval(() => {
    notifyDevicesOffline()
    onScan()
  }, interval)
}

export function setScanInterval(seconds: number): void {
  if (seconds < 5) seconds = 5
  const config = getConfig()
  config.scanner.interval = seconds
  // 重启定时器
  const { startScanner } = require('./scanner')
  const { queryMDNS } = require('./mdns')
  startScanner(() => queryMDNS())
}

export function stopScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}

// 供 mdns.ts 响应解析后调用：当 Bonjour 发现 iOS 设备时通知
export function onBonjourDeviceFound(deviceId: string, ip: string): void {
  notifyDeviceFound(deviceId, ip)
}
```

- [ ] **Step 2: 验证编译**

```bash
cd src/handoff-service && npx tsc --noEmit --skipLibCheck scanner.ts 2>&1 | head
```

- [ ] **Step 3: 提交**

```bash
git add src/handoff-service/scanner.ts
git commit -m "feat: add Bonjour scanner with configurable interval"
```

---

### Task 5: HandoffService — mDNS 查询增强 + index.ts 集成

**Spec 覆盖：** 三.3 mDNS 定时扫描 + 三.4 定时扫描配置

**Files:**
- Modify: `src/handoff-service/mdns.ts`
- Modify: `src/handoff-service/index.ts`
- Modify: `src/handoff-service/http-server.ts`

- [ ] **Step 1: 在 mdns.ts 中新增 `queryMDNS` 导出函数**

在现有 `startMDNSBroadcast` 中添加 Bonjour 查询响应处理。在 `mdns.on('query', ...)` 之前添加一个 `response` 事件监听：

```typescript
// src/handoff-service/mdns.ts

// 在 startMDNSBroadcast 函数内部，mdns.on('query', ...) 之前添加：

// 监听 mDNS 响应 — 解析 iOS 设备的 Bonjour 宣告
mdns.on('response', (response) => {
  for (const answer of response.answers) {
    if (answer.type === 'TXT' && answer.name.endsWith('._handoff._tcp.local')) {
      try {
        // answer.data 可能是 Buffer 或 string
        const txtStr = Buffer.isBuffer(answer.data) ? answer.data.toString('utf-8') : String(answer.data || '')
        let txtData: Record<string, string> = {}
        try {
          txtData = JSON.parse(txtStr)
        } catch {
          // 可能是 key=value 格式的 TXT record
          for (const pair of txtStr.split(',')) {
            const eq = pair.indexOf('=')
            if (eq > 0) {
              txtData[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
            }
          }
        }
        const deviceId = txtData['deviceId']
        const platform = txtData['platform'] || ''
        if (deviceId && platform === 'ios') {
          // 从 SRV/TXT 对应答案中获取 IP/host
          // 从 answer.name 提取服务名（如 "iPhone._handoff._tcp.local"）
          const { onBonjourDeviceFound } = require('./scanner')
          // IP 从关联的 A 记录获取，或在 response.additionals 中
          let ip = '0.0.0.0'
          for (const add of (response.additionals || [])) {
            if (add.type === 'A' && add.name === answer.name) {
              ip = String(add.data || '0.0.0.0')
              break
            }
          }
          onBonjourDeviceFound(deviceId, ip)
        }
      } catch { /* 解析失败跳过 */ }
    }
  }
})
```

- [ ] **Step 2: 导出 `queryMDNS` 和 `stopMDNSBroadcast`（已有）**

```typescript
// 在文件末尾（stopMDNSBroadcast 之前或之后）添加导出：
export function queryMDNS(): void {
  if (!mdns) return
  mdns.query({ questions: [{ name: '_handoff._tcp.local', type: 'PTR' }] })
}
```

- [ ] **Step 3: 在 index.ts 中启动 scanner**

在 `startMDNSBroadcast()` 之后添加 scanner 启动：

```typescript
// src/handoff-service/index.ts — 在 startMDNSBroadcast() 之后添加：

// 启动 Bonjour 定时扫描器
const { startScanner, refreshScan, setScanInterval: setScannerInterval } = await import('./scanner')
const { queryMDNS } = await import('./mdns')
startScanner(() => queryMDNS())
console.log('[HandoffService] Scanner started')
```

- [ ] **Step 4: 在 http-server.ts 中添加 scanner 控制端点**

在 `handleRequest` 函数中的 `/clipboard` POST 端点之后、`res.writeHead(404)` 之前添加：

```typescript
// ─── Scanner control endpoints ───────────────────────────────────────────

// 手动触发一次扫描
if (req.method === 'POST' && url === '/scanner/scan') {
  const { refreshScan } = require('./scanner')
  refreshScan()
  const { queryMDNS } = require('./mdns')
  queryMDNS()
  res.writeHead(200)
  res.end(JSON.stringify({ success: true }))
  return
}

// 设置扫描间隔
if (req.method === 'POST' && url === '/scanner/interval') {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  req.on('end', () => {
    try {
      const { interval } = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
      const { setScanInterval } = require('./scanner')
      setScanInterval(Math.max(5, interval || 30))
      res.writeHead(200)
      res.end(JSON.stringify({ success: true, interval: Math.max(5, interval || 30) }))
    } catch (e) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: String(e) }))
    }
  })
  return
}
```

同时更新 `/health` 端点，在 config 中暴露 scannerInterval：

```typescript
// 在 /health 端点的 config 对象中添加：
scannerInterval: cfg.scanner.interval
```

- [ ] **Step 5: 验证**

```bash
cd src/handoff-service && npx tsc --noEmit --skipLibCheck index.ts 2>&1 | head
```

- [ ] **Step 6: 提交**

```bash
git add src/handoff-service/mdns.ts src/handoff-service/index.ts src/handoff-service/http-server.ts
git commit -m "feat: add mDNS query response parsing + scanner integration + HTTP control endpoints"
```

---

### Task 6: Internal HTTP — `device-status` 端点 + `/devices` 增强

**Spec 覆盖：** 三.2 socket.io 事件 + 三.3 Bonjour 发现匹配

**Files:**
- Modify: `src/main/internal-http.ts`

- [ ] **Step 1: 添加 `POST /internal/device-status` 端点**

在 `POST /internal/revoke-device` 分支之后、`res.writeHead(404)` 之前添加：

```typescript
// POST /internal/device-status
if (req.method === 'POST' && url === '/internal/device-status') {
  try {
    const { deviceId, online, ip, source } = JSON.parse(body || '{}')
    const { updateDeviceStatus, getPairedDeviceByDeviceId } = require('./db')
    const device = getPairedDeviceByDeviceId(deviceId)
    if (device) {
      const now = Math.floor(Date.now() / 1000)
      const updateData: { last_seen?: number; last_ip?: string } = { last_seen: now }
      if (ip && ip !== '0.0.0.0') {
        updateData.last_ip = ip
      }
      updateDeviceStatus(deviceId, updateData)

      // Notify admin via socket.io (HandoffService 会处理)
      if (source === 'bonjour') {
        const { notifyAdmin } = require('../../handoff-service/socket')
        if (online) {
          notifyAdmin('bonjour:found', { deviceId, ip })
        } else {
          notifyAdmin('bonjour:lost', { deviceId })
        }
      }
    }
    res.writeHead(200)
    res.end(JSON.stringify({ success: true }))
  } catch (e) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: String(e) }))
  }
  return
}
```

注意：`internal-http.ts` 在 `src/main/` 下，而 socket.ts 在 `src/handoff-service/` 下，这两个是不同的进程。`internal-http.ts` 运行在 Electron 主进程中，`socket.ts` 运行在 HandoffService 子进程中。

所以 `internal-http.ts` 不能直接 import HandoffService 的 socket.ts。需要改为：`internal-http.ts` 的 `/internal/device-status` 只做数据库更新，然后通过主进程的 socket.io-client 通知前端（这已经在 `handoff-ipc-client.ts` 中处理）。

更正：

```typescript
// POST /internal/device-status
if (req.method === 'POST' && url === '/internal/device-status') {
  try {
    const { deviceId, online, ip } = JSON.parse(body || '{}')
    const { updateDeviceStatus, getPairedDeviceByDeviceId } = require('./db')
    const device = getPairedDeviceByDeviceId(deviceId)
    if (device) {
      const now = Math.floor(Date.now() / 1000)
      const updateData: { last_seen?: number; last_ip?: string } = { last_seen: now }
      if (ip && ip !== '0.0.0.0') {
        updateData.last_ip = ip
      }
      updateDeviceStatus(deviceId, updateData)
    }
    res.writeHead(200)
    res.end(JSON.stringify({ success: true }))
  } catch (e) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: String(e) }))
  }
  return
}
```

通知前端的逻辑由 `handoff-ipc-client.ts` 中的 socket.io 事件处理。

- [ ] **Step 2: 更新 `GET /internal/devices` 返回 last_seen 和 last_ip**

修改现有的 GET /internal/devices 分支：

```typescript
// GET /internal/devices — 修改 map 部分：
const devices = listPairedDevices().map((d) => ({
  deviceId: d.device_id,
  deviceName: d.device_name,
  publicKey: d.public_key,
  enabled: !!d.enabled,
  lastSeen: d.last_seen || 0,
  lastIp: d.last_ip || ''
}))
```

- [ ] **Step 3: 为 HandoffService 也添加 `device-status` HTTP 端点**

HandoffService 的 `http-server.ts` 也需要处理来自 `socket.ts` 和 `scanner.ts` 的 `POST /internal/device-status` 请求。但由于 HandoffService 和主进程的 internal-http 是分开的（端口 19528 vs 19529），需要确认 socket.ts 和 scanner.ts 使用的是哪个端口。

查看 socket.ts 当前代码中，HTTP 请求发送到 `19529`（主进程的 internal-http）。这个模式是正确的——HandoffService 的子模块（socket.ts, scanner.ts）通过 HTTP 调用主进程的 internal-http 来更新数据库。

但 `import { notifyAdmin }` 需要从 HandoffService 的 socket 模块获取。scanner.ts 中通过 HTTP 调用 `/internal/device-status` 时，该端点已在主进程的 `internal-http.ts` 中定义，且该端点需要能通知前端。目前 `internal-http.ts` 没有直接访问 socket.io 的能力（socket.io server 在 HandoffService 进程中）。

解决方案：`socket.ts`（HandoffService 中）已经会在 auth/disconnect 时调用 `/internal/device-status`，同时通过 socket.io 通知 admin。scanner 的 Bonjour 发现也走这个路径即可——scanner 调用 `/internal/device-status` 更新数据库，然后由主进程的 socket.io-client 收到事件后转发给渲染进程。不对，这样 Bonjour 事件无法触发 socket.io 通知。

更好的方案：让 scanner.ts 中的 Bonjour 事件也通过 HandoffService 的 socket.ts 来通知 admin。scanner.ts 需要能访问 io 实例。

修改 scanner.ts：通过 `socket.ts` 导出的 `notifyAdmin` 来通知：

```typescript
// scanner.ts — onBonjourDeviceFound 中添加：
import { notifyAdmin } from './socket'
// ...
function notifyDeviceFound(deviceId: string, ip: string): void {
  // ... HTTP 调用更新数据库 ...
  // 通过 socket.io 通知 admin
  notifyAdmin('bonjour:found', { deviceId, ip })
}
```

而当设备离线时（notifyDevicesOffline），也通知：
```typescript
notifyAdmin('bonjour:lost', { deviceId })
```

- [ ] **Step 4: 验证编译**

```bash
pnpm build
```

- [ ] **Step 5: 提交**

```bash
git add src/main/internal-http.ts
git commit -m "feat: add /internal/device-status endpoint + enrich /internal/devices"
```

---

### Task 7: 主进程 — IPC handler + 事件转发 + preload

**Spec 覆盖：** 四.3 Store, 四.4 PairedDevice 接口, 五.IPC 接口

**Files:**
- Modify: `src/main/ipc/handoff.ts`
- Modify: `src/main/handoff-ipc-client.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: 在 handoff-ipc-client.ts 中转发新事件**

在现有的 `socket.on('peer:disconnected', ...)` 之前，新增：

```typescript
// src/main/handoff-ipc-client.ts
// 在现有的 device:paired 等事件注册区域添加：

socket.on('peer:connected', (data) => onEvent('peer:connected', data))
socket.on('bonjour:found', (data) => onEvent('bonjour:found', data))
socket.on('bonjour:lost', (data) => onEvent('bonjour:lost', data))
```

注意：`peer:disconnected` 已经存在，无需重复添加。

- [ ] **Step 2: 在 ipc/handoff.ts 中添加新 IPC handler**

在 `handoff:notify-config` handler 之后添加：

```typescript
// src/main/ipc/handoff.ts

// ─── Device scanning ────────────────────────────────────────────────────

ipcMain.handle('handoff:scan-devices', async () => {
  await httpPost('/internal/scan-devices')
  return { success: true }
})

ipcMain.handle('handoff:set-scan-interval', async (_e, seconds: number) => {
  await httpPost('/internal/set-scan-interval', { interval: Math.max(5, seconds) })
  return { success: true }
})
```

- [ ] **Step 3: 更新 `handoff:list-devices` handler 返回 lastSeen/lastIp**

修改现有的 `handoff:list-devices` handler：

```typescript
ipcMain.handle('handoff:list-devices', async () => {
  return listPairedDevices().map((d) => ({
    deviceId: d.device_id,
    deviceName: d.device_name,
    publicKey: d.public_key,
    enabled: !!d.enabled,
    lastSeen: d.last_seen || 0,
    lastIp: d.last_ip || ''
  }))
})
```

- [ ] **Step 4: 在 preload/index.ts 中添加新方法**

在 `handoff` 对象中添加：

```typescript
// src/preload/index.ts — handoff 对象中添加：
scanDevices: () => ipcRenderer.invoke('handoff:scan-devices'),
setScanInterval: (seconds: number) => ipcRenderer.invoke('handoff:set-scan-interval', seconds),
```

- [ ] **Step 5: 在 env.d.ts 中添加类型声明**

在 `handoff` 接口中添加：

```typescript
// src/renderer/src/env.d.ts — handoff 接口中添加：
scanDevices(): Promise<{ success: boolean }>
setScanInterval(seconds: number): Promise<{ success: boolean }>
```

同时更新 `listDevices` 返回类型：

```typescript
listDevices(): Promise<Array<{
  deviceId: string
  deviceName: string
  publicKey: string
  enabled: boolean
  lastSeen: number
  lastIp: string
}>>
```

- [ ] **Step 6: 在 internal-http.ts 中添加扫描控制端点**

添加 `POST /internal/scan-devices` 和 `POST /internal/set-scan-interval`：

```typescript
// POST /internal/scan-devices
if (req.method === 'POST' && url === '/internal/scan-devices') {
  // 向 HandoffService 发送 HTTP 请求触发扫描
  const req2 = http.request({
    hostname: '127.0.0.1', port: 19528, path: '/scanner/scan',
    method: 'POST'
  }, (innerRes) => {
    const chunks: Buffer[] = []
    innerRes.on('data', (c: Buffer) => chunks.push(c))
    innerRes.on('end', () => {
      res.writeHead(200)
      res.end(Buffer.concat(chunks).toString('utf-8'))
    })
  })
  req2.on('error', () => {
    res.writeHead(503)
    res.end(JSON.stringify({ error: 'handoff service not reachable' }))
  })
  req2.end()
  return
}

// POST /internal/set-scan-interval
if (req.method === 'POST' && url === '/internal/set-scan-interval') {
  try {
    const { interval } = JSON.parse(body || '{}')
    const req2 = http.request({
      hostname: '127.0.0.1', port: 19528, path: '/scanner/interval',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify({ interval })) }
    }, (innerRes) => {
      const chunks: Buffer[] = []
      innerRes.on('data', (c: Buffer) => chunks.push(c))
      innerRes.on('end', () => {
        res.writeHead(200)
        res.end(Buffer.concat(chunks).toString('utf-8'))
      })
    })
    req2.on('error', () => {
      res.writeHead(503)
      res.end(JSON.stringify({ error: 'handoff service not reachable' }))
    })
    req2.end()
  } catch (e) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: String(e) }))
  }
  return
}
```

- [ ] **Step 7: 验证编译**

```bash
pnpm build
```

- [ ] **Step 8: 提交**

```bash
git add src/main/ipc/handoff.ts src/main/handoff-ipc-client.ts src/main/internal-http.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: add scan devices IPC handlers + event forwarding + preload"
```

---

### Task 8: 渲染进程 — Store + DeviceList UI + HandoffSettings

**Spec 覆盖：** 四.1 设备列表, 四.2 服务设置, 四.3 Store, 四.4 PairedDevice 接口

**Files:**
- Modify: `src/renderer/src/stores/handoff.ts`
- Modify: `src/renderer/src/components/DeviceList.vue`
- Modify: `src/renderer/src/components/HandoffSettings.vue`

- [ ] **Step 1: 更新 store 中的 PairedDevice 接口和状态**

在 `handoff.ts` 中更新：

```typescript
// src/renderer/src/stores/handoff.ts

export interface PairedDevice {
  deviceId: string
  deviceName: string
  publicKey: string
  enabled: boolean
  lastSeen: number    // 新增
  lastIp: string      // 新增
}

// 新增在线状态数据
const onlineDevices = ref<Record<string, 'online' | 'reachable' | 'offline'>>({})

// 更新 connectSSE 中的事件监听：
function connectSSE(): void {
  window.api.handoff.connectSSE()
  const clean1 = window.api.handoff.onEvent(({ event, data }) => {
    if (event === 'ws-connection' || event === 'ws-disconnection') {
      serviceConnections.value = (data as { connected: number }).connected
    } else if (event === 'config:reloaded') {
      fetchDevices()
    } else if (event === 'device:paired') {
      fetchDevices()
    } else if (event === 'device:revoked') {
      fetchDevices()
    } else if (event === 'transfer:recorded') {
      const record = data as TransferRecord
      transferHistory.value.unshift(record)
    } else if (event === 'peer:connected') {
      const { deviceId } = data as { deviceId: string }
      onlineDevices.value[deviceId] = 'online'
    } else if (event === 'peer:disconnected') {
      const { deviceId } = data as { deviceId: string }
      // 仅当 Bonjour 也未发现时标记为离线
      if (onlineDevices.value[deviceId] !== 'reachable') {
        onlineDevices.value[deviceId] = 'offline'
      }
    } else if (event === 'bonjour:found') {
      const { deviceId } = data as { deviceId: string }
      // 仅当 socket.io 未连接时标记为可达
      if (onlineDevices.value[deviceId] !== 'online') {
        onlineDevices.value[deviceId] = 'reachable'
      }
    } else if (event === 'bonjour:lost') {
      const { deviceId } = data as { deviceId: string }
      if (onlineDevices.value[deviceId] !== 'online') {
        onlineDevices.value[deviceId] = 'offline'
      }
    }
  })
  // ... 其余保持不变 ...
}

// 新增 action：
async function scanDevices(): Promise<void> {
  await window.api.handoff.scanDevices()
}

async function setScanInterval(seconds: number): Promise<void> {
  await window.api.handoff.setScanInterval(seconds)
}

// 在 return 中添加新导出的值
return {
  serviceStatus, serviceUptime, serviceConnections, devices, transferHistory, onlineDevices,
  isRunning,
  fetchServiceStatus, startService, stopService, restartService,
  fetchDevices, deleteDevice, generatePairing,
  fetchTransferHistory, clearHistory,
  connectSSE, disconnectSSE,
  scanDevices, setScanInterval
}
```

- [ ] **Step 2: 更新 DeviceList.vue — 在线状态 + IP + 扫描按钮**

替换模板中的操作栏和列表项：

```vue
<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <span style="color: #8c9aab;">共 {{ store.devices.length }} 台已配对设备</span>
      <a-space>
        <a-button size="small" @click="store.fetchDevices()">刷新</a-button>
        <a-button size="small" @click="handleScan" :loading="scanning">手动扫描</a-button>
        <a-button type="primary" @click="showQRModal = true" :disabled="!store.isRunning">生成配对码</a-button>
      </a-space>
    </div>

    <a-list
      :data-source="store.devices"
      :locale="{ emptyText: '暂无已配对设备，点击 生成配对码 开始配对' }"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #avatar>
              <span style="font-size: 20px;">
                <span v-if="store.onlineDevices[item.deviceId] === 'online'" style="color: #52c41a;">●</span>
                <span v-else-if="store.onlineDevices[item.deviceId] === 'reachable'" style="color: #faad14;">●</span>
                <span v-else style="color: #8c9aab;">●</span>
              </span>
            </template>
            <template #title>
              {{ item.deviceName }}
              <a-tag :color="item.enabled ? 'green' : 'default'" style="margin-left: 8px;">
                {{ item.enabled ? '已启用' : '已停用' }}
              </a-tag>
              <a-tag v-if="store.onlineDevices[item.deviceId] === 'online'" color="green" style="margin-left: 4px;">在线</a-tag>
              <a-tag v-else-if="store.onlineDevices[item.deviceId] === 'reachable'" color="orange" style="margin-left: 4px;">可达</a-tag>
            </template>
            <template #description>
              <div>ID: {{ item.deviceId }}</div>
              <div v-if="item.lastIp">IP: {{ item.lastIp }}</div>
              <div v-if="item.lastSeen">最后在线: {{ new Date(item.lastSeen * 1000).toLocaleString() }}</div>
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-button size="small" type="link" danger @click="handleDelete(item.deviceId)">解除配对</a-button>
          </template>
        </a-list-item>
      </template>
    </a-list>

    <PairingQRModal :open="showQRModal" @close="showQRModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useHandoffStore } from '../stores/handoff'
import PairingQRModal from './PairingQRModal.vue'

const store = useHandoffStore()
const showQRModal = ref(false)
const scanning = ref(false)

async function handleDelete(deviceId: string): Promise<void> {
  await store.deleteDevice(deviceId)
}

async function handleScan(): Promise<void> {
  scanning.value = true
  try {
    await store.scanDevices()
    // 等待 3 秒收集 Bonjour 响应
    await new Promise(resolve => setTimeout(resolve, 3000))
    await store.fetchDevices()
  } finally {
    scanning.value = false
  }
}
</script>
```

- [ ] **Step 3: 更新 HandoffSettings.vue — 扫描间隔配置**

在现有表单的剪贴板大小限制之后、FRP 隧道之前添加：

```vue
    <a-form-item label="设备扫描间隔">
      <a-input-number
        v-model:value="scanInterval"
        :min="5"
        :max="3600"
        style="width: 100%;"
        addon-after="秒"
      />
      <span style="margin-left: 8px; color: #8c9aab; font-size: 12px;">最小 5 秒，调整即时生效</span>
    </a-form-item>
```

在 script 中添加：

```typescript
const scanInterval = ref(30)

// 在 onMounted 中添加：
if (status.health?.config) {
  // ... 已有字段 ...
  scanInterval.value = c.scannerInterval || 30
}

// 在 handleSave 中，修改后调用 store.setScanInterval：
async function handleSave(): Promise<void> {
  saved.value = false
  try {
    await window.api.handoff.notifyConfig()
    await window.api.handoff.setScanInterval(scanInterval.value)
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch {
    // silently handle
  }
}
```

- [ ] **Step 4: 验证构建**

```bash
pnpm build
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/stores/handoff.ts src/renderer/src/components/DeviceList.vue src/renderer/src/components/HandoffSettings.vue
git commit -m "feat: add online status, IP display, scan button + scan interval setting"
```

---

### Task 9: iOS — Bonjour 宣告 `AdvertiseService`

**Spec 覆盖：** 二.2 Bonjour 服务宣告

**Files:**
- Create: `ios/HandoffApp/HandoffApp/Services/AdvertiseService.swift`

- [ ] **Step 1: 创建 AdvertiseService.swift**

```swift
import Foundation

class AdvertiseService: NSObject, ObservableObject, NetServiceDelegate {
    static let shared = AdvertiseService()

    private var netService: NetService?
    private let logger = DebugLogger.shared

    override private init() {
        super.init()
    }

    func start() {
        stop()

        let deviceName = UIDevice.current.name
        let deviceId = ConnectionManager().deviceId.isEmpty
            ? UserDefaults.standard.string(forKey: "handoff_identity_deviceId") ?? UUID().uuidString
            : ConnectionManager().deviceId

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"

        let txtDict: [String: Data] = [
            "deviceId": deviceId.data(using: .utf8) ?? Data(),
            "platform": "ios".data(using: .utf8) ?? Data(),
            "version": version.data(using: .utf8) ?? Data()
        ]

        netService = NetService(
            domain: "local.",
            type: "_handoff._tcp.",
            name: deviceName,
            port: 0  // 不监听，仅宣告
        )
        netService?.delegate = self
        netService?.setTXTRecord(NetService.data(fromTXTRecord: txtDict))
        netService?.publish()

        logger.warn("Bonjour 宣告已启动: \(deviceName)")
    }

    func stop() {
        netService?.stop()
        netService = nil
    }

    // MARK: - NetServiceDelegate

    func netServiceDidPublish(_ sender: NetService) {
        logger.info("Bonjour 宣告成功: \(sender.name)")
    }

    func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
        logger.warn("Bonjour 宣告失败: \(errorDict)")
    }

    func netServiceDidStop(_ sender: NetService) {
        logger.info("Bonjour 宣告已停止")
    }
}
```

- [ ] **Step 2: 在 App.swift 中初始化并管理生命周期**

修改 `App.swift`：

```swift
// 在 init() 中添加：
AdvertiseService.shared.start()

// 添加场景阶段检测（iOS 15+）：
import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        logger.info("HandoffApp 启动 v\(version)")
        _ = UIPasteboard.general.string
        ClipboardService.shared.startMonitoring()
        AdvertiseService.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
                .environmentObject(discoveryService)
                .environmentObject(logger)
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                AdvertiseService.shared.start()
                DiscoveryService.shared.startBrowsing()
            case .background, .inactive:
                AdvertiseService.shared.stop()
            @unknown default:
                break
            }
        }
    }
}
```

- [ ] **Step 3: 验证 Swift 编译**

```bash
cd ios/HandoffApp && xcodebuild -project HandoffApp.xcodeproj -scheme HandoffApp -destination 'generic/platform=iOS' build 2>&1 | tail -5
```

如果项目是 xcodegen 生成的，改用：
```bash
cd ios/HandoffApp && xcodegen generate && xcodebuild -project HandoffApp.xcodeproj -scheme HandoffApp -destination 'generic/platform=iOS' build 2>&1 | tail -5
```

- [ ] **Step 4: 提交**

```bash
git add ios/HandoffApp/HandoffApp/Services/AdvertiseService.swift ios/HandoffApp/HandoffApp/App.swift
git commit -m "feat: iOS Bonjour advertise service with lifecycle management"
```

---

### Task 10: iOS — 下拉重连 + UI 集成

**Spec 覆盖：** 二.1 下拉重连

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift`
- Modify: `ios/HandoffApp/HandoffApp/Views/ContentView.swift`

- [ ] **Step 1: 在 ConnectionManager.swift 中添加 `reconnect` 方法**

在 `connectSocketIO` 方法之后添加：

```swift
func reconnect() {
    logger.warn("手动重连触发")
    socket?.disconnect()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.socket?.connect()
        // 同时刷新 Bonjour 浏览
        DiscoveryService.shared.startBrowsing()
        // 检查剪贴板
        ClipboardService.shared.checkNow()
    }
}
```

- [ ] **Step 2: 在 ContentView.swift 中添加 `.refreshable`**

修改 ContentView 的 List 部分：

```swift
// 在 List { ... } 闭合括号后添加 .refreshable：
List {
    // ... 已有内容保持不变 ...
}
.refreshable {
    connectionManager.reconnect()
    logger.warn("下拉刷新：已触发重连")
}
```

同时确保 `ContentView.onAppear` 中已有 Bonjour 浏览启动（已有）和宣告服务启动：

```swift
.onAppear {
    DiscoveryService.shared.startBrowsing()
    AdvertiseService.shared.start()
}
```

- [ ] **Step 3: 验证编译**

```bash
cd ios/HandoffApp && xcodegen generate && xcodebuild -project HandoffApp.xcodeproj -scheme HandoffApp -destination 'generic/platform=iOS' build 2>&1 | tail -5
```

- [ ] **Step 4: 提交**

```bash
git add ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift ios/HandoffApp/HandoffApp/Views/ContentView.swift
git commit -m "feat: iOS pull-to-refresh reconnect + ContentView integration"
```

---

## 验收测试

完成所有 10 个任务后，执行以下验收：

### Windows 端

```bash
pnpm dev:full
```

1. 打开 Handoff → 设备管理 → 确认列表显示已配对设备
2. 确认"刷新"和"手动扫描"按钮存在
3. 打开服务设置 → 确认"设备扫描间隔"配置项存在（默认 30s，最小 5s）
4. 修改扫描间隔 → 确认不报错

### iOS 端

1. 部署 IPA → 启动 App
2. 主界面下拉 → 确认触发重连（日志输出"手动重连触发"）
3. 确认日志输出"Bonjour 宣告已启动"

### Bonjour 发现

1. Windows + iOS 在同一局域网
2. 等待 30s（或手动扫描）
3. Windows 设备列表 → 确认 iOS 设备显示在线状态（🟢 或 🟡）
4. 检查诊断日志 → 确认 `[scanner] Bonjour 发现设备` 日志

---

## 注意事项

1. **iOS Bonjour 发布要求 iOS 14+**，`NetService.publish()` 在后台不可用（已在 AdvertiseService 中通过 scenePhase 处理）
2. **mDNS 响应可能不包含 A 记录**——需要从 SRV 记录的 target 再解析 IP，简化起见当前版本从 `response.additionals` 中查找
3. **`last_ip` 在 Windows 端存储的是局域网 IP**（如 192.168.x.x），非公网地址
4. **扫描间隔最小 5s**——在 `setScanInterval` 的 IPC handler 中已强制约束
5. **HandoffService 端口 19528** 的 `/scanner/scan` 和 `/scanner/interval` 端点需要 HandoffService 的 `http-server.ts` 支持——目前尚未实现这些端点，如果 `http-server.ts` 没有这些路由，需要补充
