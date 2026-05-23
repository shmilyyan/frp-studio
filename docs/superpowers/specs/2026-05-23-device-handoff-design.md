# 设备接力模块 — 设计方案

> 版本：v1.0  
> 创建：2026-05-23  
> 状态：待实现  

## 一、概述与目标

在 FRP Studio 中新增"设备接力"模块，实现 iOS 与 Windows 设备之间的剪贴板共享、文件传输和设备发现能力，类似 Apple Handoff 的核心体验。

### 核心功能范围

| 功能 | 描述 |
|------|------|
| 设备发现 | 局域网 mDNS 自动发现，二维码扫码配对 |
| 剪贴板共享 | iOS → Windows 推送（Share Extension），Windows → iOS 拉取（主应用） |
| 文件传输 | 分块传输，SHA256 校验，支持断点续传 |

### 关键约束

- FRP Studio 作为唯一配置入口，管理接力模块的所有设置
- HandoffService 作为独立后台进程运行，不依赖 FRP Studio 前台窗口
- 通信优先局域网直连，FRP 隧道作为 fallback
- 与现有 FRP 功能解耦，互不干扰
- 配对方式：二维码扫码，基于公钥交换

---

## 二、系统架构

```
iOS (HandoffApp)
├── 主应用：配对、设备管理、剪贴板、文件传输
├── Share Extension：系统级快速发送（文本/URL/图片/文件）
└── 通信层
    ├── LAN: mDNS 发现 + WebSocket 直连
    └── WAN: FRP Tunnel Relay (fallback)

        │                        │
        │  LAN / FRP Tunnel      │
        │                        │

Windows
├── FRP Studio (Electron + Vue 3)
│   ├── 接力配置页面（UI）
│   ├── 进程监控 (status / logs / health)
│   └── 配置管理 (handoff.json → IPC 通知 Service)
│
├── HandoffService (独立后台进程，Node.js)
│   ├── WebSocket Server (局域网)
│   ├── mDNS 广播 (Bonjour: _handoff._tcp)
│   ├── 剪贴板监听与同步
│   ├── 文件传输引擎（分块 + 校验）
│   ├── FRP 隧道管理（可选）
│   └── 配对管理（密钥 + 设备白名单）
│
└── IPC 通信：HTTP localhost + SSE
```

### 进程关系

- FRP Studio 以 `detached: true` + `unref()` 方式启动 HandoffService 子进程，父进程退出后子进程继续运行
- FRP Studio 通过 HTTP localhost 查询状态、下发配置、接收事件
- FRP Studio 重新打开时，通过 PID 文件 + HTTP `/health` 检测已有进程，避免重复启动
- FRP Studio 关闭不影响 HandoffService 运行

---

## 三、IPC 协议（FRP Studio ↔ HandoffService）

### 通信模型：HTTP + SSE

| 方向 | 方式 | 用途 |
|------|------|------|
| FRP Studio → Service | HTTP POST | 查询状态、下发配置、发送控制指令 |
| Service → FRP Studio | SSE | 实时推送状态变更、传输事件、错误通知 |

### 接口定义

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 返回 `{ status, uptime, connections, version }` |
| GET | `/devices` | 已配对设备列表及在线状态 |
| GET | `/events` | SSE 事件流（状态变化、传输进度、错误） |
| POST | `/config` | 下发新配置，Service 热重载 |
| POST | `/restart` | 重启 HandoffService |
| POST | `/pair/revoke/:id` | 撤销指定设备配对 |
| POST | `/pair/generate` | 生成新配对二维码（返回 base64 PNG） |

### 配置下发流程

```
用户修改配置 → FRP Studio 写入 handoff.json
  → POST /config 通知 Service
    → Service 读取新配置
      → 热重载（无需重启进程）
        → SSE 推送 "config-reloaded" 事件
```

### 故障恢复

- HandoffService 崩溃 → FRP Studio 检测子进程 exit → 自动重启（最多 3 次，间隔 3s）
- 超过重试上限 → UI 显示"服务异常"，停止重试
- FRP Studio 关闭 → HandoffService 不受影响

---

## 四、通信协议（Windows ↔ iOS）

### 阶段一：设备发现与配对

```
Windows (HandoffService)                   iOS (HandoffApp)
───────────────────────                    ────────────────
启动 mDNS 广播:
  _handoff._tcp.local
  (设备名 + 端口 + 公钥指纹)
──────────────────────────────────────►
                                            扫描局域网 _handoff._tcp
                                            发现 Windows 设备

                          [用户点击"配对"]

◄──────────────────────────────────────
        GET /pair/request
        (设备信息 + 公钥)

FRP Studio 展示配对二维码
──────────────────────────────────────►
  QR: { deviceId, publicKey,
        serverIP, serverPort, token }

                                            ← 扫码确认

        POST /pair/confirm (签名验证)
◄──────────────────────────────────────

✅ 配对完成，双方互存公钥
```

### 阶段二：剪贴板同步

**iOS → Windows（推送模式）**
```
iOS 复制 → 用户点 Share Extension → WebSocket 发消息:
  { type: "clipboard", payload: "<text>", timestamp: ... }
→ Windows 收到 → 写入剪贴板 → 系统通知
```

**Windows → iOS（拉取模式）**
```
Windows 复制 → 缓存内容 + hash（不主动推送，iOS 后台限制）
→ iOS 打开 App → GET /clipboard/latest
→ 返回: { hash: "...", payload: "<text>" }
```

### 阶段三：文件传输

```
发送方 → WebSocket: { type: "file:offer", filename, size, checksum }
接收方 → WebSocket: { type: "file:accept" } 或 { type: "file:reject" }
发送方 → WebSocket Binary: [chunk_index(4B)][chunk_data(256KB)]
        ... (循环发送所有分块)
接收方 → 校验 checksum
       → WebSocket: { type: "file:complete", status: "ok" }

接收目录：用户配置的下载目录（默认 Downloads/FrpTransfer）
```

---

## 五、数据模型

### 数据库扩展（SQLite，追加到 frp-studio.db）

**paired_devices 表**

| 列名 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| device_id | TEXT UNIQUE | 设备唯一标识 |
| device_name | TEXT | 设备名称（用户可编辑） |
| platform | TEXT | 'ios' |
| public_key | TEXT | 设备公钥 |
| paired_at | INTEGER | 配对时间戳 |
| last_seen | INTEGER | 最后在线时间 |
| enabled | INTEGER | 是否启用 (0/1) |

**transfer_history 表**

| 列名 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| device_id | INTEGER FK | 关联 paired_devices |
| type | TEXT | 'clipboard' / 'file' |
| direction | TEXT | 'send' / 'receive' |
| detail | TEXT | 文件名或剪贴板摘要（截断） |
| size | INTEGER | 字节数 |
| status | TEXT | 'success' / 'failed' / 'cancelled' |
| created_at | INTEGER | 时间戳 |

### HandoffService 配置（userData/handoff.json）

```json
{
  "server": {
    "port": 19528,
    "bindAddress": "0.0.0.0"
  },
  "device": {
    "name": "My-Windows-PC",
    "downloadDir": "Downloads/FrpTransfer"
  },
  "features": {
    "clipboardSync": true,
    "fileTransfer": true,
    "clipboardMaxSize": 1048576
  },
  "frpTunnel": {
    "enabled": false,
    "nodeId": null,
    "remotePort": 19528
  },
  "pairedDevices": []
}
```

---

## 六、FRP Studio UI 设计

延续现有深色科技风（Dark Tech），新增「接力」导航标签，包含三个子页面：

### 设备管理
- 顶部状态栏：服务运行状态（绿/红指示灯）、PID、运行时长、监听端口
- 操作按钮：生成配对码（弹出二维码弹窗）、重启服务
- 配对设备卡片列表：设备名、平台、配对时间、在线状态、功能权限开关、解除配对按钮

### 传输记录
- 筛选：全部 / 剪贴板 / 文件
- 表格：时间、设备、类型、方向、详情、大小、状态
- 分页查看

### 服务设置
- 服务端口配置
- Windows 设备名称
- 文件下载目录
- FRP 隧道开关 + 节点选择
- 剪贴板大小限制

---

## 七、iOS App 结构

```
HandoffApp/
├── App.swift                 // 入口：检查配对状态，初始化连接
├── Views/
│   ├── PairingView.swift     // 扫描二维码配对
│   ├── DeviceListView.swift  // 已配对 Windows 设备列表
│   ├── ClipboardView.swift   // 剪贴板同步状态
│   └── TransferView.swift    // 文件传输进度
├── Services/
│   ├── DiscoveryService.swift    // mDNS 扫描
│   ├── ConnectionManager.swift   // WebSocket 连接 + FRP fallback
│   ├── ClipboardService.swift    // 剪贴板读写
│   ├── FileTransferService.swift // 文件分块传输
│   └── CryptoService.swift       // 加密 + 密钥管理
├── Models/
│   ├── Device.swift
│   ├── TransferRecord.swift
│   └── HandoffConfig.swift
└── ShareExtension/
    ├── ShareViewController.swift  // 系统分享入口
    └── Info.plist                // 支持: text, url, image, data
```

### Share Extension 关键设计

| 项目 | 说明 |
|------|------|
| 支持类型 | public.plain-text, public.url, public.image, public.data |
| 与主应用共享 | App Group 共享容器 + Keychain Sharing |
| 执行时间限制 | ~30 秒，大文件需切到主应用传输 |
| 流程图 | 用户分享 → Extension 弹出 → 选目标设备 → 发送 → 关闭 |

### CI/CD

- GitHub Actions macOS runner 编译 Xcode project
- 输出 .ipa 上传到 Release Assets
- 分发：TestFlight / 企业签名 / AltStore 自签

---

## 八、异常处理

| 场景 | 处理策略 |
|------|----------|
| HandoffService 崩溃 | 自动重启（最多 3 次，间隔 3s），超限后 UI 报警 |
| WebSocket 断连 | 指数退避重连（1s → 2s → 4s → ... 上限 60s） |
| 局域网不可达 | fallback 到 FRP 隧道，FRP 也不可达则标记设备离线 |
| 剪贴板内容过大 | 超过限制 → 丢弃，记日志 |
| 文件传输中断 | 记录已接收 chunk，重连后发 `file:resume` 续传 |
| 端口冲突 | 自动选下一可用端口，更新 mDNS 广播和配置文件 |
| 设备 30 天未连接 | 标记"未验证"，下次连接需重新确认 |
| Windows 休眠/唤醒 | 暂停/恢复 mDNS 广播，通知已连接设备 |
| iOS Share Extension 容器不可用 | 降级处理，引导用户打开主应用完成配对 |

---

## 九、测试策略

### 单元测试（Vitest，同现有栈）

| 模块 | 测试内容 |
|------|----------|
| HandoffService IPC | HTTP 接口、SSE 事件流、配置热重载 |
| WebSocket 协议 | 消息序列化/反序列化、分块逻辑 |
| 加密模块 | 密钥生成、签名验证、TLS 握手 |
| 数据库扩展 | 配对设备 CRUD、传输记录查询 |

### 集成测试

| 场景 | 方式 |
|------|------|
| FRP Studio ↔ HandoffService | 启动真实 HandoffService 进程，验证 IPC 全流程 |
| 设备发现 | 同一网络下验证 mDNS 广播/发现 |
| 剪贴板端到端 | Windows 写入剪贴板 → 验证接口返回 |

### 手动测试（iOS 端）

| 场景 | 验证点 |
|------|--------|
| 扫码配对 | 二维码生成 → iOS 扫码 → 配对成功 |
| 剪贴板共享 | 双向传输验证 |
| 小文件传输 | < 10MB 文件分享直传 |
| 大文件传输 | > 100MB 分块传输 + 校验 |

---

## 十、技术选型

| 层级 | 技术 |
|------|------|
| Windows 后台服务 | Node.js（独立进程） |
| 进程间通信 | HTTP localhost + SSE |
| 局域网发现 | mDNS (multicast-dns npm / NSNetService) |
| 实时通信 | WebSocket (ws / URLSessionWebSocketTask) |
| 剪贴板监听 | Windows: clipboard-event npm / iOS: UIPasteboard |
| 文件传输 | WebSocket Binary frames, 256KB chunks |
| 加密 | 密钥对 + TLS + cert pinning |
| iOS App | SwiftUI + URLSession + Network framework |
| iOS 构建 | GitHub Actions macOS runner |

---

## 十一、项目源码结构

```
frp-studio/
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   └── handoff.ts           # 接力相关 IPC handlers
│   │   ├── db/
│   │   │   └── handoff-schema.ts    # paired_devices + transfer_history 表
│   │   ├── handoff-service.ts       # HandoffService 进程管理（启动/监控/重启）
│   │   └── handoff-ipc-client.ts    # HTTP + SSE 客户端（连接 HandoffService）
│   ├── renderer/
│   │   └── src/
│   │       ├── views/
│   │       │   └── HandoffView.vue       # 接力页面布局 + 子路由
│   │       ├── components/
│   │       │   ├── DeviceList.vue        # 配对设备列表
│   │       │   ├── PairingQRModal.vue    # 配对二维码弹窗
│   │       │   ├── TransferHistory.vue   # 传输记录表格
│   │       │   └── HandoffSettings.vue   # 服务设置表单
│   │       └── stores/
│   │           └── handoffStore.ts       # Pinia store
│   └── handoff-service/              # HandoffService 独立进程源码
│       ├── index.ts                  # 入口：HTTP Server + WebSocket Server
│       ├── ws-server.ts              # WebSocket 服务器 + iOS 通信
│       ├── mdns.ts                   # mDNS 广播
│       ├── clipboard.ts              # Windows 剪贴板监听
│       ├── file-transfer.ts          # 分块文件传输
│       ├── pairing.ts                # 设备配对管理
│       ├── crypto.ts                 # 加密/签名
│       └── config.ts                 # 配置加载 + 热重载
├── ios/                              # iOS App (Swift)
│   └── HandoffApp/
│       ├── HandoffApp.xcodeproj
│       └── HandoffApp/               # Swift 源码（结构见第七节）
└── .github/workflows/
    └── ios-build.yml                 # iOS CI 构建
```
