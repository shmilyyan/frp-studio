# Handoff 文件传输 — iOS → Windows

> 创建：2026-06-07 | 状态：待实现

## 目标

实现 iOS 到 Windows 的单向文件传输，支持 App 内选择文件和系统 Share Sheet 两种触发方式。

## 一、架构

```
iOS App / Share Extension          HandoffService (Windows)
─────────────────────────          ──────────────────────
文件选择器 / Share Sheet          
  ↓                                POST /file/upload
读取文件 ─── HTTP multipart ───→   multipart 接收 → 存盘
  ↓                                ↓
进度回调 ←── HTTP 200 ────────    SHA256 校验
                                   ↓
                                 socket.io → admin
                                   ↓
                                 transfer_history 写记录
```

## 二、多服务端路由

### 方案：最后活跃优先 + 快速切换

- socket.io 连接成功时，写入 `lastActiveServer` 偏好到 Keychain（key: `handoff_last_active`）
- 发送文件时默认使用最后一个连接成功的服务器
- Share Extension 中提供下拉切换设备列表
- 手动切换后更新偏好

### 设备列表

从 Keychain 读取 `handoff_paired_devices`（JSON），展示所有已配对设备。离线设备置灰不可选。

## 三、数据共享层

### Keychain Sharing

主 App 和 Share Extension 共用 Keychain Access Group：

```
group.com.frp-studio.handoff
```

| Key | 读写方 | 说明 |
|-----|--------|------|
| `device_identity` | 主 App 写，Extension 读 | 设备 ID |
| `handoff_base_url` | 主 App 写，Extension 读 | 当前连接地址 |
| `handoff_paired_devices` | 主 App 写，Extension 读 | 已配对设备列表 (JSON) |
| `handoff_last_active` | socket.io connect 时写 | 最后活跃服务器 |


`KeychainHelper.swift` 所有操作添加 `kSecAttrAccessGroup`:
```swift
kSecAttrAccessGroup as String: "group.com.frp-studio.handoff"
```

## 四、Windows 服务端

### HTTP 端点 — `POST /file/upload`

Content-Type: multipart/form-data  
Body: `file=<数据>` + `deviceId=<设备ID字符串>`

```
POST /file/upload
  → 200 { success, path, size, checksum }
  → 400 { error: "deviceId required" }
  → 413 { error: "file too large" }
  → 500 { error: "internal error" }
```

### 处理流程

```
接收 multipart
  → 读取 deviceId，校验是否在 paired_devices 表中
  → 读取 file，流式写入临时文件
  → SHA256 校验
  → 移动到 downloadDir/<basename>（同名加时间戳）
  → socket.io notifyAdmin('transfer:recorded', record)
  → 返回 { success, path, size }
```

### 安全

| 措施 | 实现 |
|------|------|
| 文件大小限制 | HTTP `Content-Length` 检查，超限 413 |
| 最大尺寸 | 配置 `features.fileMaxSize`，默认 500MB |
| 路径穿越 | 只取 `path.basename(filename)` |
| 同名覆盖 | 追加时间戳 `file_20260607_143022.txt` |
| 设备校验 | `deviceId` 须在 `paired_devices` 中存在 |

### 传输记录

文件上传成功后写入 `transfer_history`：
- `type`: `file`
- `direction`: `receive`
- `detail`: 文件保存路径（如 `D:\Downloads\FrpTransfer\photo.png`）
- `size`: 字节数
- `status`: `success`

### 配置调整

`HandoffSettings.vue` 文件大小限制单位从 bytes 改为 MB：

```
配置项: 文件大小限制 (MB)
默认值: 500
最小值: 1
最大值: 4096
```

对应 config.ts 新增 `features.fileMaxSize`（内部仍用 bytes）。

## 五、iOS 主 App

### 文件选择器

`ContentView.swift` 剪贴板测试 Section 增加值：

```swift
Button(action: { showFilePicker = true }) {
    Label("发送文件", systemImage: "doc.badge.arrow.up")
}
.disabled(connectionManager.baseURL.isEmpty)
.sheet(isPresented: $showFilePicker) {
    DocumentPicker(onFileSelected: { url in
        connectionManager.uploadFile(url)
    })
}
```

### ConnectionManager.uploadFile(url:)

```swift
func uploadFile(_ fileURL: URL) {
    guard !baseURL.isEmpty else { return }
    let uploadURL = URL(string: "http://\(baseURL)/file/upload")!
    var request = URLRequest(url: uploadURL)
    request.httpMethod = "POST"
    
    let boundary = UUID().uuidString
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    
    var body = Data()
    // deviceId field
    body.append("--\(boundary)\r\n".data(using: .utf8)!)
    body.append("Content-Disposition: form-data; name=\"deviceId\"\r\n\r\n".data(using: .utf8)!)
    body.append("\(deviceId)\r\n".data(using: .utf8)!)
    // file field
    body.append("--\(boundary)\r\n".data(using: .utf8)!)
    body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
    body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
    body.append(try! Data(contentsOf: fileURL))
    body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
    
    let task = URLSession.shared.uploadTask(with: request, from: body) { data, response, error in
        // handle response
    }
    task.resume()
}
```

## 六、iOS Share Extension（新建 Target）

### 文件结构

```
ios/HandoffApp/ShareExtension/
├── ShareViewController.swift
├── UploadService.swift
└── Info.plist
```

### ShareViewController

```
用户分享 → 系统弹出 Share Sheet → 选 Handoff
  → ShareViewController 被激活
  → 获取 NSItemProvider (file URL)
  → 读 Keychain → lastActiveServer 偏好 → baseURL
  → 读 Keychain → pairedDevices 列表
  → 显示 UI：设备选择下拉 + 文件名 + 进度 + [发送]
  → UploadService.upload(url:baseURL:fileURL:)
  → 完成 → extensionContext.completeRequest()
```

### 设备选择 UI

```
┌────────────────────────────────────┐
│  📤 发送到: 🖥️ 办公室-PC ▾        │
│  📄 photo.png  (2.3 MB)           │
│                                    │
│  ████████████░░░░  78%            │
│                                    │
│           [取消]    [发送]         │
└────────────────────────────────────┘
```

## 七、project.yml 变更

```yaml
targets:
  HandoffApp:
    entitlements:
      keychain-access-groups:
        - $(AppIdentifierPrefix)group.com.frp-studio.handoff
    dependencies:
      - package: SocketIO

  ShareExtension:
    type: app-extension
    platform: iOS
    sources:
      - ShareExtension
    entitlements:
      keychain-access-groups:
        - $(AppIdentifierPrefix)group.com.frp-studio.handoff
```

## 八、改动清单

### 新建
| 文件 | 说明 |
|------|------|
| `ios/HandoffApp/ShareExtension/ShareViewController.swift` | Share Extension 入口 |
| `ios/HandoffApp/ShareExtension/UploadService.swift` | HTTP 文件上传 |
| `ios/HandoffApp/ShareExtension/Info.plist` | Extension 配置 |

### 修改
| 文件 | 操作 |
|------|------|
| `src/handoff-service/http-server.ts` | 新增 `POST /file/upload` 端点 |
| `src/handoff-service/config.ts` | 新增 `features.fileMaxSize` |
| `src/renderer/src/components/HandoffSettings.vue` | 文件大小限制单位改为 MB |
| `ios/…/Services/KeychainHelper.swift` | 添加 `kSecAttrAccessGroup` |
| `ios/…/Services/ConnectionManager.swift` | 新增 `uploadFile(url:)` + 写入 `lastActiveServer` |
| `ios/…/Views/ContentView.swift` | 新增文件选择器 + 发送按钮 |
| `ios/HandoffApp/project.yml` | 新增 ShareExtension target + entitlements |
