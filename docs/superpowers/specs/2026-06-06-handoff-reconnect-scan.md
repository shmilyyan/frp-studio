# Handoff 设备重连与在线扫描

> 创建：2026-06-06 | 状态：待实现

## 目标

1. iOS 端：主界面下拉重连 + Bonjour 服务宣告自身在线
2. Windows 端：定时/手动扫描在线 iOS 设备 + 设备列表展示在线状态 + 最后在线 IP

---

## 一、架构

```
┌──────────────────────┐                    ┌─────────────────────────┐
│     iOS App          │                    │   Windows FRP Studio    │
│                      │   socket.io ───→   │                         │
│  ConnectionManager   │ ←── (双向) ────   │  HandoffService :19528  │
│  AdvertiseService    │                    │  socket.ts              │
│                      │                    │  mdns.ts (宣告+查询)     │
│  NetService 宣告 ────┼── Bonjour ───────→│                         │
│  (_handoff._tcp)     │                    │  主进程                 │
│                      │                    │  handoff-ipc-client.ts  │
│  ContentView         │                    │                         │
│  .refreshable 下拉   │                    │  渲染进程               │
│                      │                    │  DeviceList.vue         │
│                      │                    │  HandoffSettings.vue    │
└──────────────────────┘                    └─────────────────────────┘
```

**通道分配：**

| 方向 | 通道 | 用途 |
|------|------|------|
| iOS → Windows | socket.io | 剪贴板、设备注册、心跳 |
| Windows → iOS | socket.io (双向复用) | 剪贴板、唤醒指令 |
| iOS → Windows | Bonjour `_handoff._tcp` | iOS 宣告在线 |
| Windows → iOS | Bonjour `_handoff._tcp` | iOS 发现 Windows（已有） |

---

## 二、iOS 端

### 2.1 下拉重连

`ContentView.swift` 使用 `.refreshable` 修饰符触发重连：

- `ConnectionManager.reconnect()` → `socket.disconnect()` → 等待 0.5s → `socket.connect()`
- socket.io 重连后自动执行 auth + flush pending clipboard
- 同时刷新 Bonjour 浏览 (`DiscoveryService.restartBrowsing()`)

### 2.2 Bonjour 服务宣告

新建 `AdvertiseService.swift`，用 `NetService` 宣告自身：

```
服务类型: _handoff._tcp
服务名:   UIDevice.current.name
端口:     0 (不监听，仅宣告元信息)
TXT记录:  deviceId=<id>, platform=ios, version=<version>
```

生命周期：
- App 进入前台 → `publish()`
- App 进入后台 → `stop()`（iOS 后台 Bonjour 不可用）
- `NetService` delegate 处理 `didPublish` / `didNotPublish` / `didStop`

`ContentView.onAppear` 中调用 `AdvertiseService.shared.start()`

---

## 三、Windows 服务端

### 3.1 数据库变更

`paired_devices` 表新增列：

```sql
ALTER TABLE paired_devices ADD COLUMN last_ip TEXT DEFAULT '';
```

现有 `last_seen` 字段需要被实际更新（目前已存在但未使用）。

### 3.2 socket.io 事件 → 更新 last_seen / last_ip

在 `socket.ts` 中：

| 事件 | 操作 |
|------|------|
| iOS peer `auth` 成功 | 通过内部 HTTP 更新 `last_seen` + `last_ip = socket.handshake.address` |
| iOS peer `disconnect` | 更新 `last_seen`，标记离线 |
| iOS peer 连接/断开 | `notifyAdmin('peer:connected', { deviceId, ip })` / `notifyAdmin('peer:disconnected', { deviceId })` |
| mDNS 发现/丢失 | `notifyAdmin('bonjour:found', { deviceId, ip })` / `notifyAdmin('bonjour:lost', { deviceId })` |

新增 `POST /internal/device-status` 端点，用于更新 last_seen 和 last_ip：

```typescript
// internal-http.ts
POST /internal/device-status  body: { deviceId, online: bool, ip?: string }
→ UPDATE paired_devices SET last_seen = now(), last_ip = ? WHERE device_id = ?
```

### 3.3 mDNS 定时扫描

`mdns.ts` 新增定时查询逻辑：

```
每 N 秒 (可配置，最小 5s):
  发送 mDNS query: _handoff._tcp PTR
  → 收到 response → 解析 TXT deviceId
  → 匹配 paired_devices 表
  → 匹配成功 → POST /internal/device-status (online=true, ip=解析的地址)
  → 通过 socket.io notify admin → 前端更新在线状态
```

关键点：
- Windows mDNS **同时做宣告和查询**（当前只做宣告）
- 查询结果按 deviceId 去重，避免重复更新
- 如果一轮查询未发现之前标记为在线的设备 → 标记为离线

#### 在线状态判断逻辑

| socket.io | Bonjour | 最终状态 | 含义 |
|-----------|---------|----------|------|
| 已连接 | — | 🟢 在线 | 正常工作 |
| 未连接 | 可发现 | 🟡 可达 | iOS 在线但 socket.io 未连，可尝试唤醒 |
| 未连接 | 不可发现 | ⚫ 离线 | App 在后台或未启动 |

- "可达"状态持续超过 60s → 降级为"离线"（Bonjour 缓存残留）
- socket.io 连接状态优先级高于 Bonjour

### 3.4 定时扫描配置

在 Handoff 服务配置中新增扫描间隔配置项：

```
scannerInterval: 30  (单位: 秒, 最小值: 5)
```

- 存储位置：与现有 HandoffService 配置一起（`handoff_config.json` 或环境变量）
- 通过 `POST /internal/config` 更新
- 调整后即时生效（清除旧定时器，按新间隔启动）

---

## 四、Windows 前端

### 4.1 设备列表 `DeviceList.vue`

新增列/信息：
- 🟢/🟡/⚫ 在线状态圆点
- IP 地址（`last_ip`）
- 最后在线时间（`last_seen` 格式化）

顶部操作栏新增按钮：
- **手动扫描**：触发即时的 mDNS 查询，显示 loading 状态（3秒超时）

### 4.2 服务设置 `HandoffSettings.vue`

新增配置项：
- **扫描间隔**：数字输入框 + 约束 `min=5`
- 修改后即时生效（调用 IPC 更新服务端配置）

### 4.3 Store `handoff.ts`

新增 actions 和状态：
```typescript
onlineDevices: Record<string, 'online' | 'reachable' | 'offline'>  // deviceId → status
lastSeenTimes: Record<string, number>  // deviceId → timestamp
deviceIps: Record<string, string>      // deviceId → last_ip

scanDevices(): Promise<void>           // 手动触发扫描
setScanInterval(s: number): void       // 设置扫描间隔
```

新增 socket.io 事件监听：
```
peer:connected    → 更新 onlineDevices[deviceId] = 'online'
peer:disconnected → 更新 onlineDevices[deviceId] = 'offline'（如果 Bonjour 也未发现）
bonjour:found     → 更新 onlineDevices[deviceId] = 'reachable'（如果 socket.io 未连接）
bonjour:lost      → 更新 onlineDevices[deviceId] = 'offline'（如果 socket.io 也未连接）
```

### 4.4 `PairedDevice` 接口更新

```typescript
export interface PairedDevice {
  deviceId: string
  deviceName: string
  publicKey: string
  enabled: boolean
  lastSeen: number    // 新增
  lastIp: string      // 新增
}
```

---

## 五、IPC 接口

| 方法 | 方向 | 说明 |
|------|------|------|
| `handoff:list-devices` | renderer → main | 返回 PairedDevice[]（含 lastSeen, lastIp） |
| `handoff:scan-devices` | renderer → main | 手动触发 mDNS 扫描 |
| `handoff:set-scan-interval` | renderer → main | 设置扫描间隔（秒） |
| `handoff:device-status-changed` | main → renderer | 设备在线状态变更推送 |

---

## 六、改动清单

### 新建文件
| 文件 | 说明 |
|------|------|
| `ios/HandoffApp/HandoffApp/Services/AdvertiseService.swift` | iOS Bonjour 宣告 |
| `src/handoff-service/scanner.ts` | mDNS 定时扫描 + 设备状态匹配 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `ios/.../ContentView.swift` | 添加 `.refreshable` + 启动 `AdvertiseService` |
| `ios/.../ConnectionManager.swift` | 添加 `reconnect()` 方法 |
| `ios/.../App.swift` | 初始化 AdvertiseService |
| `src/handoff-service/mdns.ts` | 新增 query 逻辑 + 定时器 + 间隔配置 |
| `src/handoff-service/socket.ts` | 连接/断开时更新 last_seen/last_ip |
| `src/handoff-service/index.ts` | 启动 scanner |
| `src/main/internal-http.ts` | 新增 `POST /internal/device-status` + `/internal/devices` 返回 last_ip/last_seen |
| `src/main/db/schema.ts` | MIGRATION 新增 `ALTER TABLE paired_devices ADD COLUMN last_ip` |
| `src/main/db/index.ts` | 新增 `updateDeviceStatus()` 方法 |
| `src/main/handoff-ipc-client.ts` | 新增 `peer:connected`/`bonjour:found` 事件转发 |
| `src/renderer/src/components/DeviceList.vue` | 在线状态 + IP + 手动扫描按钮 |
| `src/renderer/src/components/HandoffSettings.vue` | 扫描间隔配置项 |
| `src/renderer/src/stores/handoff.ts` | 新增 scanDevices/setScanInterval + 在线状态数据 |
| `src/renderer/src/env.d.ts` | 新增 IPC 接口类型声明 |
| `src/main/ipc/handoff.ts` | 新增 IPC handlers |
| `src/preload/index.ts` | 新增 preload 暴露方法 |
