# Code Review 修复 — 实现计划

> **For agentic workers:** Use superpowers:dispatching-parallel-agents to implement. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 修复代码审查发现的 15 个确认问题（安全 ×3 + 功能完整性 ×5 + 体验 ×7）

**Architecture:** 直接修改现有文件，不新增文件。按文件分组 6 个任务，减少冲突。

---

### Task 1: 安全修复（clipboard.ts, file-transfer.ts, index.ts）— #1, #2, #3

**Files:** `src/handoff-service/clipboard.ts:55-59`, `src/handoff-service/file-transfer.ts:76,89-121`, `src/handoff-service/index.ts:44-47`

- [ ] **Step 1: 修复 writeClipboard 命令注入 (#1)**

将 `src/handoff-service/clipboard.ts` 第 55-58 行改为：

```typescript
export function writeClipboard(text: string): void {
  const cmd = `Set-Clipboard -Value ${JSON.stringify(text)}`
  const encoded = Buffer.from(cmd, 'utf-16le').toString('base64')
  execSync(`powershell -EncodedCommand ${encoded}`, { encoding: 'utf-8' })
  cachedContent = text
  cachedHash = hashContent(text)
}
```

- [ ] **Step 2: 移除 handleFileRequest (#2)**

在 `src/handoff-service/file-transfer.ts` 中删除第 89-121 行（整个 `handleFileRequest` 函数）。

在 `src/handoff-service/index.ts` 中删除第 44-47 行：
```typescript
  registerHandler('file:request', (ws, msg) => {
    handleFileRequest(ws, msg as { filePath: string })
  })
```

- [ ] **Step 3: 添加路经穿越防护 (#3)**

在 `src/handoff-service/file-transfer.ts` 的 `completeReceive` 函数中，将第 76 行：
```typescript
  const destPath = path.join(downloadDir, transfer.filename)
```
替换为：
```typescript
  const safeName = path.basename(transfer.filename)
  const resolvedDest = path.resolve(path.join(downloadDir, safeName))
  if (!resolvedDest.startsWith(path.resolve(downloadDir))) {
    sendToClient(transfer.ws, 'file:error', { transferId, error: 'path traversal blocked' })
    activeTransfers.delete(transferId)
    return
  }
  const destPath = resolvedDest
```

- [ ] **Step 4: 编译验证 + 提交**

```bash
cd D:/workspace/frp-studio && export HTTP_PROXY="http://127.0.0.1:7897" && export HTTPS_PROXY="http://127.0.0.1:7897" && npx tsc --noEmit -p src/handoff-service/tsconfig.json
```

```bash
git add src/handoff-service/clipboard.ts src/handoff-service/file-transfer.ts src/handoff-service/index.ts
git commit -m "fix: security fixes - command injection, arbitrary file read, path traversal"
```

---

### Task 2: 文件传输加固（file-transfer.ts）— #8, #9

**Files:** `src/handoff-service/file-transfer.ts:24-40`

- [ ] **Step 1: 添加文件大小校验**

在 `CHUNK_SIZE` 常量后添加：
```typescript
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
```

在 `handleFileOffer` 函数开头（第 25 行之前）添加：
```typescript
  if (msg.size <= 0 || msg.size > MAX_FILE_SIZE) {
    sendToClient(ws, 'file:error', { error: `file size must be between 1 and ${MAX_FILE_SIZE} bytes` })
    return
  }
```

- [ ] **Step 2: 编译验证 + 提交**

```bash
cd D:/workspace/frp-studio && export HTTP_PROXY="http://127.0.0.1:7897" && export HTTPS_PROXY="http://127.0.0.1:7897" && npx tsc --noEmit -p src/handoff-service/tsconfig.json
```

```bash
git add src/handoff-service/file-transfer.ts
git commit -m "fix: add file size limits to prevent OOM and zero-size memory leaks"
```

---

### Task 3: 配置 + 数据完整性（config.ts, http-server.ts）— #4, #10

**Files:** `src/handoff-service/config.ts:45-51,62-68`, `src/handoff-service/http-server.ts:82-99,101-133`

- [ ] **Step 1: 修复配置浅合并 (#10)**

在 `src/handoff-service/config.ts` 的 `loadConfig` 中，将第 47 行：
```typescript
      config = { ...defaultConfig, ...JSON.parse(raw) }
```
替换为：
```typescript
      const parsed = JSON.parse(raw)
      config = {
        ...defaultConfig,
        ...parsed,
        server: { ...defaultConfig.server, ...(parsed.server || {}) },
        device: { ...defaultConfig.device, ...(parsed.device || {}) },
        features: { ...defaultConfig.features, ...(parsed.features || {}) },
        frpTunnel: { ...defaultConfig.frpTunnel, ...(parsed.frpTunnel || {}) }
      }
```

同样修改 `reloadConfig` 中第 66 行的对应代码。

- [ ] **Step 2: 添加 POST body 大小限制 (#4)**

在 `src/handoff-service/http-server.ts` 的 `/pair/generate` 和 `/pair/confirm` 处理中，添加：
```typescript
    const MAX_BODY = 1024 * 1024 // 1MB
    let bodyLength = 0
    req.on('data', (chunk) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'request body too large' }))
        req.destroy()
        return
      }
      body += chunk
    })
```

（在两个 POST 端点各添加一次）

- [ ] **Step 3: 扩展 /health 返回配置摘要 (#13 前置)**

将 `/health` 响应（第 46-51 行）改为：
```typescript
    const config = getConfig()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'running',
      uptime: process.uptime(),
      connections: sseClients.size,
      version: '0.1.0',
      config: {
        deviceName: config.device.name,
        port: config.server.port,
        downloadDir: config.device.downloadDir || '',
        clipboardMaxSize: config.features.clipboardMaxSize,
        frpTunnelEnabled: config.frpTunnel.enabled
      }
    }))
```

- [ ] **Step 4: 编译验证 + 提交**

```bash
cd D:/workspace/frp-studio && export HTTP_PROXY="http://127.0.0.1:7897" && export HTTPS_PROXY="http://127.0.0.1:7897" && npx tsc --noEmit -p src/handoff-service/tsconfig.json
```

```bash
git add src/handoff-service/config.ts src/handoff-service/http-server.ts
git commit -m "fix: deep config merge, POST body limit, health config exposure"
```

---

### Task 4: 产品包路径 + 重启计数器（handoff-service-manager.ts, package.json）— #6, 重启计数

**Files:** `src/main/handoff-service-manager.ts:11-16,81`, `package.json`

- [ ] **Step 1: 修复产品包路径 (#6)**

将 `src/main/handoff-service-manager.ts` 第 11-16 行的 `getServiceJsPath` 改为：
```typescript
function getServiceJsPath(): string {
  const devPath = path.join(app.getAppPath(), 'out', 'handoff-service', 'index.js')
  const packagedPath = path.join(process.resourcesPath, 'out', 'handoff-service', 'index.js')

  if (app.isPackaged) {
    if (fs.existsSync(packagedPath)) return packagedPath
    return devPath // fallback for ASAR-based packaging
  }
  return devPath
}
```

- [ ] **Step 2: 添加 extraResources 配置 (#6 补充)**

在 `package.json` 的 `build` 字段中，`"extraResources"` 数组添加：
```json
{ "from": "out/handoff-service", "to": "out/handoff-service" }
```

- [ ] **Step 3: 修复重启计数器 off-by-one**

将第 81 行 `if (restartCount <= MAX_RESTART)` 改为 `if (restartCount < MAX_RESTART)`。

- [ ] **Step 4: 编译验证**

```bash
cd D:/workspace/frp-studio && export HTTP_PROXY="http://127.0.0.1:7897" && export HTTPS_PROXY="http://127.0.0.1:7897" && npx tsc --noEmit -p tsconfig.node.json --composite false
```

- [ ] **Step 5: 提交**

```bash
git add src/main/handoff-service-manager.ts package.json
git commit -m "fix: packaging path fallback, extraResources, restart counter off-by-one"
```

---

### Task 5: 配置通知链路 + 统一数据源（ipc/handoff.ts, preload, env.d.ts, HandoffSettings.vue）— #5, #11, #12, #13

**Files:** `src/main/ipc/handoff.ts:17,48-67,76-79`, `src/preload/index.ts:109-112`, `src/renderer/src/env.d.ts`, `src/renderer/src/components/HandoffSettings.vue:43-67`

- [ ] **Step 1: 修复 IPC handlers — 统一数据源 + 通知 + 错误处理**

修改 `src/main/ipc/handoff.ts`：
- Import 添加: `notifyConfigChanged, getPairedDevices`
- 删除 import 中的: `listPairedDevices, updatePairedDevice, deletePairedDevice`（改为从服务端获取）
- `handoff:list-devices` handler 改为:
```typescript
  ipcMain.handle('handoff:list-devices', async () => {
    try {
      return await getPairedDevices()
    } catch {
      return []
    }
  })
```
- `handoff:delete-device` handler 改为:
```typescript
  ipcMain.handle('handoff:delete-device', async (_e, deviceId: string) => {
    const result = await revokeServiceDevice(deviceId)
    return result
  })
```
- 添加 `handoff:notify-config` handler:
```typescript
  ipcMain.handle('handoff:notify-config', async () => {
    await notifyConfigChanged()
    return { success: true }
  })
```
- `handoff:generate-pairing` handler 添加 try/catch:
```typescript
  ipcMain.handle('handoff:generate-pairing', async (_e, deviceName: string, devicePublicKey: string) => {
    try {
      return await generatePairingQR(deviceName, devicePublicKey)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
```

- [ ] **Step 2: 扩展 preload**

在 `src/preload/index.ts` 的 `handoff` 对象中添加：
```typescript
    notifyConfig: () => ipcRenderer.invoke('handoff:notify-config'),
```
并修改 `deleteDevice` 签名为接收 `deviceId: string`。

- [ ] **Step 3: 更新类型声明**

`src/renderer/src/env.d.ts` 中 `handoff` 类型声明：
- 添加 `notifyConfig(): Promise<{ success: boolean }>`
- `deleteDevice` 参数改为 `deviceId: string`
- `listDevices` 返回 `Promise<unknown[]>` 不变

- [ ] **Step 4: 修复 HandoffSettings.vue**

替换 `onMounted` 和 `handleSave`：
```typescript
onMounted(async () => {
  try {
    const status = await window.api.handoff.serviceStatus()
    if (status.health?.config) {
      const c = status.health.config
      deviceName.value = c.deviceName || 'My-Windows-PC'
      servicePort.value = c.port || 19528
      downloadDir.value = c.downloadDir || 'Downloads/FrpTransfer'
      clipboardMaxSize.value = c.clipboardMaxSize || 1048576
      frpTunnelEnabled.value = c.frpTunnelEnabled || false
    }
  } catch { /* service may not be running */ }
})

async function handleSave(): Promise<void> {
  saved.value = false
  try {
    await window.api.handoff.notifyConfig()
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch {
    // silently handle
  }
}
```

移除旧的 `window.api.config.set()` 调用。

- [ ] **Step 5: 编译验证**

```bash
cd D:/workspace/frp-studio && export HTTP_PROXY="http://127.0.0.1:7897" && export HTTPS_PROXY="http://127.0.0.1:7897" && npx tsc --noEmit -p tsconfig.node.json --composite false && npx vue-tsc --noEmit -p tsconfig.web.json --composite false
```

- [ ] **Step 6: 提交**

```bash
git add src/main/ipc/handoff.ts src/preload/index.ts src/renderer/src/env.d.ts src/renderer/src/components/HandoffSettings.vue
git commit -m "fix: unified data source, config notify chain, form backfill"
```

---

### Task 6: UI 修复（PairingQRModal.vue, handoff.ts store）— #14, #15

**Files:** `src/renderer/src/components/PairingQRModal.vue:37-43`, `src/renderer/src/stores/handoff.ts:63-68,30`

- [ ] **Step 1: QR 错误处理 (#14)**

将 `PairingQRModal.vue` 的 `generateQR` 函数改为：
```typescript
async function generateQR(): Promise<void> {
  if (!qrCanvas.value) return
  try {
    const result = await store.generatePairing('My iPhone', 'placeholder-key')
    if (result.success && result.qrData) {
      drawQR(qrCanvas.value, result.qrData)
    } else {
      message.error(result.error || '生成配对码失败')
    }
  } catch {
    message.error('无法连接接力服务，请确认服务已启动')
  }
}
```

需要在 script setup 中添加：`import { message } from 'ant-design-vue'`

- [ ] **Step 2: 重启乐观状态 (#15)**

在 `src/renderer/src/stores/handoff.ts` 中添加超时引用：
```typescript
let restartTimeout: ReturnType<typeof setTimeout> | null = null
```

重写 `restartService`：
```typescript
async function restartService(): Promise<void> {
  await window.api.handoff.restartService()

  // Optimistic: keep 'running' state, set 10s timeout
  if (restartTimeout) clearTimeout(restartTimeout)
  restartTimeout = setTimeout(() => {
    serviceStatus.value = 'stopped'
  }, 10000)
}
```

- [ ] **Step 3: 编译验证**

```bash
cd D:/workspace/frp-studio && export HTTP_PROXY="http://127.0.0.1:7897" && export HTTPS_PROXY="http://127.0.0.1:7897" && npx vue-tsc --noEmit -p tsconfig.web.json --composite false
```

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/PairingQRModal.vue src/renderer/src/stores/handoff.ts
git commit -m "fix: QR error handling, optimistic restart status"
```
