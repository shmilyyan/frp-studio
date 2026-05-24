# Handoff 模块深度优化设计

> 创建：2026-05-24 | 状态：待实现
>
> 针对 5 个核心问题的根因分析与设计方案。

---

## 1. 剪贴板双向自动同步 + 编码修复

### 根因

- iOS 每 3 秒无脑轮询覆盖 `UIPasteboard.general.string`，不比对 hash，不保护本地操作
- PowerShell `Get-Clipboard` 输出系统代码页（中文 Windows 为 CP936/GBK），`execSync({ encoding:'utf-8' })` 强制按 UTF-8 解码导致中文乱码
- HTTP 响应中 `data += chunk` 直接将 Buffer 拼接到 String，TCP 分片可能切断多字节 UTF-8 字符

### 设计

**Windows → iOS（WebSocket 推送）：**

```
Windows clipboard 变化 (1s 轮询, hash 检测)
  → HandoffService broadcastToAll('clipboard', {hash, payload, sourceId})
  → iOS WebSocket 接收
  → hash !== lastReceivedHash (去重)
  → (now - lastLocalCopyTime) > 2000ms (保护本地操作)
  → 写入 UIPasteboard.general.string
```

**iOS → Windows（HTTP + changeCount 检测）：**

```
UIPasteboard.changeCount 变化 (2s 本地轮询, 不发网络请求)
  → 读取剪贴板, hash !== lastSentHash
  → HTTP POST /clipboard {payload: text}
  → HandoffService writeClipboard()
  → broadcastToAll 推送给除 sourceId 外的客户端
```

**去重与保护：**

- 两端维护 `lastReceivedHash` / `lastSentHash` / `lastLocalCopyTime`
- `broadcastToAll` 新增 `excludeClientId` 参数排除发送源
- iOS 本地 copy 后 2 秒内拒绝远程覆盖

**编码修复：**

| 文件 | 修复 |
|------|------|
| `clipboard.ts:getClipboardText()` | PowerShell 命令前加 `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` |
| `handoff-ipc-client.ts` httpGet/httpPost | `Buffer[]` 累加 → `Buffer.concat().toString('utf-8')` |
| `handoff.ts` clipboard-get/send | 同上 |
| `http-server.ts` 所有 JSON 响应 | `Content-Type: application/json; charset=utf-8` |
| `handoff-service-manager.ts` spawn | env 加 `LC_ALL: 'en_US.UTF-8'` |

---

## 2. Bonjour 自动发现 + 连接保活

### 根因

- `DiscoveryService.swift` 完整实现但从未被实例化或调用 `startBrowsing()`
- `PairedDevice.isConnected` 扫码时设 `true` 后永不更新，无心跳机制
- mDNS TXT 记录中 `version` 硬编码 `'0.1.0'`

### 设计

**iOS DiscoveryService 启用：**

```
App.swift 启动
  → DiscoveryService.shared.startBrowsing()
  → 浏览 _handoff._tcp.local
  → ContentView "发现的设备" Section 展示
```

**HTTP 心跳保活（10s 间隔）：**

- GET `{baseURL}/health` → 成功则 `isConnected = true`
- 失败则 `isConnected = false`

**WebSocket 长连接恢复：**

- `baseURL` 设置后自动连接 `ws://{host}:{port}`
- 断线重连：5s → 10s → 20s（最大 30s，指数退避）
- 接收 `clipboard` 消息并 hash 去重后写入剪贴板
- 连接/断开时更新 `isConnected`

**Windows mDNS 加固：** TXT 记录 `version` 字段动态读取 VERSION 文件。

---

## 3. 设备管理架构重构（SQLite 为主）

### 根因

- `PairingQRModal.vue:42` 传硬编码 `'placeholder-key'`
- iOS 扫码后从不调用 `/pair/confirm`，设备仅存于 iOS UserDefaults
- 双重存储（SQLite + handoff.json），SQLite 为死表

### 设计

**数据架构：**

```
SQLite paired_devices (唯一真实来源)
  ├── IPC handoff:list-devices   → 直接查 SQLite
  ├── IPC handoff:delete-device  → 直接删 SQLite
  ├── IPC handoff:confirm-pairing → 验证签名后写入 SQLite
  └── 内部 HTTP 127.0.0.1:19529 GET /internal/devices
        ↑ HandoffService 需要设备列表时查询
```

**改动：**

1. `handoff.json` 移除 `pairedDevices`（迁移：启动时如存在则导入 SQLite 后删除）
2. 废弃 HandoffService `/devices`，IPC 直读 SQLite
3. 主进程新增内部 HTTP server（仅 `127.0.0.1:19529`）
4. 新增 IPC channel `handoff:confirm-pairing`

**修复后配对流程：**

```
点击"生成配对码"
  → IPC generate-pairing → HTTP POST /pair/generate → HandoffService
  → QR (token, host, port, deviceId, publicKey)

iOS 扫码
  → 解析 QR, 首次使用时生成 RSA 密钥对
  → HTTP POST /pair/confirm { token, signedToken, deviceInfo }
  → HandoffService 验证签名
  → 内部回调 POST /internal/paired-device → 写入 SQLite
  → SSE 广播 device-paired → 前端刷新
```

---

## 4. 传输记录写入

### 根因

- `addTransferHistory()` 全局未被调用
- HandoffService 独立进程无法写主进程 SQLite

### 设计

```
HandoffService 操作完成
  → POST http://127.0.0.1:19529/internal/transfer-record
  → { deviceId, type, direction, detail, size, status }
  → 主进程 addTransferHistory() → SQLite
  → SSE 广播 transfer-recorded → 前端实时刷新
```

**调用时机：** `writeClipboard()` 成功后、iOS POST `/clipboard` 写入成功后、`completeReceive()` 文件接收完成后。

---

## 5. 影响范围文件清单

**HandoffService：** `index.ts`、`clipboard.ts`、`http-server.ts`、`ws-server.ts`、`mdns.ts`

**主进程：** `ipc/handoff.ts`、`handoff-ipc-client.ts`、`handoff-service-manager.ts`、新增 `internal-http.ts`

**渲染进程：** `PairingQRModal.vue`、`DeviceList.vue`、`stores/handoff.ts`

**iOS：** `App.swift`、`DiscoveryService.swift`、`ConnectionManager.swift`、`ContentView.swift`、`Device.swift`、`ClipboardService.swift`
