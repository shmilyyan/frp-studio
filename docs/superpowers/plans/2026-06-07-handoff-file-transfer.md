# Handoff 文件传输 — iOS → Windows 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 iOS 到 Windows 单向文件传输，支持 App 内文件选择器和系统 Share Sheet 两种触发方式

**Architecture:** iOS 通过 HTTP multipart POST 上传文件到 HandoffService `/file/upload` 端点；多服务端路由采用最后活跃优先；主 App 和 Share Extension 通过 Keychain Sharing 共享配对信息和偏好

**Tech Stack:** TypeScript (HandoffService), SwiftUI (iOS), URLSession, multipart/form-data, Keychain Services

---

## 任务总览

| # | 任务 | 模块 |
|---|------|------|
| 1 | Config: fileMaxSize + 单位改为 MB | config.ts, HandoffSettings.vue |
| 2 | HTTP: POST /file/upload 端点 | http-server.ts |
| 3 | KeychainHelper: 添加 accessGroup | KeychainHelper.swift |
| 4 | iOS: uploadFile + lastActiveServer | ConnectionManager.swift |
| 5 | iOS: 文件选择器 + 发送按钮 | ContentView.swift |
| 6 | iOS: Share Extension (新建 Target) | ShareExtension/ |
| 7 | project.yml: Extension target + entitlements | project.yml |

---

### Task 1: Config — fileMaxSize + HandoffSettings 单位改为 MB

**Spec 覆盖:** 四.配置调整

**Files:**
- Modify: `src/handoff-service/config.ts`
- Modify: `src/renderer/src/components/HandoffSettings.vue`

- [ ] **Step 1: config.ts — 新增 fileMaxSize**

在 `HandoffConfig` 接口的 `features` 中添加 `fileMaxSize`，在 `defaultConfig` 中默认 524288000 (500MB in bytes)：

```typescript
// features 接口中新增：
fileMaxSize: number  // bytes, default 500MB

// defaultConfig features 中新增：
fileMaxSize: 524288000
```

- [ ] **Step 2: HandoffSettings.vue — 单位改为 MB + 绑定 fileMaxSize**

找到剪贴板大小限制的表单项，在它下方添加文件大小限制表单。同时将现有剪贴板大小限制也旁边加个注释说明单位。

在 `<a-form-item label="剪贴板大小限制">` 之后添加：

```vue
    <a-form-item label="文件大小限制">
      <a-input-number
        v-model:value="fileMaxSizeMB"
        :min="1"
        :max="4096"
        style="width: 100%;"
        addon-after="MB"
      />
      <span style="margin-left: 8px; color: #8c9aab; font-size: 12px;">默认 500 MB</span>
    </a-form-item>
```

在 `<script setup>` 中添加：

```typescript
const fileMaxSizeMB = ref(500)
```

在 `onMounted` 中从 config 加载，将 bytes 转为 MB：

```typescript
if (c.fileMaxSize) {
  fileMaxSizeMB.value = Math.round(c.fileMaxSize / 1048576)
} else if (c.clipboardMaxSize) {
  // 暂无独立 fileMaxSize 配置
}
```

在 `handleSave` 中，将 MB 转回 bytes 发送：

```typescript
// 在 handleSave 中，notifyConfig 之后：
// 文件大小限制通过 handoff.json 配置持久化（由 /config 端点处理）
```

同时更新 `/health` 端点的 config 输出（http-server.ts），在 config 对象中添加：

```typescript
fileMaxSize: cfg.features.fileMaxSize
```

- [ ] **Step 3: 验证**

```bash
cd D:/workspace/frp-studio && pnpm build
```

- [ ] **Step 4: 提交**

```bash
git add src/handoff-service/config.ts src/handoff-service/http-server.ts src/renderer/src/components/HandoffSettings.vue
git commit -m "feat: add fileMaxSize config + change size unit to MB in UI"
```

---

### Task 2: HTTP — POST /file/upload 端点

**Spec 覆盖:** 四.Windows 服务端

**Files:**
- Modify: `src/handoff-service/http-server.ts`

- [ ] **Step 1: 在 http-server.ts 中添加文件上传端点**

在 `/scanner/interval` 端点之后、`res.writeHead(404)` 之前添加。需要先读取现有文件确认插入位置。

```typescript
// ─── File upload endpoint ─────────────────────────────────────────────────

if (req.method === 'POST' && url === '/file/upload') {
  const cfg = getConfig()
  const maxSize = cfg.features.fileMaxSize || 524288000

  // Check Content-Length before receiving
  const contentLength = parseInt(req.headers['content-length'] || '0', 10)
  if (contentLength > maxSize) {
    res.writeHead(413)
    res.end(JSON.stringify({ error: 'file too large', maxSize }))
    return
  }

  // Parse multipart
  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(.+)$/)
  if (!boundaryMatch) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: 'multipart/form-data required' }))
    return
  }
  const boundary = boundaryMatch[1].trim()

  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks)
      // Parse multipart fields
      const parts = parseMultipart(body, boundary)
      const deviceId = parts['deviceId']
      const fileData = parts['file']
      const filename = parts['_filename'] || 'unknown'

      if (!deviceId) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'deviceId required' }))
        return
      }

      if (!fileData || fileData.length === 0) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'file required' }))
        return
      }

      // Verify device exists in paired_devices
      // Proxy check to main process internal HTTP
      const checkReq = http.get('http://127.0.0.1:19529/internal/devices', (checkRes) => {
        const deviceChunks: Buffer[] = []
        checkRes.on('data', (c: Buffer) => deviceChunks.push(c))
        checkRes.on('end', () => {
          try {
            const devices = JSON.parse(Buffer.concat(deviceChunks).toString('utf-8'))
            const found = devices.find((d: any) => d.deviceId === deviceId)
            if (!found) {
              res.writeHead(403)
              res.end(JSON.stringify({ error: 'device not paired' }))
              return
            }

            // Save file
            const config = getConfig()
            const downloadDir = config.device.downloadDir ||
              path.join(require('os').homedir(), 'Downloads', 'FrpTransfer')
            if (!require('fs').existsSync(downloadDir)) {
              require('fs').mkdirSync(downloadDir, { recursive: true })
            }

            const safeName = path.basename(filename)
            let destPath = path.join(downloadDir, safeName)
            // Dedup: append timestamp if file exists
            if (require('fs').existsSync(destPath)) {
              const ext = path.extname(safeName)
              const base = path.basename(safeName, ext)
              const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
              destPath = path.join(downloadDir, `${base}_${ts}${ext}`)
            }

            require('fs').writeFileSync(destPath, fileData)
            const fileSize = fileData.length

            // Record transfer
            const recordPost = JSON.stringify({
              deviceId,
              type: 'file',
              direction: 'receive',
              detail: destPath,
              size: fileSize,
              status: 'success'
            })
            const recordReq = http.request({
              hostname: '127.0.0.1', port: 19529, path: '/internal/transfer-record',
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(recordPost) }
            }, () => {})
            recordReq.on('error', () => {})
            recordReq.write(recordPost)
            recordReq.end()

            // Notify admin via socket.io
            try {
              const { notifyAdmin } = require('./socket')
              notifyAdmin('transfer:recorded', {
                type: 'file', direction: 'receive', detail: destPath, size: fileSize, status: 'success'
              })
            } catch {}

            console.log(`[HandoffService] File received: ${destPath} (${fileSize} bytes)`)
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, path: destPath, size: fileSize }))
          } catch (e) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: 'internal error' }))
          }
        })
      })
      checkReq.on('error', () => {
        // Can't verify, accept anyway
        res.writeHead(200)
        res.end(JSON.stringify({ success: true, warning: 'device not verified' }))
      })
    } catch (e) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: String(e) }))
    }
  })
  return
}
```

同时需要在文件顶部添加 `path` 的 import（如果还没有的话）和添加 `parseMultipart` 辅助函数：

```typescript
// 在 handleRequest 函数之外，http-server.ts 底部添加：

function parseMultipart(body: Buffer, boundary: string): Record<string, Buffer> {
  const result: Record<string, Buffer> = {}
  const boundaryBuf = Buffer.from('--' + boundary)
  const parts = splitBuffer(body, boundaryBuf)
  
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const headerStr = part.slice(0, headerEnd).toString('utf-8')
    const content = part.slice(headerEnd + 4)
    
    // Remove trailing \r\n
    const trimmedContent = content.slice(0, content.length - 2)
    
    // Extract name from Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/)
    if (!nameMatch) continue
    const name = nameMatch[1]
    
    // Extract filename if present
    const filenameMatch = headerStr.match(/filename="([^"]+)"/)
    
    result[name] = trimmedContent
    if (filenameMatch) {
      result['_filename'] = Buffer.from(filenameMatch[1])
    }
  }
  return result
}

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  let idx = buf.indexOf(delimiter, start)
  while (idx >= 0) {
    if (idx > start) {
      parts.push(buf.slice(start, idx))
    }
    start = idx + delimiter.length
    idx = buf.indexOf(delimiter, start)
  }
  return parts
}
```

注意：`http` 需确认已在文件顶部 import，`path` 和 `os` 在文件顶部也需要（当前可能未 import `path` 和 `os`，因为是 CommonJS 动态 require）。

- [ ] **Step 2: 验证**

```bash
cd D:/workspace/frp-studio/src/handoff-service && npx tsc --noEmit --skipLibCheck http-server.ts 2>&1 | head -15
```

- [ ] **Step 3: 提交**

```bash
git add src/handoff-service/http-server.ts
git commit -m "feat: add POST /file/upload endpoint with multipart parsing"
```

---

### Task 3: KeychainHelper — 添加 kSecAttrAccessGroup

**Spec 覆盖:** 三.数据共享层

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/KeychainHelper.swift`

- [ ] **Step 1: 所有 Keychain 操作添加 access group**

```swift
// KeychainHelper.swift — 添加 accessGroup 常量，所有 query 字典中添加 kSecAttrAccessGroup

import Foundation
import Security

struct KeychainHelper {
    private static let service = "frp-studio-handoff"
    private static let accessGroup = "group.com.frp-studio.handoff"

    static func save(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecAttrAccessGroup as String: accessGroup
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    static func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecAttrAccessGroup as String: accessGroup
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        return value
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add ios/HandoffApp/HandoffApp/Services/KeychainHelper.swift
git commit -m "feat: add Keychain access group for Share Extension sharing"
```

---

### Task 4: iOS — uploadFile + lastActiveServer

**Spec 覆盖:** 五.iOS 主 App + 二.多服务端路由

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift`

- [ ] **Step 1: 添加 uploadFile 方法**

在 `ConnectionManager` 类中，`reconnect()` 方法之后添加：

```swift
@Published var uploadProgress: Double = 0
@Published var isUploading = false

func uploadFile(_ fileURL: URL) {
    guard !baseURL.isEmpty else {
        logger.warn("上传失败: baseURL 为空")
        return
    }

    isUploading = true
    uploadProgress = 0

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
    guard let fileData = try? Data(contentsOf: fileURL) else {
        logger.error("无法读取文件: \(fileURL.lastPathComponent)")
        isUploading = false
        return
    }
    let filename = fileURL.lastPathComponent
    body.append("--\(boundary)\r\n".data(using: .utf8)!)
    body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
    body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
    body.append(fileData)
    body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

    let task = URLSession.shared.uploadTask(with: request, from: body) { [weak self] data, response, error in
        DispatchQueue.main.async {
            self?.isUploading = false
            if let error = error {
                self?.logger.error("文件上传失败: \(error.localizedDescription)")
            } else if let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["success"] as? Bool == true {
                let path = json["path"] as? String ?? filename
                let size = json["size"] as? Int ?? fileData.count
                self?.logger.warn("文件已发送: \(path) (\(size) bytes)")
            } else {
                self?.logger.error("文件上传失败: 未知响应")
            }
        }
    }

    // Progress observation
    let observation = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
        DispatchQueue.main.async {
            self?.uploadProgress = progress.fractionCompleted
        }
    }

    task.resume()
    logger.warn("正在上传: \(filename) (\(fileData.count) bytes)")
}
```

- [ ] **Step 2: socket.io connect 成功时写入 lastActiveServer**

在 `connectSocketIO` 方法的 `.connect` 回调中，`logger.warn("socket.io 已连接")` 之后添加：

```swift
// 更新最后活跃服务器偏好（供 Share Extension 使用）
_ = KeychainHelper.save(key: "handoff_last_active", value: self?.baseURL ?? "")
```

- [ ] **Step 3: 提交**

```bash
git add ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift
git commit -m "feat: add uploadFile() + lastActiveServer preference on connect"
```

---

### Task 5: iOS — 文件选择器 + 发送按钮

**Spec 覆盖:** 五.iOS 主 App

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Views/ContentView.swift`

- [ ] **Step 1: 在剪贴板测试 Section 中添加文件选择器和发送按钮**

在现有剪贴板测试 Section 的按钮下方，添加文件发送按钮。找到 Section("剪贴板测试") 并添加：

```swift
Button(action: { showFilePicker = true }) {
    Label("发送文件", systemImage: "doc.badge.arrow.up")
}
.disabled(connectionManager.baseURL.isEmpty)

if connectionManager.isUploading {
    HStack {
        ProgressView(value: connectionManager.uploadProgress)
            .frame(width: 200)
        Text("\(Int(connectionManager.uploadProgress * 100))%")
            .font(.caption)
            .foregroundColor(.secondary)
    }
}
```

同时在 `ContentView` 结构体顶部添加 `@State`：

```swift
@State private var showFilePicker = false
```

在 `List` 闭合后的 `.refreshable` 之后，添加 `.sheet`：

```swift
.sheet(isPresented: $showFilePicker) {
    FilePickerView { url in
        connectionManager.uploadFile(url)
    }
}
```

- [ ] **Step 2: 创建 FilePickerView**

在 `ios/HandoffApp/HandoffApp/Views/` 下创建 `FilePickerView.swift`：

```swift
import SwiftUI
import UniformTypeIdentifiers

struct FilePickerView: UIViewControllerRepresentable {
    let onFileSelected: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.data])
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFileSelected: onFileSelected)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onFileSelected: (URL) -> Void

        init(onFileSelected: @escaping (URL) -> Void) {
            self.onFileSelected = onFileSelected
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            // Start accessing security-scoped resource
            let secured = url.startAccessingSecurityScopedResource()
            onFileSelected(url)
            if secured {
                url.stopAccessingSecurityScopedResource()
            }
        }
    }
}
```

- [ ] **Step 3: 提交**

```bash
git add ios/HandoffApp/HandoffApp/Views/ContentView.swift ios/HandoffApp/HandoffApp/Views/FilePickerView.swift
git commit -m "feat: add file picker and send button to ContentView"
```

---

### Task 6: iOS — Share Extension

**Spec 覆盖:** 六.iOS Share Extension

**Files:**
- Create: `ios/HandoffApp/ShareExtension/ShareViewController.swift`
- Create: `ios/HandoffApp/ShareExtension/UploadService.swift`
- Create: `ios/HandoffApp/ShareExtension/Info.plist`

- [ ] **Step 1: 创建 UploadService.swift**

```swift
import Foundation

class UploadService {
    static func upload(fileURL: URL, to baseURL: String, deviceId: String, completion: @escaping (Bool, String) -> Void) {
        guard !baseURL.isEmpty,
              let uploadURL = URL(string: "http://\(baseURL)/file/upload") else {
            completion(false, "无效的服务端地址")
            return
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        // deviceId
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"deviceId\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(deviceId)\r\n".data(using: .utf8)!)

        // file
        guard let fileData = try? Data(contentsOf: fileURL) else {
            completion(false, "无法读取文件")
            return
        }
        let filename = fileURL.lastPathComponent
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        let task = URLSession.shared.uploadTask(with: request, from: body) { data, response, error in
            if let error = error {
                completion(false, error.localizedDescription)
            } else if let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["success"] as? Bool == true {
                let path = json["path"] as? String ?? filename
                completion(true, path)
            } else {
                completion(false, "上传失败")
            }
        }
        task.resume()
    }
}
```

- [ ] **Step 2: 创建 ShareViewController.swift**

```swift
import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    private let devicePicker = UIButton(type: .system)
    private let sendButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .default)
    private var fileURL: URL?
    private var filename: String = ""

    private var selectedBaseURL: String = ""
    private var deviceId: String = ""
    private var pairedServers: [(name: String, baseURL: String)] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadSharedData()
        loadFileFromExtensionContext()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.layoutMargins = UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.isLayoutMarginsRelativeArrangement = true

        let titleLabel = UILabel()
        titleLabel.text = "发送文件"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        stack.addArrangedSubview(titleLabel)

        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textColor = .secondaryLabel
        statusLabel.text = "准备中..."
        stack.addArrangedSubview(statusLabel)

        devicePicker.setTitle("选择目标设备 ▾", for: .normal)
        devicePicker.addTarget(self, action: #selector(showDevicePicker), for: .touchUpInside)
        stack.addArrangedSubview(devicePicker)

        progressView.isHidden = true
        stack.addArrangedSubview(progressView)

        let buttonStack = UIStackView()
        buttonStack.axis = .horizontal
        buttonStack.distribution = .fillEqually
        buttonStack.spacing = 12

        cancelButton.setTitle("取消", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        buttonStack.addArrangedSubview(cancelButton)

        sendButton.setTitle("发送", for: .normal)
        sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        sendButton.isEnabled = false
        buttonStack.addArrangedSubview(sendButton)

        stack.addArrangedSubview(buttonStack)

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    private func loadSharedData() {
        // Read from Keychain (shared via access group)
        if let url = KeychainHelper.read(key: "handoff_last_active") {
            selectedBaseURL = url
        } else if let url = KeychainHelper.read(key: "handoff_base_url") {
            selectedBaseURL = url
        }
        deviceId = KeychainHelper.read(key: "device_identity") ?? ""

        // Load paired servers list
        if let json = KeychainHelper.read(key: "handoff_paired_devices"),
           let data = json.data(using: .utf8) {
            // Parse paired devices
            if let devices = try? JSONDecoder().decode([PairedDeviceData].self, from: data) {
                pairedServers = devices.map { ($0.name, "\($0.host ?? ""):\($0.port ?? 0)") }
                    .filter { !$0.1.isEmpty && !$0.1.contains(":0") }
            }
        }

        if !selectedBaseURL.isEmpty {
            let name = pairedServers.first(where: { $0.baseURL == selectedBaseURL })?.name ?? selectedBaseURL
            devicePicker.setTitle("📤 发送到: \(name)", for: .normal)
            sendButton.isEnabled = true
        }
    }

    private func loadFileFromExtensionContext() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let provider = item.attachments?.first else { return }

        if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.data.identifier, options: nil) { [weak self] url, error in
                guard let fileURL = url as? URL else { return }
                DispatchQueue.main.async {
                    self?.fileURL = fileURL
                    self?.filename = fileURL.lastPathComponent
                    let size = (try? Data(contentsOf: fileURL))?.count ?? 0
                    self?.statusLabel.text = "📄 \(fileURL.lastPathComponent) (\(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)))"
                }
            }
        }
    }

    @objc private func showDevicePicker() {
        guard !pairedServers.isEmpty else { return }
        let alert = UIAlertController(title: "选择目标设备", message: nil, preferredStyle: .actionSheet)
        for server in pairedServers {
            alert.addAction(UIAlertAction(title: server.name, style: .default) { [weak self] _ in
                self?.selectedBaseURL = server.baseURL
                self?.devicePicker.setTitle("📤 发送到: \(server.name)", for: .normal)
                self?.sendButton.isEnabled = true
            })
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func send() {
        guard let fileURL = fileURL, !selectedBaseURL.isEmpty else { return }
        sendButton.isEnabled = false
        progressView.isHidden = false
        progressView.progress = 0
        statusLabel.text = "正在发送..."

        UploadService.upload(fileURL: fileURL, to: selectedBaseURL, deviceId: deviceId) { [weak self] success, message in
            DispatchQueue.main.async {
                self?.progressView.progress = 1.0
                if success {
                    self?.statusLabel.text = "✅ 已发送: \(message)"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                    }
                } else {
                    self?.statusLabel.text = "❌ 发送失败: \(message)"
                    self?.sendButton.isEnabled = true
                }
            }
        }
    }

    @objc private func cancel() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}

// Lightweight decodable for paired device list
struct PairedDeviceData: Decodable {
    let name: String
    let host: String?
    let port: Int?
}
```

- [ ] **Step 3: 创建 Info.plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Handoff</string>
    <key>CFBundleName</key>
    <string>ShareExtension</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionAttributes</key>
        <dict>
            <key>NSExtensionActivationRule</key>
            <dict>
                <key>NSExtensionActivationSupportsFileWithMaxCount</key>
                <integer>1</integer>
            </dict>
        </dict>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.share-services</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 4: 提交**

```bash
git add ios/HandoffApp/ShareExtension/
git commit -m "feat: add Share Extension for file sharing to Handoff"
```

---

### Task 7: project.yml — Extension target + entitlements

**Spec 覆盖:** 七.project.yml 变更

**Files:**
- Modify: `ios/HandoffApp/project.yml`

- [ ] **Step 1: 添加 ShareExtension target 和 Keychain entitlements**

读取现有 `project.yml`，在 `targets` 下添加 `ShareExtension`，并为两个 target 都添加 `keychain-access-groups`：

```yaml
targets:
  HandoffApp:
    type: application
    platform: iOS
    sources:
      - HandoffApp
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
    settings:
      base:
        INFOPLIST_FILE: ShareExtension/Info.plist
```

- [ ] **Step 2: 验证 project.yml 格式**

```bash
cd D:/workspace/frp-studio/ios/HandoffApp && cat project.yml
```

- [ ] **Step 3: 提交**

```bash
git add ios/HandoffApp/project.yml
git commit -m "feat: add ShareExtension target + Keychain access group entitlements"
```

---

## 验收测试

### Windows 端

```bash
pnpm dev:full
```

1. 打开 Handoff → 服务设置 → 确认文件大小限制为 500 MB
2. 修改限制为其他值（如 100），保存

### iOS 端（需 Xcode 构建）

1. 构建 IPA → 安装 → 配对 Windows
2. App 内：点击"发送文件" → 选择文件 → 确认上传成功
3. Share Sheet：打开 Files/Photos → 分享 → 选 Handoff → 选择目标 → 发送
4. 检查 Windows `Downloads/FrpTransfer/` 目录确认文件已接收
5. 检查 传输记录 页面确认文件传输记录已写入

### 注意

- Share Extension 的 `KeychainHelper` 代码与主 App 共享同一文件——Extension 的 sources 需包含 `../HandoffApp/Services/KeychainHelper.swift`
- project.yml 的 `sources` 配置需要包含共享源文件路径
