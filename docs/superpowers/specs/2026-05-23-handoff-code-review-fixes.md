# 设备接力模块 — Code Review 改进设计

> 版本：v1.1  
> 创建：2026-05-23  
> 状态：待实现  
> 基于：`2026-05-23-device-handoff-design.md` v1.0

## 概述

基于 max-effort code review 发现的 15 个确认问题，制定修复方案。按问题类型分三组：

- **安全性（#1-#3）**：命令注入、任意文件读取、路径穿越
- **功能与数据完整性（#4-#8）**：DoS、双存储、产品包路径、文件传输 Bug、OOM
- **体验与细节（#9-#15）**：内存泄漏、配置合并、通知链路、数据源、表单、错误处理、UI 闪烁

---

## 一、安全修复

### #1 命令注入 → 使用 `-EncodedCommand` + Base64

**文件：** `src/handoff-service/clipboard.ts` `writeClipboard()`

**修复：** 将文本经 `JSON.stringify` 安全转义后，通过 PowerShell `-EncodedCommand` + Base64(UTF-16LE) 传输，杜绝字符串注入。

```
const cmd = `Set-Clipboard -Value ${JSON.stringify(text)}`
const encoded = Buffer.from(cmd, 'utf-16le').toString('base64')
execSync(`powershell -EncodedCommand ${encoded}`)
```

### #2 任意文件读取 → 移除 `handleFileRequest`

**文件：** `src/handoff-service/file-transfer.ts` + `src/handoff-service/index.ts`

**修复：** `handleFileRequest` 允许配对设备读取 Windows 上的任意文件，且原 spec 未定义此方向。移除该函数及其 `registerHandler('file:request', ...)` 调用。仅保留 `handleFileOffer` + `handleFileChunk`（接收方向）。

### #3 路径穿越 → `path.basename()` + 边界检查

**文件：** `src/handoff-service/file-transfer.ts` `completeReceive()`

**修复：** 剥离文件名中所有目录成分，验证最终路径不越界：

```
const safeName = path.basename(transfer.filename)
const resolvedDest = path.resolve(path.join(downloadDir, safeName))
if (!resolvedDest.startsWith(path.resolve(downloadDir))) {
  sendToClient(transfer.ws, 'file:error', { transferId, error: 'path traversal blocked' })
  activeTransfers.delete(transferId)
  return
}
```

---

## 二、功能与数据完整性修复

### #4 DoS → POST body 1MB 限制

**文件：** `src/handoff-service/http-server.ts`

**修复：** `/pair/generate` 和 `/pair/confirm` 端点添加 body 累积上限（1MB），超过则 `res.writeHead(413)` 并结束请求。

### #5 双存储 → 统一为 handoff.json 单一数据源

**涉及文件：**
- `src/handoff-service/http-server.ts` — `/pair/confirm` 写入 handoff.json 后同步 SQLite（同时保留兼容）
- `src/main/ipc/handoff.ts` — `handoff:list-devices` 改为调用 IPC 客户端的 `getPairedDevices()`（HTTP GET `/devices`）
- `src/main/ipc/handoff.ts` — `handoff:delete-device` 改为先调 HTTP revoke、再删 SQLite（原子化，失败不回滚本地）
- `src/main/db/index.ts` — `paired_devices` 表保留为本地缓存，但 UI 始终以服务端数据为准

**原则：** HandoffService 的 `handoff.json` 为权威数据源，SQLite `paired_devices` 为只读缓存，每次 UI 加载从服务端拉取覆盖。

### #6 产品包路径 → `app.getAppPath()` fallback

**文件：** `src/main/handoff-service-manager.ts` `getServiceJsPath()`

**修复：** 优先尝试 `path.join(app.getAppPath(), 'out', 'handoff-service', 'index.js')`（开发环境），fallback `path.join(process.resourcesPath, 'out', 'handoff-service', 'index.js')`（打包后，extraResources 配置）。

同时在 `package.json` `build.extraResources` 中添加：
```json
{ "from": "out/handoff-service", "to": "out/handoff-service" }
```

### #7 文件传输缓冲区溢出 → 动态 header 大小

**文件：** `src/handoff-service/file-transfer.ts` `handleFileRequest()`

**修复：** 此函数已在 #2 中移除，问题连带解决。接收方向的 `ws-server.ts` 解析逻辑无需修改（已正确处理动态 ID 长度）。

### #8 内存溢出 → 文件大小上限

**文件：** `src/handoff-service/file-transfer.ts` `handleFileOffer()` + `completeReceive()`

**修复：** 添加 `MAX_FILE_SIZE = 500 * 1024 * 1024`（500MB）常量。`handleFileOffer` 中 `size > MAX_FILE_SIZE` 或 `size <= 0` 时拒绝并发送 `file:error`。`completeReceive` 中再次校验总大小。

---

## 三、体验与细节修复

### #9 零大小 + #8 合并覆盖

`size <= 0` 的校验同时解决 #8 和 #9。

### #10 配置浅合并 → 逐层 spread

**文件：** `src/handoff-service/config.ts` `loadConfig()` / `reloadConfig()`

**修复：** spread 改为每层独立合并：
```
config = {
  ...defaultConfig,
  ...parsed,
  server: { ...defaultConfig.server, ...parsed.server },
  device: { ...defaultConfig.device, ...parsed.device },
  features: { ...defaultConfig.features, ...parsed.features },
  frpTunnel: { ...defaultConfig.frpTunnel, ...parsed.frpTunnel }
}
```

### #11 配置通知 → IPC 通道

**新增 IPC：** `handoff:notify-config`

**涉及文件：**
- `src/main/ipc/handoff.ts` — 新增 handler，import `notifyConfigChanged`，调用后等待 HTTP 响应
- `src/preload/index.ts` — 暴露 `handoff.notifyConfig()`
- `src/renderer/src/env.d.ts` — 添加类型声明
- `src/renderer/src/components/HandoffSettings.vue` — `handleSave()` 保存后调用 `window.api.handoff.notifyConfig()`

### #12 设备列表数据源 → HTTP /devices

已由 #5 覆盖。`handoff:list-devices` 从 SQLite 改为 HTTP。

### #13 表单回填 → `serviceStatus()` 返回配置

**文件：** `src/renderer/src/components/HandoffSettings.vue`

**修复：** `onMounted` 中调用 `window.api.handoff.serviceStatus()`，从返回的配置信息回填表单字段。同时扩展 `GET /health` 返回当前配置摘要。

**扩展 health 响应：** `handoff-service/http-server.ts` 的 `/health` 增加 `config` 字段：
```json
{ "status": "running", "uptime": 123, "config": { "deviceName": "...", "port": 19528, "downloadDir": "...", ... } }
```

### #14 QR 错误处理 → try/catch + 用户提示

**文件：** `src/renderer/src/components/PairingQRModal.vue` `generateQR()`

**修复：** 包裹 try/catch，失败时调用 `message.error('无法连接接力服务')`。同时在 `handoff:generate-pairing` IPC handler 中 catch 后返回 `{ success: false, error: message }` 而非抛异常。

### #15 重启 UI 闪烁 → 乐观状态

**文件：** `src/renderer/src/stores/handoff.ts` `restartService()`

**修复：** restart 期间维持 `serviceStatus = 'running'`，设置 10s 超时定时器。健康检查确认停止后再切换状态。避免按钮闪烁和功能禁用。

---

## 四、涉及文件清单

| 文件 | 修改类型 | 关联问题 |
|------|----------|----------|
| `src/handoff-service/clipboard.ts` | 修改 | #1 |
| `src/handoff-service/file-transfer.ts` | 修改 | #2, #3, #8, #9 |
| `src/handoff-service/http-server.ts` | 修改 | #4, #5, #13 |
| `src/handoff-service/config.ts` | 修改 | #10 |
| `src/handoff-service/index.ts` | 修改 | #2 |
| `src/main/handoff-service-manager.ts` | 修改 | #6 |
| `src/main/ipc/handoff.ts` | 修改 | #5, #11, #14 |
| `src/main/handoff-ipc-client.ts` | 修改 | #12 |
| `src/preload/index.ts` | 修改 | #11 |
| `src/renderer/src/env.d.ts` | 修改 | #11, #13 |
| `src/renderer/src/stores/handoff.ts` | 修改 | #15 |
| `src/renderer/src/components/HandoffSettings.vue` | 修改 | #11, #13 |
| `src/renderer/src/components/PairingQRModal.vue` | 修改 | #14 |
| `package.json` | 修改 | #6 |
