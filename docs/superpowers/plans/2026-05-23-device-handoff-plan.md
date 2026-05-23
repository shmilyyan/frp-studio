# 设备接力模块 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 FRP Studio 中实现 iOS ↔ Windows 设备接力功能（剪贴板共享 + 文件传输 + 设备发现），包含独立后台服务进程和 FRP Studio 内的配置管理 UI。

**Architecture:** HandoffService 作为独立 Node.js 进程运行（detached spawn），FRP Studio 通过 HTTP localhost + SSE 与之通信。iOS App (Swift/SwiftUI) 通过 mDNS + WebSocket 直连或 FRP 隧道 fallback 与 Windows 通信。

**Tech Stack:** Node.js (HandoffService), ws + multicast-dns, SwiftUI (iOS), GitHub Actions (iOS CI), 现有 FRP Studio 栈 (Electron/Vue3/Pinia/sql.js/Ant Design Vue)

---

### Task 1: 安装 HandoffService 依赖

**Files:** Modify `package.json`

- [ ] **Step 1: 添加依赖包**

```bash
cd D:/workspace/frp-studio
pnpm add ws multicast-dns
pnpm add -D @types/ws @types/multicast-dns esbuild
```

- [ ] **Step 2: 验证安装**

```bash
pnpm ls ws multicast-dns
```
Expected: 两个包均已列出版本号

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add HandoffService dependencies (ws, multicast-dns)"
```

---

### Task 2: 数据库 Schema 扩展

**Files:**
- Modify: `src/main/db/schema.ts` (新增接口、建表 SQL、迁移)
- Modify: `src/main/db/index.ts` (新增 CRUD 函数)

- [ ] **Step 1: 在 schema.ts 末尾追加类型和 SQL**

在 `src/main/db/schema.ts` 末尾追加：

```typescript
// ─── Handoff: paired devices & transfer history ─────────────────────────────

export interface PairedDeviceRow {
  id: number
  device_id: string
  device_name: string
  platform: string
  public_key: string
  paired_at: number
  last_seen: number
  enabled: number
}

export interface TransferHistoryRow {
  id: number
  device_id: number
  type: string
  direction: string
  detail: string
  size: number
  status: string
  created_at: number
}

export const HANDOFF_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS paired_devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT UNIQUE NOT NULL,
  device_name TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'ios',
  public_key  TEXT NOT NULL,
  paired_at   INTEGER DEFAULT (strftime('%s','now')),
  last_seen   INTEGER DEFAULT (strftime('%s','now')),
  enabled     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transfer_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER REFERENCES paired_devices(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  direction   TEXT NOT NULL,
  detail      TEXT DEFAULT '',
  size        INTEGER DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'success',
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);
`
```

- [ ] **Step 2: 在 schema.ts 的 MIGRATIONS 数组末尾追加**

```typescript
  'ALTER TABLE paired_devices ADD COLUMN enabled INTEGER DEFAULT 1;',
```

同时将 `HANDOFF_TABLES_SQL` 加到 `CREATE_TABLES_SQL` 末尾（在 `CREATE_TABLES_SQL` 常量定义的模板字符串最后，`);` 之后）：直接将其追加到 `CREATE_TABLES_SQL` 字符串中。

修改 `CREATE_TABLES_SQL`，在最后的 `` ` `` 之前插入 `HANDOFF_TABLES_SQL` 的内容。更简洁的做法是修改 `CREATE_TABLES_SQL` 为 `CREATE_TABLES_SQL + HANDOFF_TABLES_SQL`，并在 `initDatabase` 中使用 `CREATE_TABLES_SQL + HANDOFF_TABLES_SQL`。

实际上直接修改 `schema.ts`，在 `CREATE_TABLES_SQL` 字符串末尾（最后一个 `);` 之后）添加：

```sql
CREATE TABLE IF NOT EXISTS paired_devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT UNIQUE NOT NULL,
  device_name TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'ios',
  public_key  TEXT NOT NULL,
  paired_at   INTEGER DEFAULT (strftime('%s','now')),
  last_seen   INTEGER DEFAULT (strftime('%s','now')),
  enabled     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transfer_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER REFERENCES paired_devices(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  direction   TEXT NOT NULL,
  detail      TEXT DEFAULT '',
  size        INTEGER DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'success',
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);
```

- [ ] **Step 3: 在 db/index.ts 末尾追加 handoff CRUD 函数**

```typescript
// ─── Paired Device operations ────────────────────────────────────────────────

export function listPairedDevices(): PairedDeviceRow[] {
  const stmt = getDb().prepare('SELECT * FROM paired_devices ORDER BY paired_at DESC')
  const rows: PairedDeviceRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as PairedDeviceRow)
  }
  stmt.free()
  return rows
}

export function getPairedDeviceByDeviceId(deviceId: string): PairedDeviceRow | null {
  const stmt = getDb().prepare('SELECT * FROM paired_devices WHERE device_id = ?')
  stmt.bind([deviceId])
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as PairedDeviceRow
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

export function addPairedDevice(data: {
  device_id: string
  device_name: string
  platform: string
  public_key: string
}): PairedDeviceRow {
  const db = getDb()
  db.run(
    'INSERT INTO paired_devices (device_id, device_name, platform, public_key) VALUES (?, ?, ?, ?)',
    [data.device_id, data.device_name, data.platform, data.public_key]
  )
  saveDatabase()
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number
  return getPairedDeviceById(id)!
}

export function getPairedDeviceById(id: number): PairedDeviceRow | null {
  const stmt = getDb().prepare('SELECT * FROM paired_devices WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as PairedDeviceRow
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

export function updatePairedDevice(id: number, data: Partial<{
  device_name: string
  last_seen: number
  enabled: number
}>): void {
  const fields = Object.keys(data).map((k) => `${k} = ?`).join(', ')
  getDb().run(`UPDATE paired_devices SET ${fields} WHERE id = ?`, [...Object.values(data), id])
  saveDatabase()
}

export function deletePairedDevice(id: number): void {
  getDb().run('DELETE FROM paired_devices WHERE id = ?', [id])
  saveDatabase()
}

// ─── Transfer History operations ─────────────────────────────────────────────

export function listTransferHistory(limit = 50, type?: string): TransferHistoryRow[] {
  const db = getDb()
  const stmt = type
    ? db.prepare('SELECT * FROM transfer_history WHERE type = ? ORDER BY created_at DESC LIMIT ?')
    : db.prepare('SELECT * FROM transfer_history ORDER BY created_at DESC LIMIT ?')
  if (type) {
    stmt.bind([type, limit])
  } else {
    stmt.bind([limit])
  }
  const rows: TransferHistoryRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as TransferHistoryRow)
  }
  stmt.free()
  return rows
}

export function addTransferHistory(data: {
  device_id: number
  type: string
  direction: string
  detail?: string
  size?: number
  status?: string
}): TransferHistoryRow {
  const db = getDb()
  db.run(
    'INSERT INTO transfer_history (device_id, type, direction, detail, size, status) VALUES (?, ?, ?, ?, ?, ?)',
    [data.device_id, data.type, data.direction, data.detail || '', data.size || 0, data.status || 'success']
  )
  saveDatabase()
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number
  return getTransferHistoryById(id)!
}

function getTransferHistoryById(id: number): TransferHistoryRow | null {
  const stmt = getDb().prepare('SELECT * FROM transfer_history WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as TransferHistoryRow
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

export function clearTransferHistory(): void {
  getDb().run('DELETE FROM transfer_history')
  saveDatabase()
}
```

在 db/index.ts 顶部的 import 中追加 `PairedDeviceRow, TransferHistoryRow`：
```typescript
import { CREATE_TABLES_SQL, MIGRATIONS, NodeRow, TunnelRow, PairedDeviceRow, TransferHistoryRow } from './schema'
```

- [ ] **Step 4: 编译检查**

```bash
pnpm typecheck:node
```
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts src/main/db/index.ts
git commit -m "feat: add paired_devices and transfer_history tables to database"
```

---

### Task 3: HandoffService 项目结构和配置加载

**Files:**
- Create: `src/handoff-service/tsconfig.json`
- Create: `src/handoff-service/config.ts`
- Create: `src/handoff-service/index.ts` (入口骨架)

- [ ] **Step 1: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "../../out/handoff-service",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 2: 创建 config.ts**

```typescript
import fs from 'fs'
import path from 'path'

export interface HandoffConfig {
  server: {
    port: number
    bindAddress: string
  }
  device: {
    name: string
    downloadDir: string
  }
  features: {
    clipboardSync: boolean
    fileTransfer: boolean
    clipboardMaxSize: number
  }
  frpTunnel: {
    enabled: boolean
    nodeId: number | null
    remotePort: number
  }
  pairedDevices: Array<{
    deviceId: string
    deviceName: string
    publicKey: string
    enabled: boolean
  }>
}

const defaultConfig: HandoffConfig = {
  server: { port: 19528, bindAddress: '0.0.0.0' },
  device: { name: 'My-Windows-PC', downloadDir: '' },
  features: { clipboardSync: true, fileTransfer: true, clipboardMaxSize: 1048576 },
  frpTunnel: { enabled: false, nodeId: null, remotePort: 19528 },
  pairedDevices: []
}

let configPath = ''
let config: HandoffConfig = { ...defaultConfig }

export function loadConfig(configDir: string): HandoffConfig {
  configPath = path.join(configDir, 'handoff.json')
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      config = { ...defaultConfig, ...JSON.parse(raw) }
    } else {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
      config = { ...defaultConfig }
    }
  } catch {
    config = { ...defaultConfig }
  }
  return config
}

export function getConfig(): HandoffConfig {
  return config
}

export function reloadConfig(): HandoffConfig {
  if (!configPath) return config
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    config = { ...defaultConfig, ...JSON.parse(raw) }
  } catch { /* keep current config */ }
  return config
}
```

- [ ] **Step 3: 创建 index.ts 入口骨架**

```typescript
import path from 'path'

const userDataPath = process.argv[2] || path.join(process.env.APPDATA || '', 'frp-studio')

async function main(): Promise<void> {
  const { loadConfig } = await import('./config')
  const config = loadConfig(userDataPath)
  console.log(`[HandoffService] Starting on port ${config.server.port}`)
  console.log(`[HandoffService] Device name: ${config.device.name}`)

  // TODO: 后续 task 中会逐步添加 HTTP server, WebSocket, mDNS 等
}

main().catch((err) => {
  console.error('[HandoffService] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 4: 添加构建脚本到 package.json**

在 `package.json` 的 `scripts` 中添加：

```
"build:handoff": "npx esbuild src/handoff-service/index.ts --bundle --platform=node --target=node18 --outfile=out/handoff-service/index.js --external:electron --external:sql.js",
```

- [ ] **Step 5: 构建验证**

```bash
pnpm build:handoff
node out/handoff-service/index.js
```
Expected: 输出 `[HandoffService] Starting on port 19528` 和 `[HandoffService] Device name: My-Windows-PC`，然后在 userData 目录创建 handoff.json

- [ ] **Step 6: Commit**

```bash
git add src/handoff-service/ out/handoff-service/
git commit -m "feat: add HandoffService project skeleton with config loading"
```

---

### Task 4: HandoffService HTTP + SSE 服务器

**Files:**
- Create: `src/handoff-service/http-server.ts`
- Modify: `src/handoff-service/index.ts`

- [ ] **Step 1: 创建 http-server.ts**

```typescript
import http from 'http'
import { getConfig } from './config'

type SSEClient = http.ServerResponse

const sseClients: Set<SSEClient> = new Set()

export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    client.write(payload)
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || '/'

  // SSE event stream
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

  // Health check
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'running',
      uptime: process.uptime(),
      connections: sseClients.size,
      version: '0.1.0'
    }))
    return
  }

  // List paired devices
  if (req.method === 'GET' && url === '/devices') {
    const config = getConfig()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(config.pairedDevices))
    return
  }

  // Reload config
  if (req.method === 'POST' && url === '/config') {
    const { reloadConfig } = require('./config')
    const newConfig = reloadConfig()
    broadcastSSE('config-reloaded', {})
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // Restart service
  if (req.method === 'POST' && url === '/restart') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    broadcastSSE('restarting', {})
    setTimeout(() => process.exit(0), 500)
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not found' }))
}

export function startHTTPServer(): http.Server {
  const config = getConfig()
  const server = http.createServer(handleRequest)
  server.listen(config.server.port, config.server.bindAddress, () => {
    console.log(`[HandoffService] HTTP server listening on ${config.server.bindAddress}:${config.server.port}`)
  })
  return server
}
```

- [ ] **Step 2: 更新 index.ts 使用 HTTP server**

修改 `src/handoff-service/index.ts`：

```typescript
import path from 'path'

const userDataPath = process.argv[2] || path.join(process.env.APPDATA || '', 'frp-studio')

async function main(): Promise<void> {
  const { loadConfig } = await import('./config')
  loadConfig(userDataPath)

  const { startHTTPServer } = await import('./http-server')
  startHTTPServer()
}

main().catch((err) => {
  console.error('[HandoffService] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 3: 构建并测试**

```bash
pnpm build:handoff
# 在后台启动
node out/handoff-service/index.js &
# 测试 health 端点
curl http://localhost:19528/health
# 停止
curl -X POST http://localhost:19528/restart
```
Expected: `/health` 返回 `{"status":"running","uptime":...}`

- [ ] **Step 4: Commit**

```bash
git add src/handoff-service/http-server.ts src/handoff-service/index.ts out/handoff-service/
git commit -m "feat: add HandoffService HTTP server with SSE support"
```

---

### Task 5: HandoffService mDNS 广播

**Files:**
- Create: `src/handoff-service/mdns.ts`
- Modify: `src/handoff-service/index.ts`

- [ ] **Step 1: 创建 mdns.ts**

```typescript
import multicastDns from 'multicast-dns'
import { getConfig } from './config'
import os from 'os'

let mdns: multicastDns.MulticastDNS | null = null

export function startMDNSBroadcast(): void {
  const config = getConfig()
  mdns = multicastDns()

  const deviceName = config.device.name || os.hostname()
  const serviceName = `Handoff-${deviceName.replace(/\s+/g, '-')}`

  mdns.on('query', (query) => {
    const hasHandoffQuery = query.questions.some(
      (q) => q.name === '_handoff._tcp.local'
    )
    if (!hasHandoffQuery) return

    mdns!.respond({
      answers: [{
        name: '_handoff._tcp.local',
        type: 'PTR',
        class: 1,
        ttl: 120,
        data: `${serviceName}._handoff._tcp.local`
      }, {
        name: `${serviceName}._handoff._tcp.local`,
        type: 'SRV',
        class: 1,
        ttl: 120,
        data: {
          port: config.server.port,
          target: os.hostname() + '.local'
        }
      }, {
        name: `${serviceName}._handoff._tcp.local`,
        type: 'TXT',
        class: 1,
        ttl: 120,
        data: Buffer.from(JSON.stringify({
          deviceName: deviceName,
          platform: 'windows',
          version: '0.1.0'
        }))
      }]
    })
  })

  // Periodic announcement
  setInterval(() => {
    mdns!.query({ questions: [{ name: '_handoff._tcp.local', type: 'PTR' }] })
  }, 30000)

  console.log(`[HandoffService] mDNS broadcasting as "${serviceName}"`)
}

export function stopMDNSBroadcast(): void {
  if (mdns) {
    mdns.destroy()
    mdns = null
  }
}
```

- [ ] **Step 2: 更新 index.ts 启动 mDNS**

```typescript
async function main(): Promise<void> {
  const { loadConfig } = await import('./config')
  loadConfig(userDataPath)

  const { startHTTPServer } = await import('./http-server')
  startHTTPServer()

  const { startMDNSBroadcast } = await import('./mdns')
  startMDNSBroadcast()
}
```

- [ ] **Step 3: 构建验证**

```bash
pnpm build:handoff
```
Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add src/handoff-service/mdns.ts src/handoff-service/index.ts out/handoff-service/
git commit -m "feat: add mDNS broadcast for device discovery"
```

---

### Task 6: HandoffService WebSocket 服务器

**Files:**
- Create: `src/handoff-service/ws-server.ts`
- Modify: `src/handoff-service/index.ts`
- Modify: `src/handoff-service/http-server.ts`

- [ ] **Step 1: 创建 ws-server.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import { broadcastSSE } from './http-server'

type MessageHandler = (ws: WebSocket, message: unknown) => void

const handlers: Map<string, MessageHandler> = new Map()
let wss: WebSocketServer | null = null
const connectedClients: Map<string, WebSocket> = new Map()

export function registerHandler(type: string, handler: MessageHandler): void {
  handlers.set(type, handler)
}

export function startWebSocketServer(server: http.Server): WebSocketServer {
  wss = new WebSocketServer({ server })

  wss.on('connection', (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    connectedClients.set(clientId, ws)
    broadcastSSE('ws-connection', { clientId, connected: connectedClients.size })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        const handler = handlers.get(msg.type)
        if (handler) {
          handler(ws, msg)
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      connectedClients.delete(clientId)
      broadcastSSE('ws-disconnection', { clientId, connected: connectedClients.size })
    })

    ws.on('error', () => {
      connectedClients.delete(clientId)
    })
  })

  console.log('[HandoffService] WebSocket server attached to HTTP server')
  return wss
}

export function getConnectedClients(): number {
  return connectedClients.size
}

export function sendToClient(ws: WebSocket, type: string, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...(data as object) }))
  }
}

export function broadcastToAll(type: string, data: unknown): void {
  const payload = JSON.stringify({ type, ...(data as object) })
  for (const ws of connectedClients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}
```

- [ ] **Step 2: 更新 http-server.ts，导出 server 实例并用同一个端口支持 WS**

在 `http-server.ts` 的 `handleRequest` 中，当非 WebSocket 路径时保持不变。修改 `startHTTPServer` 返回 `http.Server`：

```typescript
// 此函数已返回 http.Server，无需修改
// 在 index.ts 中将 server 传给 startWebSocketServer
```

- [ ] **Step 3: 更新 index.ts**

```typescript
async function main(): Promise<void> {
  const { loadConfig } = await import('./config')
  loadConfig(userDataPath)

  const { startHTTPServer } = await import('./http-server')
  const server = startHTTPServer()

  const { startWebSocketServer } = await import('./ws-server')
  startWebSocketServer(server)

  const { startMDNSBroadcast } = await import('./mdns')
  startMDNSBroadcast()
}
```

- [ ] **Step 4: 构建验证**

```bash
pnpm build:handoff
```
Expected: 无编译错误

- [ ] **Step 5: Commit**

```bash
git add src/handoff-service/ws-server.ts src/handoff-service/http-server.ts src/handoff-service/index.ts out/handoff-service/
git commit -m "feat: add WebSocket server to HandoffService"
```

---

### Task 7: HandoffService 配对与加密模块

**Files:**
- Create: `src/handoff-service/crypto.ts`
- Create: `src/handoff-service/pairing.ts`
- Modify: `src/handoff-service/http-server.ts`

- [ ] **Step 1: 创建 crypto.ts**

```typescript
import crypto from 'crypto'

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  return { publicKey, privateKey }
}

export function generateDeviceId(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function generatePairingToken(): string {
  return crypto.randomBytes(4).toString('hex')
}

export function sign(privateKey: string, data: string): string {
  const sign = crypto.createSign('SHA256')
  sign.update(data)
  sign.end()
  return sign.sign(privateKey, 'base64')
}

export function verify(publicKey: string, data: string, signature: string): boolean {
  const verify = crypto.createVerify('SHA256')
  verify.update(data)
  verify.end()
  return verify.verify(publicKey, signature, 'base64')
}

export function getPublicKeyFingerprint(publicKey: string): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

export function encrypt(publicKey: string, plaintext: string): string {
  return crypto.publicEncrypt(publicKey, Buffer.from(plaintext, 'utf-8')).toString('base64')
}

export function decrypt(privateKey: string, ciphertext: string): string {
  return crypto.privateDecrypt(privateKey, Buffer.from(ciphertext, 'base64')).toString('utf-8')
}
```

- [ ] **Step 2: 创建 pairing.ts**

```typescript
import { generateDeviceId, generateKeyPair, generatePairingToken, getPublicKeyFingerprint } from './crypto'
import { getConfig } from './config'
import fs from 'fs'

interface PendingPairing {
  token: string
  deviceId: string
  publicKey: string
  deviceName: string
  createdAt: number
}

const pendingPairings: Map<string, PendingPairing> = new Map()

let deviceId = ''
let keyPair: { publicKey: string; privateKey: string } | null = null

export function initDeviceIdentity(configDir: string): void {
  const identityPath = configDir + '/handoff-identity.json'
  try {
    if (fs.existsSync(identityPath)) {
      const saved = JSON.parse(fs.readFileSync(identityPath, 'utf-8'))
      deviceId = saved.deviceId
      keyPair = { publicKey: saved.publicKey, privateKey: saved.privateKey }
    }
  } catch { /* ignore */ }

  if (!deviceId || !keyPair) {
    deviceId = generateDeviceId()
    keyPair = generateKeyPair()
    fs.writeFileSync(identityPath, JSON.stringify({
      deviceId,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    }), 'utf-8')
  }
}

export function getDeviceIdentity(): { deviceId: string; publicKey: string; privateKey: string } {
  if (!keyPair || !deviceId) throw new Error('Device identity not initialized')
  return { deviceId, publicKey: keyPair.publicKey, privateKey: keyPair.privateKey }
}

export function generatePairRequest(deviceName: string, devicePublicKey: string): { token: string; qrData: string } {
  const token = generatePairingToken()
  const serverId = getDeviceIdentity()
  const config = getConfig()

  pendingPairings.set(token, {
    token,
    deviceId: '',
    publicKey: devicePublicKey,
    deviceName,
    createdAt: Date.now()
  })

  const qrData = JSON.stringify({
    token,
    deviceId: serverId.deviceId,
    publicKey: serverId.publicKey,
    host: config.server.bindAddress === '0.0.0.0' ? 'localhost' : config.server.bindAddress,
    port: config.server.port
  })

  return { token, qrData }
}

export function confirmPairing(token: string, signedToken: string): PendingPairing | null {
  const pending = pendingPairings.get(token)
  if (!pending) return null

  // Remove expired pairings (5 minutes)
  if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
    pendingPairings.delete(token)
    return null
  }

  const { verify } = require('./crypto')
  if (!verify(pending.publicKey, token, signedToken)) return null

  pendingPairings.delete(token)
  return pending
}

export function cleanupExpiredPairings(): void {
  const now = Date.now()
  for (const [token, pending] of pendingPairings) {
    if (now - pending.createdAt > 5 * 60 * 1000) {
      pendingPairings.delete(token)
    }
  }
}
```

- [ ] **Step 3: 在 http-server.ts 中添加配对端点**

在 `handleRequest` 中添加以下路由（放在 404 之前）：

```typescript
  // Generate pairing QR data
  if (req.method === 'POST' && url === '/pair/generate') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const { deviceName, devicePublicKey } = JSON.parse(body)
        const { generatePairRequest } = require('./pairing')
        const result = generatePairRequest(deviceName, devicePublicKey)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, qrData: result.qrData }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // Confirm pairing
  if (req.method === 'POST' && url === '/pair/confirm') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const { token, signedToken } = JSON.parse(body)
        const { confirmPairing } = require('./pairing')
        const pending = confirmPairing(token, signedToken)
        if (!pending) {
          res.writeHead(400)
          res.end(JSON.stringify({ success: false, error: 'invalid or expired pairing' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // Revoke paired device
  if (req.method === 'POST' && url?.startsWith('/pair/revoke/')) {
    const deviceIdToRevoke = url.split('/').pop()
    const config = getConfig()
    config.pairedDevices = config.pairedDevices.filter((d) => d.deviceId !== deviceIdToRevoke)
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    broadcastSSE('device-revoked', { deviceId: deviceIdToRevoke })
    return
  }
```

- [ ] **Step 4: 构建验证**

```bash
pnpm build:handoff
```
Expected: 无编译错误

- [ ] **Step 5: Commit**

```bash
git add src/handoff-service/crypto.ts src/handoff-service/pairing.ts src/handoff-service/http-server.ts out/handoff-service/
git commit -m "feat: add device pairing and crypto modules to HandoffService"
```

---

### Task 8: HandoffService 剪贴板监听

**Files:**
- Create: `src/handoff-service/clipboard.ts`
- Modify: `src/handoff-service/index.ts`

- [ ] **Step 1: 创建 clipboard.ts**

```typescript
import { getConfig } from './config'

let cachedContent = ''
let cachedHash = ''
let pollingTimer: ReturnType<typeof setInterval> | null = null

// Windows: poll clipboard via PowerShell (no native module needed)
function execPowerShell(script: string): Promise<string> {
  const { execSync } = require('child_process')
  try {
    return Promise.resolve(execSync(`powershell -Command "${script}"`, { encoding: 'utf-8' }).trim())
  } catch {
    return Promise.resolve('')
  }
}

async function getClipboardText(): Promise<string> {
  return execPowerShell('Get-Clipboard -Format Text')
}

function hashContent(content: string): string {
  const { createHash } = require('crypto')
  return createHash('sha256').update(content).digest('hex')
}

export function startClipboardWatcher(onChange: (content: string) => void): void {
  const config = getConfig()
  if (!config.features.clipboardSync) return

  pollingTimer = setInterval(async () => {
    try {
      const content = await getClipboardText()
      if (!content) return

      if (content.length > config.features.clipboardMaxSize) return

      const hash = hashContent(content)
      if (hash !== cachedHash) {
        cachedContent = content
        cachedHash = hash
        onChange(content)
      }
    } catch { /* ignore clipboard errors */ }
  }, 1000)

  console.log('[HandoffService] Clipboard watcher started (polling every 1s)')
}

export function stopClipboardWatcher(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

export function writeClipboard(text: string): void {
  const { execSync } = require('child_process')
  // Use PowerShell to set clipboard
  const escaped = text.replace(/'/g, "''")
  execSync(`powershell -Command "Set-Clipboard -Value '${escaped}'"`, { encoding: 'utf-8' })
  cachedContent = text
  cachedHash = hashContent(text)
}

export function getLatestClipboard(): { hash: string; payload: string } {
  return { hash: cachedHash, payload: cachedContent }
}
```

- [ ] **Step 2: 更新 index.ts 启动剪贴板监听**

在 `main()` 中添加：

```typescript
  const { startClipboardWatcher } = await import('./clipboard')
  startClipboardWatcher((content) => {
    const { broadcastToAll } = require('./ws-server')
    broadcastToAll('clipboard', { payload: content, timestamp: Date.now() })
  })
```

- [ ] **Step 3: 构建验证**

```bash
pnpm build:handoff
```
Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add src/handoff-service/clipboard.ts src/handoff-service/index.ts out/handoff-service/
git commit -m "feat: add clipboard monitoring to HandoffService"
```

---

### Task 9: HandoffService 文件传输引擎

**Files:**
- Create: `src/handoff-service/file-transfer.ts`
- Modify: `src/handoff-service/index.ts`

- [ ] **Step 1: 创建 file-transfer.ts**

```typescript
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { WebSocket } from 'ws'
import { getConfig } from './config'
import { sendToClient } from './ws-server'

const CHUNK_SIZE = 256 * 1024 // 256KB

interface ActiveTransfer {
  filename: string
  size: number
  receivedChunks: number
  totalChunks: number
  chunks: Map<number, Buffer>
  checksum: string
  ws: WebSocket
  direction: 'send' | 'receive'
}

const activeTransfers: Map<string, ActiveTransfer> = new Map()

export function handleFileOffer(ws: WebSocket, msg: { filename: string; size: number; checksum: string }): void {
  const transferId = crypto.randomBytes(8).toString('hex')
  const totalChunks = Math.ceil(msg.size / CHUNK_SIZE)

  activeTransfers.set(transferId, {
    filename: msg.filename,
    size: msg.size,
    receivedChunks: 0,
    totalChunks,
    chunks: new Map(),
    checksum: msg.checksum,
    ws,
    direction: 'receive'
  })

  sendToClient(ws, 'file:offer-ack', { transferId, accept: true })
}

export function handleFileChunk(ws: WebSocket, transferId: string, chunkIndex: number, data: Buffer): void {
  const transfer = activeTransfers.get(transferId)
  if (!transfer) {
    sendToClient(ws, 'file:error', { transferId, error: 'unknown transfer' })
    return
  }

  transfer.chunks.set(chunkIndex, data)
  transfer.receivedChunks++

  if (transfer.receivedChunks === transfer.totalChunks) {
    completeReceive(transferId)
  }
}

function completeReceive(transferId: string): void {
  const transfer = activeTransfers.get(transferId)
  if (!transfer) return

  const config = getConfig()
  const downloadDir = config.device.downloadDir || path.join(require('os').homedir(), 'Downloads', 'FrpTransfer')
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true })
  }

  // Assemble chunks
  const chunks: Buffer[] = []
  for (let i = 0; i < transfer.totalChunks; i++) {
    chunks.push(transfer.chunks.get(i) || Buffer.alloc(0))
  }
  const fullFile = Buffer.concat(chunks)

  // Verify checksum
  const actualChecksum = 'sha256:' + crypto.createHash('sha256').update(fullFile).digest('hex')
  const success = actualChecksum === transfer.checksum

  const destPath = path.join(downloadDir, transfer.filename)

  if (success) {
    fs.writeFileSync(destPath, fullFile)
    sendToClient(transfer.ws, 'file:complete', { transferId, status: 'ok', path: destPath })
    console.log(`[HandoffService] File received: ${destPath} (${transfer.size} bytes)`)
  } else {
    sendToClient(transfer.ws, 'file:complete', { transferId, status: 'checksum_mismatch' })
  }

  activeTransfers.delete(transferId)
}

export function handleFileRequest(ws: WebSocket, msg: { filePath: string }): void {
  const filePath = msg.filePath
  if (!fs.existsSync(filePath)) {
    sendToClient(ws, 'file:error', { error: 'file not found' })
    return
  }

  const stat = fs.statSync(filePath)
  const filename = path.basename(filePath)
  const checksum = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  const totalChunks = Math.ceil(stat.size / CHUNK_SIZE)

  sendToClient(ws, 'file:offer', { filename, size: stat.size, checksum })

  const transferId = crypto.randomBytes(8).toString('hex')
  activeTransfers.set(transferId, {
    filename,
    size: stat.size,
    receivedChunks: 0,
    totalChunks,
    chunks: new Map(),
    checksum,
    ws,
    direction: 'send'
  })

  // Send chunks
  const fileBuffer = fs.readFileSync(filePath)
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, stat.size)
    const chunkData = fileBuffer.subarray(start, end)
    // Send binary frame: [transferId length (1B)][transferId][chunk_index (4B LE)][chunk_data]
    const header = Buffer.alloc(1 + 8 + 4)
    const idBuf = Buffer.from(transferId, 'utf-8')
    header.writeUInt8(idBuf.length, 0)
    idBuf.copy(header, 1)
    header.writeUInt32LE(i, 9)
    ws.send(Buffer.concat([header, chunkData]))
  }
}
```

- [ ] **Step 2: 在 index.ts 注册 WebSocket 消息处理器**

在 `main()` 中，于 WebSocket server 启动后添加：

```typescript
  const { registerHandler } = await import('./ws-server')
  const { handleFileOffer, handleFileChunk, handleFileRequest } = await import('./file-transfer')

  registerHandler('file:offer', (ws, msg) => {
    handleFileOffer(ws, msg as { filename: string; size: number; checksum: string })
  })

  registerHandler('file:request', (ws, msg) => {
    handleFileRequest(ws, msg as { filePath: string })
  })

  registerHandler('clipboard:latest', (ws) => {
    const { getLatestClipboard } = require('./clipboard')
    sendToClient(ws, 'clipboard', getLatestClipboard())
  })
```

- [ ] **Step 3: 在 ws-server.ts 中添加二进制消息处理**

修改 `ws.on('message', ...)` 处理，增加二进制消息支持：

```typescript
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // Binary file chunk
        const buf = raw as Buffer
        const idLen = buf.readUInt8(0)
        const transferId = buf.subarray(1, 1 + idLen).toString('utf-8')
        const chunkIndex = buf.readUInt32LE(1 + idLen)
        const chunkData = buf.subarray(1 + idLen + 4)
        const { handleFileChunk } = require('./file-transfer')
        handleFileChunk(ws, transferId, chunkIndex, chunkData)
        return
      }
      try {
        const msg = JSON.parse(raw.toString())
        const handler = handlers.get(msg.type)
        if (handler) {
          handler(ws, msg)
        }
      } catch {
        // ignore
      }
    })
```

- [ ] **Step 4: 构建验证**

```bash
pnpm build:handoff
```
Expected: 无编译错误

- [ ] **Step 5: Commit**

```bash
git add src/handoff-service/file-transfer.ts src/handoff-service/ws-server.ts src/handoff-service/index.ts out/handoff-service/
git commit -m "feat: add file transfer engine to HandoffService"
```

---

### Task 10: HandoffService PID 文件管理

**Files:**
- Modify: `src/handoff-service/index.ts`

- [ ] **Step 1: 在 index.ts 中添加 PID 文件写入**

在 `main()` 函数开头添加：

```typescript
  // Write PID file for FRP Studio to discover
  const pidFile = path.join(userDataPath, 'handoff-service.pid')
  fs.writeFileSync(pidFile, String(process.pid), 'utf-8')
  console.log(`[HandoffService] PID ${process.pid} written to ${pidFile}`)

  // Cleanup on exit
  process.on('exit', () => {
    try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
  })
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))
```

需要在文件顶部添加 `import fs from 'fs'`。

- [ ] **Step 2: 构建验证**

```bash
pnpm build:handoff
```
Expected: 无编译错误

- [ ] **Step 3: Commit**

```bash
git add src/handoff-service/index.ts out/handoff-service/
git commit -m "feat: add PID file management for HandoffService discovery"
```

---

### Task 11: FRP Studio HandoffService 进程管理

**Files:**
- Create: `src/main/handoff-service-manager.ts`

- [ ] **Step 1: 创建 handoff-service-manager.ts**

```typescript
import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { broadcastSSE } from './handoff-ipc-client'

let serviceProcess: ChildProcess | null = null
let restartCount = 0
const MAX_RESTART = 3
const RESTART_DELAY = 3000

function getServiceJsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'out', 'handoff-service', 'index.js')
  }
  return path.join(app.getAppPath(), 'out', 'handoff-service', 'index.js')
}

function getUserDataPath(): string {
  return app.getPath('userData')
}

function getPidFilePath(): string {
  return path.join(getUserDataPath(), 'handoff-service.pid')
}

function isServiceRunning(): boolean {
  try {
    const pidFile = getPidFilePath()
    if (!fs.existsSync(pidFile)) return false
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
    try {
      process.kill(pid, 0) // signal 0 just checks existence
      return true
    } catch {
      // process doesn't exist
      try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
      return false
    }
  } catch {
    return false
  }
}

export function startHandoffService(): boolean {
  if (isServiceRunning()) {
    console.log('[FRP Studio] HandoffService is already running')
    return true
  }

  const jsPath = getServiceJsPath()
  const userDataPath = getUserDataPath()

  if (!fs.existsSync(jsPath)) {
    console.error(`[FRP Studio] HandoffService binary not found: ${jsPath}`)
    return false
  }

  console.log(`[FRP Studio] Starting HandoffService: ${jsPath}`)

  serviceProcess = spawn('node', [jsPath, userDataPath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  serviceProcess.unref()

  serviceProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[HandoffService stdout] ${line}`)
  })

  serviceProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.error(`[HandoffService stderr] ${line}`)
  })

  serviceProcess.on('exit', (code, signal) => {
    console.log(`[FRP Studio] HandoffService exited (code=${code}, signal=${signal})`)
    serviceProcess = null
    restartCount++

    if (restartCount <= MAX_RESTART) {
      console.log(`[FRP Studio] Restarting HandoffService in ${RESTART_DELAY}ms (attempt ${restartCount}/${MAX_RESTART})`)
      setTimeout(() => startHandoffService(), RESTART_DELAY)
    } else {
      console.error(`[FRP Studio] HandoffService failed after ${MAX_RESTART} restarts`)
    }
  })

  // Reset restart count after stable run
  setTimeout(() => { restartCount = 0 }, 30000)
  return true
}

export function stopHandoffService(): void {
  const pidFile = getPidFilePath()
  try {
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      process.kill(pid, 'SIGTERM')
      try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
    }
  } catch (e) {
    console.error('[FRP Studio] Failed to stop HandoffService:', e)
  }

  if (serviceProcess) {
    serviceProcess.kill('SIGTERM')
    serviceProcess = null
  }
}

export function restartHandoffService(): void {
  stopHandoffService()
  setTimeout(() => startHandoffService(), 1000)
}

export function getServiceStatus(): 'running' | 'stopped' | 'error' {
  return isServiceRunning() ? 'running' : 'stopped'
}

export function getServiceUptime(): number {
  const pidFile = getPidFilePath()
  if (!fs.existsSync(pidFile)) return 0
  try {
    // Approximate uptime via process start time on Windows
    const { execSync } = require('child_process')
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
    const output = execSync(`powershell -Command "(Get-Process -Id ${pid}).StartTime"`, { encoding: 'utf-8' }).trim()
    const startTime = new Date(output).getTime()
    return Date.now() - startTime
  } catch {
    return 0
  }
}
```

- [ ] **Step 2: 编译检查**

```bash
pnpm typecheck:node
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/main/handoff-service-manager.ts
git commit -m "feat: add HandoffService process lifecycle manager"
```

---

### Task 12: FRP Studio IPC 客户端（连接 HandoffService）

**Files:**
- Create: `src/main/handoff-ipc-client.ts`

- [ ] **Step 1: 创建 handoff-ipc-client.ts**

```typescript
import http from 'http'
import { BrowserWindow } from 'electron'

let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let config = { port: 19528 }
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function loadHandoffConfig(cfg: { port?: number }): void {
  if (cfg.port) config.port = cfg.port
}

async function httpGet(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${config.port}${path}`, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    }).on('error', reject)
  })
}

async function httpPost(path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : ''
    const req = http.request({
      hostname: '127.0.0.1',
      port: config.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string; uptime: number; connections: number; version: string }> {
  return httpGet('/health') as Promise<{ status: string; uptime: number; connections: number; version: string }>
}

export async function getPairedDevices(): Promise<unknown[]> {
  return httpGet('/devices') as Promise<unknown[]>
}

export async function notifyConfigChanged(): Promise<void> {
  await httpPost('/config')
}

export async function restartService(): Promise<void> {
  await httpPost('/restart')
}

export async function generatePairingQR(deviceName: string, devicePublicKey: string): Promise<{ success: boolean; qrData?: string; error?: string }> {
  return httpPost('/pair/generate', { deviceName, devicePublicKey }) as Promise<{ success: boolean; qrData?: string; error?: string }>
}

export async function confirmPairing(token: string, signedToken: string): Promise<{ success: boolean; error?: string }> {
  return httpPost('/pair/confirm', { token, signedToken }) as Promise<{ success: boolean; error?: string }>
}

export async function revokeDevice(deviceId: string): Promise<{ success: boolean }> {
  return httpPost(`/pair/revoke/${deviceId}`) as Promise<{ success: boolean }>
}

// ─── SSE Event Stream ───────────────────────────────────────────────────────

export function connectSSE(onEvent: (event: string, data: unknown) => void): () => void {
  const req = http.get(`http://127.0.0.1:${config.port}/events`, (res) => {
    let buffer = ''
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent(currentEvent, data)
          } catch { /* ignore */ }
        }
      }
    })
  })

  req.on('error', () => {
    // connection refused — service is probably down
    onEvent('error', { message: 'Cannot connect to HandoffService' })
  })

  return () => { req.destroy() }
}

// ─── Health Check Loop ──────────────────────────────────────────────────────

export function startHealthCheck(onStatusChange: (status: 'running' | 'stopped') => void): void {
  let lastStatus: 'running' | 'stopped' = 'stopped'

  healthCheckTimer = setInterval(async () => {
    try {
      await getHealth()
      if (lastStatus !== 'running') {
        lastStatus = 'running'
        onStatusChange('running')
      }
    } catch {
      if (lastStatus !== 'stopped') {
        lastStatus = 'stopped'
        onStatusChange('stopped')
      }
    }
  }, 3000)
}

export function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
}
```

- [ ] **Step 2: 编译检查**

```bash
pnpm typecheck:node
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/main/handoff-ipc-client.ts
git commit -m "feat: add HTTP client for FRP Studio ↔ HandoffService IPC"
```

---

### Task 13: FRP Studio IPC Handlers（渲染进程 ↔ 主进程）

**Files:**
- Create: `src/main/ipc/handoff.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 创建 ipc/handoff.ts**

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import {
  listPairedDevices,
  addPairedDevice,
  updatePairedDevice,
  deletePairedDevice,
  getPairedDeviceByDeviceId,
  listTransferHistory,
  addTransferHistory,
  clearTransferHistory
} from '../db'
import {
  startHandoffService,
  stopHandoffService,
  restartHandoffService,
  getServiceStatus,
  getServiceUptime
} from '../handoff-service-manager'
import {
  getHealth,
  getPairedDevices as getServiceDevices,
  notifyConfigChanged,
  generatePairingQR,
  revokeDevice as revokeServiceDevice,
  connectSSE,
  startHealthCheck,
  stopHealthCheck,
  setMainWindow,
  loadHandoffConfig
} from '../handoff-ipc-client'

let sseCleanup: (() => void) | null = null
let lastServiceStatus: 'running' | 'stopped' = 'stopped'

export function registerHandoffHandlers(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow()
  if (win) setMainWindow(win)

  // ─── Service lifecycle ──────────────────────────────────────────────────

  ipcMain.handle('handoff:start-service', async () => {
    return { success: startHandoffService() }
  })

  ipcMain.handle('handoff:stop-service', async () => {
    stopHandoffService()
    return { success: true }
  })

  ipcMain.handle('handoff:restart-service', async () => {
    restartHandoffService()
    return { success: true }
  })

  ipcMain.handle('handoff:service-status', async () => {
    return {
      status: getServiceStatus(),
      uptime: getServiceUptime(),
      health: await getHealth().catch(() => null)
    }
  })

  // ─── Paired devices ─────────────────────────────────────────────────────

  ipcMain.handle('handoff:list-devices', async () => {
    return listPairedDevices()
  })

  ipcMain.handle('handoff:delete-device', async (_e, id: number) => {
    const device = listPairedDevices().find((d) => d.id === id)
    if (device) {
      await revokeServiceDevice(device.device_id).catch(() => {})
      deletePairedDevice(id)
    }
    return { success: true }
  })

  ipcMain.handle('handoff:update-device', async (_e, id: number, data: { device_name?: string; enabled?: number }) => {
    updatePairedDevice(id, data)
    return { success: true }
  })

  // ─── Pairing ────────────────────────────────────────────────────────────

  ipcMain.handle('handoff:generate-pairing', async (_e, deviceName: string, devicePublicKey: string) => {
    const result = await generatePairingQR(deviceName, devicePublicKey)
    return result
  })

  // ─── Transfer history ───────────────────────────────────────────────────

  ipcMain.handle('handoff:transfer-history', async (_e, type?: string, limit?: number) => {
    return listTransferHistory(limit || 50, type)
  })

  ipcMain.handle('handoff:clear-history', async () => {
    clearTransferHistory()
    return { success: true }
  })

  // ─── SSE events forwarded to renderer ───────────────────────────────────

  ipcMain.handle('handoff:connect-sse', async (event) => {
    const rendererWin = BrowserWindow.fromWebContents(event.sender)
    if (!rendererWin) return

    if (sseCleanup) sseCleanup()

    sseCleanup = connectSSE((evt, data) => {
      if (rendererWin.isDestroyed()) return
      rendererWin.webContents.send('handoff:event', { event: evt, data })
    })

    startHealthCheck((status) => {
      if (rendererWin.isDestroyed()) return
      if (status !== lastServiceStatus) {
        lastServiceStatus = status
        rendererWin.webContents.send('handoff:service-status-change', { status })
      }
    })
  })

  ipcMain.handle('handoff:disconnect-sse', async () => {
    if (sseCleanup) {
      sseCleanup()
      sseCleanup = null
    }
    stopHealthCheck()
  })
}
```

- [ ] **Step 2: 在 index.ts 中注册**

在 `src/main/index.ts` 的 `app.whenReady()` 中添加：

```typescript
import { registerHandoffHandlers } from './ipc/handoff'
import { startHandoffService } from './handoff-service-manager'

// 在 app.whenReady().then(() => { ... }) 中添加：
registerHandoffHandlers(() => mainWindow)

// 启动 HandoffService
startHandoffService()
```

- [ ] **Step 3: 编译检查**

```bash
pnpm typecheck:node
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handoff.ts src/main/index.ts
git commit -m "feat: add handoff IPC handlers (main ↔ renderer)"
```

---

### Task 14: 预加载脚本扩展

**Files:**
- Modify: `src/preload/index.ts` (追加 handoff API)
- Modify: `src/renderer/src/env.d.ts` (追加类型声明)

- [ ] **Step 1: 在 preload/index.ts api 对象中追加 handoff**

```typescript
  handoff: {
    startService: () => ipcRenderer.invoke('handoff:start-service'),
    stopService: () => ipcRenderer.invoke('handoff:stop-service'),
    restartService: () => ipcRenderer.invoke('handoff:restart-service'),
    serviceStatus: () => ipcRenderer.invoke('handoff:service-status'),
    listDevices: () => ipcRenderer.invoke('handoff:list-devices'),
    deleteDevice: (id: number) => ipcRenderer.invoke('handoff:delete-device', id),
    updateDevice: (id: number, data: unknown) => ipcRenderer.invoke('handoff:update-device', id, data),
    generatePairing: (deviceName: string, devicePublicKey: string) =>
      ipcRenderer.invoke('handoff:generate-pairing', deviceName, devicePublicKey),
    transferHistory: (type?: string, limit?: number) =>
      ipcRenderer.invoke('handoff:transfer-history', type, limit),
    clearHistory: () => ipcRenderer.invoke('handoff:clear-history'),
    connectSSE: () => ipcRenderer.invoke('handoff:connect-sse'),
    disconnectSSE: () => ipcRenderer.invoke('handoff:disconnect-sse'),
    onEvent: (cb: (data: { event: string; data: unknown }) => void) => {
      ipcRenderer.on('handoff:event', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('handoff:event')
    },
    onServiceStatusChange: (cb: (data: { status: 'running' | 'stopped' }) => void) => {
      ipcRenderer.on('handoff:service-status-change', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('handoff:service-status-change')
    }
  },
```

在 api 对象类型的末尾（`window` 之前）插入。

- [ ] **Step 2: 在 env.d.ts 追加类型声明**

在 `Window.api` 接口中追加：

```typescript
      handoff: {
        startService(): Promise<{ success: boolean }>
        stopService(): Promise<{ success: boolean }>
        restartService(): Promise<{ success: boolean }>
        serviceStatus(): Promise<{
          status: 'running' | 'stopped'
          uptime: number
          health: { status: string; uptime: number; connections: number; version: string } | null
        }>
        listDevices(): Promise<unknown[]>
        deleteDevice(id: number): Promise<{ success: boolean }>
        updateDevice(id: number, data: { device_name?: string; enabled?: number }): Promise<{ success: boolean }>
        generatePairing(deviceName: string, devicePublicKey: string): Promise<{ success: boolean; qrData?: string; error?: string }>
        transferHistory(type?: string, limit?: number): Promise<unknown[]>
        clearHistory(): Promise<{ success: boolean }>
        connectSSE(): Promise<void>
        disconnectSSE(): Promise<void>
        onEvent(cb: (data: { event: string; data: unknown }) => void): () => void
        onServiceStatusChange(cb: (data: { status: 'running' | 'stopped' }) => void): () => void
      }
```

- [ ] **Step 3: 编译检查**

```bash
pnpm typecheck:node && pnpm typecheck:web
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: expose handoff API to renderer via preload"
```

---

### Task 15: Pinia Store

**Files:**
- Create: `src/renderer/src/stores/handoff.ts`

- [ ] **Step 1: 创建 stores/handoff.ts**

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PairedDevice {
  id: number
  device_id: string
  device_name: string
  platform: string
  paired_at: number
  last_seen: number
  enabled: number
}

export interface TransferRecord {
  id: number
  device_id: number
  type: string
  direction: string
  detail: string
  size: number
  status: string
  created_at: number
}

export const useHandoffStore = defineStore('handoff', () => {
  const serviceStatus = ref<'running' | 'stopped'>('stopped')
  const serviceUptime = ref(0)
  const serviceConnections = ref(0)
  const devices = ref<PairedDevice[]>([])
  const transferHistory = ref<TransferRecord[]>([])
  const sseCleanup = ref<(() => void) | null>(null)

  const isRunning = computed(() => serviceStatus.value === 'running')

  async function fetchServiceStatus(): Promise<void> {
    const result = await window.api.handoff.serviceStatus()
    serviceStatus.value = result.status
    serviceUptime.value = result.uptime
    if (result.health) {
      serviceConnections.value = result.health.connections
    }
  }

  async function startService(): Promise<void> {
    await window.api.handoff.startService()
    await fetchServiceStatus()
  }

  async function stopService(): Promise<void> {
    await window.api.handoff.stopService()
    serviceStatus.value = 'stopped'
  }

  async function restartService(): Promise<void> {
    await window.api.handoff.restartService()
    await fetchServiceStatus()
  }

  async function fetchDevices(): Promise<void> {
    devices.value = (await window.api.handoff.listDevices()) as PairedDevice[]
  }

  async function deleteDevice(id: number): Promise<void> {
    await window.api.handoff.deleteDevice(id)
    devices.value = devices.value.filter((d) => d.id !== id)
  }

  async function updateDevice(id: number, data: { device_name?: string; enabled?: number }): Promise<void> {
    await window.api.handoff.updateDevice(id, data)
    await fetchDevices()
  }

  async function generatePairing(deviceName: string, devicePublicKey: string): Promise<{ success: boolean; qrData?: string; error?: string }> {
    return window.api.handoff.generatePairing(deviceName, devicePublicKey)
  }

  async function fetchTransferHistory(type?: string): Promise<void> {
    transferHistory.value = (await window.api.handoff.transferHistory(type)) as TransferRecord[]
  }

  async function clearHistory(): Promise<void> {
    await window.api.handoff.clearHistory()
    transferHistory.value = []
  }

  function connectSSE(): void {
    window.api.handoff.connectSSE()
    const clean1 = window.api.handoff.onEvent(({ event, data }) => {
      if (event === 'ws-connection' || event === 'ws-disconnection') {
        serviceConnections.value = (data as { connected: number }).connected
      } else if (event === 'config-reloaded') {
        fetchDevices()
      }
    })
    const clean2 = window.api.handoff.onServiceStatusChange(({ status }) => {
      serviceStatus.value = status
    })
    sseCleanup.value = () => { clean1(); clean2() }
  }

  function disconnectSSE(): void {
    if (sseCleanup.value) {
      sseCleanup.value()
      sseCleanup.value = null
    }
    window.api.handoff.disconnectSSE()
  }

  return {
    serviceStatus, serviceUptime, serviceConnections, devices, transferHistory,
    isRunning,
    fetchServiceStatus, startService, stopService, restartService,
    fetchDevices, deleteDevice, updateDevice, generatePairing,
    fetchTransferHistory, clearHistory,
    connectSSE, disconnectSSE
  }
})
```

- [ ] **Step 2: 编译检查**

```bash
pnpm typecheck:web
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/handoff.ts
git commit -m "feat: add handoff Pinia store"
```

---

### Task 16: FRP Studio 接力 UI — 页面布局和路由

**Files:**
- Create: `src/renderer/src/views/HandoffView.vue`
- Modify: `src/renderer/src/router/index.ts`

- [ ] **Step 1: 创建 HandoffView.vue 布局**

```vue
<template>
  <div class="handoff-page">
    <a-page-header title="设备接力" sub-title="iOS & Windows 剪贴板 · 文件 · 设备发现">
      <template #extra>
        <a-space>
          <a-badge :status="store.isRunning ? 'processing' : 'default'" />
          <span style="color: #8c9aab;">{{ store.isRunning ? '服务运行中' : '服务已停止' }}</span>
          <a-button size="small" @click="store.restartService()">重启服务</a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-tabs v-model:activeKey="activeTab" style="padding: 0 24px;">
      <a-tab-pane key="devices" tab="设备管理">
        <DeviceList />
      </a-tab-pane>
      <a-tab-pane key="history" tab="传输记录">
        <TransferHistory />
      </a-tab-pane>
      <a-tab-pane key="settings" tab="服务设置">
        <HandoffSettings />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useHandoffStore } from '../stores/handoff'
import DeviceList from '../components/DeviceList.vue'
import TransferHistory from '../components/TransferHistory.vue'
import HandoffSettings from '../components/HandoffSettings.vue'

const store = useHandoffStore()
const activeTab = ref('devices')

onMounted(async () => {
  await store.fetchServiceStatus()
  await store.fetchDevices()
  store.connectSSE()
})

onUnmounted(() => {
  store.disconnectSSE()
})
</script>
```

- [ ] **Step 2: 添加路由**

在 `src/renderer/src/router/index.ts` 的 routes 数组中添加：

```typescript
    {
      path: '/handoff',
      name: 'Handoff',
      component: () => import('../views/HandoffView.vue')
    },
```

- [ ] **Step 3: 编译检查**

```bash
pnpm typecheck:web
```
Expected: 无错误（注意组件引用尚未创建，这些先占位）

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/HandoffView.vue src/renderer/src/router/index.ts
git commit -m "feat: add HandoffView page layout and route"
```

---

### Task 17: 接力 UI 组件

**Files:**
- Create: `src/renderer/src/components/DeviceList.vue`
- Create: `src/renderer/src/components/PairingQRModal.vue`
- Create: `src/renderer/src/components/TransferHistory.vue`
- Create: `src/renderer/src/components/HandoffSettings.vue`

- [ ] **Step 1: DeviceList.vue**

```vue
<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <span style="color: #8c9aab;">共 {{ store.devices.length }} 台已配对设备</span>
      <a-button type="primary" @click="showQRModal = true" :disabled="!store.isRunning">生成配对码</a-button>
    </div>

    <a-list
      :data-source="store.devices"
      :locale="{ emptyText: '暂无已配对设备，点击"生成配对码"开始配对' }"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #avatar>
              <span style="font-size: 24px;">📱</span>
            </template>
            <template #title>
              {{ item.device_name }}
              <a-tag :color="item.enabled ? 'green' : 'default'" style="margin-left: 8px;">
                {{ item.enabled ? '已启用' : '已停用' }}
              </a-tag>
            </template>
            <template #description>
              {{ item.platform }} · ID: {{ item.device_id }} · 配对于 {{ new Date(item.paired_at * 1000).toLocaleDateString() }}
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-button size="small" type="link" danger @click="handleDelete(item.id)">解除配对</a-button>
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

async function handleDelete(id: number): Promise<void> {
  await store.deleteDevice(id)
}
</script>
```

- [ ] **Step 2: PairingQRModal.vue**

```vue
<template>
  <a-modal
    :open="open"
    title="配对二维码"
    @cancel="$emit('close')"
    :footer="null"
    width="400px"
  >
    <div style="text-align: center;">
      <p style="color: #8c9aab; margin-bottom: 16px;">使用 iOS Handoff App 扫描此二维码完成配对</p>
      <div style="background: #fff; padding: 16px; display: inline-block; border-radius: 8px;">
        <canvas ref="qrCanvas" width="256" height="256"></canvas>
      </div>
      <p style="color: #8c9aab; margin-top: 12px; font-size: 12px;">二维码有效期：5 分钟</p>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useHandoffStore } from '../stores/handoff'

const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const store = useHandoffStore()
const qrCanvas = ref<HTMLCanvasElement | null>(null)

watch(() => props.open, async (val) => {
  if (val && qrCanvas.value) {
    const result = await store.generatePairing('My iPhone', 'placeholder-key')
    if (result.success && result.qrData) {
      drawQR(qrCanvas.value, result.qrData)
    }
  }
})

function drawQR(canvas: HTMLCanvasElement, data: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // Simple QR placeholder — 实际应用中使用 qrcode 库
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 256, 256)
  ctx.fillStyle = '#000'
  ctx.font = '12px monospace'
  ctx.fillText(data.slice(0, 50), 10, 128)
  ctx.fillText('(QR Code)', 10, 148)
}
</script>
```

**注：** 后续需要安装 `qrcode` 库并替换 `drawQR` 为实际的 QR 码渲染。安装方式:
```bash
pnpm add qrcode && pnpm add -D @types/qrcode
```
然后使用 `import QRCode from 'qrcode'` 调用 `QRCode.toCanvas(canvas, data)`。

- [ ] **Step 3: TransferHistory.vue**

```vue
<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between;">
      <a-radio-group v-model:value="filter" button-style="solid" size="small">
        <a-radio-button value="">全部</a-radio-button>
        <a-radio-button value="clipboard">剪贴板</a-radio-button>
        <a-radio-button value="file">文件</a-radio-button>
      </a-radio-group>
      <a-button size="small" @click="handleClear">清空记录</a-button>
    </div>

    <a-table
      :dataSource="store.transferHistory"
      :columns="columns"
      :pagination="{ pageSize: 20, showSizeChanger: false }"
      size="small"
      rowKey="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <a-tag :color="record.type === 'clipboard' ? 'blue' : 'green'">
            {{ record.type === 'clipboard' ? '剪贴板' : '文件' }}
          </a-tag>
        </template>
        <template v-if="column.key === 'direction'">
          <span :style="{ color: record.direction === 'send' ? '#faad14' : '#4096ff' }">
            {{ record.direction === 'send' ? '发送' : '接收' }}
          </span>
        </template>
        <template v-if="column.key === 'status'">
          <span :style="{ color: record.status === 'success' ? '#52c41a' : '#ff4d4f' }">
            {{ record.status === 'success' ? '✓' : '✗' }}
          </span>
        </template>
        <template v-if="column.key === 'created_at'">
          {{ new Date(record.created_at * 1000).toLocaleTimeString() }}
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useHandoffStore } from '../stores/handoff'

const store = useHandoffStore()
const filter = ref('')

const columns = [
  { title: '时间', key: 'created_at', dataIndex: 'created_at' },
  { title: '类型', key: 'type', dataIndex: 'type' },
  { title: '方向', key: 'direction', dataIndex: 'direction' },
  { title: '详情', key: 'detail', dataIndex: 'detail' },
  { title: '大小', key: 'size', dataIndex: 'size' },
  { title: '状态', key: 'status', dataIndex: 'status' }
]

watch(filter, (val) => {
  store.fetchTransferHistory(val || undefined)
})

onMounted(() => {
  store.fetchTransferHistory()
})

async function handleClear(): Promise<void> {
  await store.clearHistory()
}
</script>
```

- [ ] **Step 4: HandoffSettings.vue**

```vue
<template>
  <a-form layout="vertical" style="max-width: 480px;">
    <a-form-item label="设备名称">
      <a-input v-model:value="deviceName" placeholder="My-Windows-PC" />
    </a-form-item>

    <a-form-item label="文件下载目录">
      <a-input v-model:value="downloadDir" placeholder="Downloads/FrpTransfer" />
    </a-form-item>

    <a-form-item label="剪贴板大小限制">
      <a-input-number v-model:value="clipboardMaxSize" :min="1024" :max="104857600" style="width: 100%;" addon-after="bytes" />
    </a-form-item>

    <a-divider>FRP 隧道</a-divider>

    <a-form-item label="启用 FRP 隧道中转">
      <a-switch v-model:checked="frpTunnelEnabled" />
      <span style="margin-left: 8px; color: #8c9aab; font-size: 12px;">局域网不可达时自动切换</span>
    </a-form-item>

    <a-form-item>
      <a-button type="primary" @click="handleSave">保存设置</a-button>
    </a-form-item>
  </a-form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const deviceName = ref('My-Windows-PC')
const downloadDir = ref('Downloads/FrpTransfer')
const clipboardMaxSize = ref(1048576)
const frpTunnelEnabled = ref(false)

async function handleSave(): Promise<void> {
  // Save settings via config IPC, which triggers hot reload in HandoffService
  await window.api.config.set({
    deviceName: deviceName.value,
    downloadDir: downloadDir.value,
    clipboardMaxSize: clipboardMaxSize.value,
    frpTunnelEnabled: frpTunnelEnabled.value
  } as unknown as Partial<import('../stores/config').AppConfig>)
  message.success('设置已保存，HandoffService 将自动重载配置')
}
</script>
```

- [ ] **Step 5: 编译检查**

```bash
pnpm typecheck:web
```
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DeviceList.vue src/renderer/src/components/PairingQRModal.vue src/renderer/src/components/TransferHistory.vue src/renderer/src/components/HandoffSettings.vue
git commit -m "feat: add handoff UI components (DeviceList, PairingQR, TransferHistory, Settings)"
```

---

### Task 18: 导航栏集成

**Files:**
- Modify: `src/renderer/src/App.vue`

- [ ] **Step 1: 在 App.vue 导航中添加接力入口**

根据现有 App.vue 中的导航结构，在导航菜单中添加：

```html
<a-menu-item key="handoff">
  <template #icon><span>⟐</span></template>
  接力
</a-menu-item>
```

并在菜单点击事件中处理路由跳转：
```typescript
// 在 handleMenuClick 中添加:
if (key === 'handoff') router.push('/handoff')
```

（实际修改需根据 App.vue 的具体结构而定。如果使用不同的导航实现方式，只需确保 `/handoff` 路由可访问即可。）

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/App.vue
git commit -m "feat: add handoff tab to navigation"
```

---

### Task 19: HandoffService 构建集成到 electron-builder

**Files:**
- Modify: `package.json` (build 脚本、files 配置)
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: 更新 package.json build 脚本**

在 `scripts` 中修改 build 脚本，确保 handoff-service 也被构建：

```json
"build:handoff": "npx esbuild src/handoff-service/index.ts --bundle --platform=node --target=node18 --outfile=out/handoff-service/index.js --external:electron",
"build": "npm run typecheck && npm run build:handoff && electron-vite build && electron-builder",
```

确保 `build.files` 已包含 `out/**/*`（现有配置已包含）。

- [ ] **Step 2: 添加 .gitignore 规则**

确保 `out/` 不被 track（`.gitignore` 中已有 `out`，无需额外修改）。

- [ ] **Step 3: 构建验证**

```bash
pnpm build:handoff
ls -la out/handoff-service/index.js
```
Expected: 文件存在且大小 > 0

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: integrate HandoffService build into pipeline"
```

---

### Task 20: iOS App — Xcode 项目创建

**Files:**
- Create: `ios/HandoffApp/` 目录结构和 Xcode project 文件

> **注意：** 此 task 在 Windows 上无法直接完成（需要 Xcode）。通过 GitHub Actions 构建时创建。这里创建源代码文件。

- [ ] **Step 1: 创建 iOS 项目目录结构**

```bash
mkdir -p ios/HandoffApp/HandoffApp/Views
mkdir -p ios/HandoffApp/HandoffApp/Services
mkdir -p ios/HandoffApp/HandoffApp/Models
mkdir -p ios/HandoffApp/ShareExtension
```

- [ ] **Step 2: 创建 App.swift**

`ios/HandoffApp/HandoffApp/App.swift`:

```swift
import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
                .onAppear {
                    connectionManager.startDiscovery()
                }
        }
    }
}
```

- [ ] **Step 3: 创建 ContentView.swift**

`ios/HandoffApp/HandoffApp/Views/ContentView.swift`:

```swift
import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showPairing = false

    var body: some View {
        NavigationView {
            List {
                Section("已配对设备") {
                    if connectionManager.pairedDevices.isEmpty {
                        Text("暂无配对设备")
                            .foregroundColor(.secondary)
                    }
                    ForEach(connectionManager.pairedDevices) { device in
                        HStack {
                            Image(systemName: "desktopcomputer")
                            VStack(alignment: .leading) {
                                Text(device.name)
                                Text(device.status)
                                    .font(.caption)
                                    .foregroundColor(device.isConnected ? .green : .secondary)
                            }
                        }
                    }
                }

                Section("快速操作") {
                    Button(action: { connectionManager.pullClipboard() }) {
                        Label("获取 Windows 剪贴板", systemImage: "doc.on.clipboard")
                    }
                }
            }
            .navigationTitle("Handoff")
            .toolbar {
                Button(action: { showPairing = true }) {
                    Image(systemName: "qrcode.viewfinder")
                }
            }
            .sheet(isPresented: $showPairing) {
                PairingView()
            }
        }
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add ios/
git commit -m "feat: add iOS app SwiftUI source files"
```

---

### Task 21: iOS App — 核心服务

**Files:**
- Create: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift`
- Create: `ios/HandoffApp/HandoffApp/Services/DiscoveryService.swift`
- Create: `ios/HandoffApp/HandoffApp/Services/ClipboardService.swift`

- [ ] **Step 1: ConnectionManager.swift**

```swift
import Foundation
import Network

class ConnectionManager: ObservableObject {
    @Published var pairedDevices: [PairedDevice] = []
    @Published var isScanning = false
    @Published var clipboardContent: String?

    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)

    func startDiscovery() {
        isScanning = true
        // mDNS browsing via NSNetServiceBrowser
        let browser = NetServiceBrowser()
        // (see DiscoveryService)
    }

    func connect(to host: String, port: UInt16) {
        let url = URL(string: "ws://\(host):\(port)")!
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        receiveMessage()
    }

    func pullClipboard() {
        guard let ws = webSocket else { return }
        let message = URLSessionWebSocketTask.Message.string("{\"type\":\"clipboard:latest\"}")
        ws.send(message) { _ in }
    }

    func sendClipboard(_ content: String) {
        guard let ws = webSocket else { return }
        let msg = "{\"type\":\"clipboard\",\"payload\":\"\(content.replacingOccurrences(of: "\"", with: "\\\""))\",\"timestamp\":\(Date().timeIntervalSince1970)}"
        ws.send(.string(msg)) { _ in }
    }

    func sendFile(url: URL) {
        // Share Extension trigger
    }

    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleMessage(text)
                case .data(let data):
                    self?.handleBinaryMessage(data)
                @unknown default: break
                }
                self?.receiveMessage()
            case .failure:
                break
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        DispatchQueue.main.async {
            switch type {
            case "clipboard":
                self.clipboardContent = json["payload"] as? String
                if let content = self.clipboardContent {
                    UIPasteboard.general.string = content
                }
            case "file:offer":
                // Present accept/reject UI
                break
            default:
                break
            }
        }
    }

    private func handleBinaryMessage(_ data: Data) {
        // File chunk handling
    }
}
```

- [ ] **Step 2: DiscoveryService.swift**

```swift
import Foundation

class DiscoveryService: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    var onDeviceFound: ((String, UInt16, [String: String]) -> Void)?

    private var browser: NetServiceBrowser?

    func startBrowsing() {
        browser = NetServiceBrowser()
        browser?.delegate = self
        browser?.searchForServices(ofType: "_handoff._tcp.", inDomain: "local.")
    }

    func stopBrowsing() {
        browser?.stop()
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        service.resolve(withTimeout: 5)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let hostName = sender.hostName else { return }
        let port = sender.port
        let txtData = NetService.dictionary(fromTXTRecordData: sender.txtRecordData() ?? Data())
        var info: [String: String] = [:]
        for (key, value) in txtData {
            info[key] = String(data: value, encoding: .utf8)
        }
        onDeviceFound?(hostName, port, info)
    }
}
```

- [ ] **Step 3: ClipboardService.swift**

```swift
import UIKit

class ClipboardService {
    static let shared = ClipboardService()

    func getClipboard() -> String? {
        return UIPasteboard.general.string
    }

    func setClipboard(_ text: String) {
        UIPasteboard.general.string = text
    }
}
```

- [ ] **Step 4: 创建 Models/Device.swift**

```swift
import Foundation

struct PairedDevice: Identifiable, Codable {
    var id: String { deviceId }
    let deviceId: String
    var name: String
    let platform: String
    var isConnected: Bool = false

    var status: String {
        isConnected ? "在线" : "离线"
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add ios/
git commit -m "feat: add iOS app core services (Connection, Discovery, Clipboard)"
```

---

### Task 22: iOS Share Extension + GitHub Actions CI

**Files:**
- Create: `ios/HandoffApp/ShareExtension/ShareViewController.swift`
- Create: `ios/HandoffApp/ShareExtension/Info.plist`
- Create: `.github/workflows/ios-build.yml`

- [ ] **Step 1: ShareViewController.swift**

```swift
import UIKit
import Social

class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { return true }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = item.attachments?.first else { return }

        if attachment.hasItemConformingToTypeIdentifier("public.plain-text") {
            attachment.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { (text, _) in
                if let text = text as? String {
                    // Send to Windows via shared UserDefaults
                    let shared = UserDefaults(suiteName: "group.com.frper.handoff")
                    shared?.set(text, forKey: "pending_clipboard")
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else if attachment.hasItemConformingToTypeIdentifier("public.image") {
            attachment.loadItem(forTypeIdentifier: "public.image", options: nil) { (imageURL, _) in
                if let url = imageURL as? URL {
                    let shared = UserDefaults(suiteName: "group.com.frper.handoff")
                    shared?.set(url.path, forKey: "pending_file")
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else if attachment.hasItemConformingToTypeIdentifier("public.url") {
            attachment.loadItem(forTypeIdentifier: "public.url", options: nil) { (url, _) in
                if let url = url as? URL {
                    let shared = UserDefaults(suiteName: "group.com.frper.handoff")
                    shared?.set(url.absoluteString, forKey: "pending_clipboard")
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        }
    }

    override func configurationItems() -> [Any]! { return [] }
}
```

- [ ] **Step 2: ShareExtension Info.plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPrincipalClass</key>
        <string>ShareViewController</string>
        <key>NSExtensionAttributes</key>
        <dict>
            <key>NSExtensionActivationRule</key>
            <dict>
                <key>NSExtensionActivationSupportsText</key>
                <true/>
                <key>NSExtensionActivationSupportsImageWithMaxCount</key>
                <integer>10</integer>
                <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
                <integer>1</integer>
                <key>NSExtensionActivationSupportsFileWithMaxCount</key>
                <integer>10</integer>
            </dict>
        </dict>
    </dict>
</dict>
</plist>
```

- [ ] **Step 3: GitHub Actions CI**

`.github/workflows/ios-build.yml`:

```yaml
name: iOS Build
on:
  push:
    branches: [main]
    paths:
      - 'ios/**'
  workflow_dispatch:

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4

      - name: Build iOS App
        run: |
          cd ios/HandoffApp
          xcodebuild -project HandoffApp.xcodeproj \
            -scheme HandoffApp \
            -sdk iphoneos \
            -configuration Release \
            -archivePath build/HandoffApp.xcarchive \
            archive \
            CODE_SIGN_IDENTITY="" \
            CODE_SIGNING_REQUIRED=NO \
            CODE_SIGNING_ALLOWED=NO

      - name: Export IPA
        run: |
          cd ios/HandoffApp
          xcodebuild -exportArchive \
            -archivePath build/HandoffApp.xcarchive \
            -exportPath build/ \
            -exportOptionsPlist ExportOptions.plist

      - name: Upload IPA
        uses: actions/upload-artifact@v4
        with:
          name: HandoffApp.ipa
          path: ios/HandoffApp/build/HandoffApp.ipa
```

- [ ] **Step 4: Commit**

```bash
git add ios/HandoffApp/ShareExtension/ .github/workflows/ios-build.yml
git commit -m "feat: add iOS Share Extension and GitHub Actions build workflow"
```

---

### Task 23: 端到端集成验证

- [ ] **Step 1: 完整构建**

```bash
pnpm build:handoff
pnpm typecheck
```
Expected: 无错误

- [ ] **Step 2: 验证 HandoffService 启动**

```bash
node out/handoff-service/index.js &
sleep 2
curl http://localhost:19528/health
curl http://localhost:19528/devices
curl -X POST http://localhost:19528/restart
```
Expected: health 返回运行状态，devices 返回空数组

- [ ] **Step 3: 验证 IPC 通信流程**

启动 FRP Studio dev 模式：
```bash
pnpm dev
```
Expected: 
- FRP Studio 启动后自动启动 HandoffService
- 接力页面可访问（`http://localhost:5173/#/handoff`）
- 服务状态显示"运行中"
- 可查看已配对设备列表（空）

- [ ] **Step 4: Commit 最终集成**

```bash
git add -A
git commit -m "feat: complete handoff module integration"
```

---

## 实现顺序总结

```
Phase 1: 基础设施
  Task 1  → 安装依赖
  Task 2  → 数据库 Schema
  Task 3  → HandoffService 骨架
  Task 4  → HTTP + SSE 服务器

Phase 2: HandoffService 核心
  Task 5  → mDNS 广播
  Task 6  → WebSocket 服务器
  Task 7  → 配对 + 加密
  Task 8  → 剪贴板监听
  Task 9  → 文件传输引擎
  Task 10 → PID 管理

Phase 3: FRP Studio 集成
  Task 11 → 进程管理
  Task 12 → IPC 客户端
  Task 13 → IPC Handlers
  Task 14 → 预加载 API
  Task 15 → Pinia Store
  Task 16 → 页面布局 + 路由

Phase 4: UI
  Task 17 → 组件 (DeviceList, PairingQR, TransferHistory, Settings)
  Task 18 → 导航集成
  Task 19 → 构建集成

Phase 5: iOS
  Task 20 → Xcode 项目 + 基础 UI
  Task 21 → 核心服务
  Task 22 → Share Extension + CI

Phase 6: 验证
  Task 23 → 端到端集成验证
```
