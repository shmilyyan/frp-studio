# Handoff 模块功能总结

> 日期：2026-05-24 | 版本：0.1

---

## 一、SSE → socket.io 事件通道重构

原 4 条通道（HandoffService SSE + 内部 HTTP SSE + WebSocket + HTTP REST）统一为 1 条 socket.io 通道：

```
socket.io Server (HandoffService :19528)
  ├── admin room：主进程连接，接收所有事件 → IPC 转发渲染进程
  └── peers room：iOS 连接，剪贴板 + 文件传输事件
```

**收益**：内置自动重连（指数退避 1s→15s，无限次）、内置心跳 ping/pong、删除 SSE 全部手写 buffer 解析和重连逻辑（~200 行）。

**影响文件**：`socket.ts`（新建）、`index.ts`、`http-server.ts`、`internal-http.ts`、`handoff-ipc-client.ts`（重写）、`ipc/handoff.ts`、`ws-server.ts`（删除）

---

## 二、剪贴板双向自动同步

| 方向 | 机制 | 去重 |
|------|------|------|
| Windows→iOS | socket.io `clipboard` 事件推送 | `lastRemoteClipboardHash` + `lastLocalCopyTime` 2s 保护 |
| iOS→Windows | `UIPasteboard.changeCount` 每 2s 检测 + socket.io emit | `lastSentHash` SHA256 + `lastChangeCount` 同步 |
| 回环防护 | `ClipboardService.setClipboard()` 写入时同步更新 `lastChangeCount`，避免被本地监听器重复检测 | |
| 发送失败 | 缓存到 `pendingClipboard`，socket 重连后自动 flush | |

**影响文件**：`ClipboardService.swift`、`ConnectionManager.swift`（iOS）；`clipboard.ts`、`socket.ts`（HandoffService）

---

## 三、设备配对与注册

**配对流程**：

```
Windows 生成 QR 码 → iOS 扫码 → 解析 host/port → 设置 baseURL
  → socket.io 连接 → 发送 auth {deviceId, deviceName, platform}
  → 服务端 POST /internal/paired-device → SQLite
  → 广播 device:paired → 前端自动关闭 QR 弹窗 + 刷新设备列表
```

**设备持久化**：
- iOS 端：`baseURL` 和 `pairedDevices` 持久化到 UserDefaults，重启自动恢复连接
- Windows 端：SQLite `paired_devices` 表作为唯一真实来源

**影响文件**：`socket.ts`、`internal-http.ts`、`PairingQRModal.vue`、`handoff.ts`（store）

---

## 四、Bonjour/mDNS 设备发现

Windows HandoffService 每 30 秒主动宣告 `_handoff._tcp` 服务。iOS 启动后自动浏览局域网，发现设备后展示在"发现的设备"列表，点击即可免扫码配对。

**iOS 权限要求**：`NSLocalNetworkUsageDescription` + `NSBonjourServices`（Info.plist）

**影响文件**：`mdns.ts`、`DiscoveryService.swift`、`ContentView.swift`

---

## 五、传输记录

剪贴板收发操作自动写入传输记录（SQLite `transfer_history` 表），前端每 3 秒轮询 + SSE 事件驱动刷新。

**影响文件**：`clipboard.ts`（notifyTransferRecord）、`internal-http.ts`、`TransferHistory.vue`

---

## 六、进程管理

- 端口占用检测：PowerShell `Get-NetTCPConnection` 查端口占用，启动前自动杀旧进程
- 主动停止防自杀循环：`intentionalStop` 标志阻止 `stopHandoffService` 触发的 exit 事件被自动重启
- Ctrl+C 清理：移除 `detached: true`，子进程与父进程同进程组，信号终止时同退

**影响文件**：`handoff-service-manager.ts`、`index.ts`（main）

---

## 七、编码修复

| 位置 | 修复 |
|------|------|
| PowerShell `Get-Clipboard` | `[Console]::OutputEncoding = [UTF8]` + `$ProgressPreference = 'SilentlyContinue'` |
| HTTP 响应读取 | `Buffer.concat(chunks).toString('utf-8')` 替代 `data += chunk` |
| POST body 读取 | `Buffer.concat` 跨 TCP 分片保护 |
| HTTP 响应头 | `Content-Type: application/json; charset=utf-8` |
| 子进程环境 | `LC_ALL: 'en_US.UTF-8'` |

---

## 八、iOS UI 改进

- 版本号展示含 git commit hash（`v0.1.123 (4c58eef)`）
- 设备 ID 完整显示
- 调试模式开关过滤 info/debug 日志
- 剪贴板关键日志使用 warn 级别（始终可见）
- 设备列表 / 传输记录自动刷新

---

## 事件命名规范

统一使用冒号分隔：`domain:action`

| 事件 | 方向 |
|------|------|
| `device:paired` | Server → Admin |
| `device:revoked` | Server → Admin |
| `transfer:recorded` | Server → Admin |
| `config:reloaded` | Server → Admin |
| `peer:disconnected` | Server → Admin |
| `service:error` | Server → Admin |
| `clipboard` | 双向（Peers） |
| `auth` / `auth:ok` | Client → Server / Server → Client |

---

## 依赖变更

```
新增：socket.io (HandoffService)
      socket.io-client (Electron 主进程)
      Socket.IO-Client-Swift (iOS, SPM)
删除：ws (Server 端，原 ws-server.ts)
```
