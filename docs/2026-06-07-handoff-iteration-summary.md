# Handoff 模块迭代总结

> 日期：2026-06-07 | 版本：0.1.x

---

## 一、iOS 26 兼容性修复

### 问题：App 安装后闪退（SIGABRT）

**根因：** iOS 26（iPhone OS 26.5.1）改变了 Foundation 框架中 `NSDictionary` → Swift `[String: Any]` 的桥接行为。`as?` 条件转换内部触发了 `_unconditionallyBridgeFromObjectiveC`，类型不匹配时直接 `fatalError`。

**涉及的 API：**
- `JSONSerialization.jsonObject(with:) as? [String: Any]`
- `NetService.dictionary(fromTXTRecord:)` 返回值 `[String: Data]`
- Bonjour delegate 参数 `[String: NSNumber]`

**修复：**
- `ConnectionManager.swift`：所有 `[String: Any]` → `NSDictionary`
- `AdvertiseService.swift`：`[String: String]` → `NSDictionary`
- `DiscoveryService.swift`：TXT 解析改为手动 + JSON 双模式；`NetService.dictionary()` 替换为手动解析
- Bonjour delegate 方法保持 `[String: NSNumber]`（Xcode 16.4 协议一致性要求）

### 问题：启动时序竞态

**根因：** `App.init()` 中同步初始化 ClipboardService、AdvertiseService、pasteboard 访问，与 SwiftUI 视图初始化竞速。

**修复：** 所有服务启动从 `App.init()` 移到 `ContentView.onAppear()`。

### 问题：Keychain access group 证书不兼容

**根因：** 淘宝证书的 Provisioning Profile 不支持 `keychain-access-groups` entitlement。

**修复：** 移除 `kSecAttrAccessGroup`，纯 Keychain 读写（卸载重装保留数据）。

---

## 二、iOS → Windows 文件传输

### 协议

```
iOS HTTP multipart POST /file/upload  →  Windows HandoffService
Content-Type: multipart/form-data
Body: deviceId + file content
```

### iOS 端

| 文件 | 功能 |
|------|------|
| `FilePickerView.swift` | `UIDocumentPickerViewController(documentTypes: ["public.item"])` |
| `ContentView.swift` | "发送文件" + "发送多个文件" 按钮 + 进度条 |
| `ConnectionManager.swift` | `uploadFile(url:)` 构建 multipart body + URLSession 上传 |
| `FolderZipper.swift` | 手写 ZIP 格式：CRC32 + 本地头 + 中央目录 + EOCD |
| `KeychainHelper.swift` | 设备 ID、baseURL、已配对设备持久化 |

### Windows 端

| 端点 | 功能 |
|------|------|
| `POST /file/upload` | multipart 解析 → 存盘 → 传输记录 → 通知 admin |
| 自动解压 `.zip` | PowerShell `Expand-Archive` → 删除源 zip |
| `/health` 配置 | 暴露 `fileMaxSize`（默认 500MB） |

### 错误处理

| 阶段 | 处理 |
|------|------|
| 安全作用域 | `defer { stopAccessingSecurityScopedResource() }` 延迟释放 |
| 上传失败 | 错误回调 → 清理临时文件 |
| 解压失败 | 保留 zip，不删除 |

### 已知限制

- **iOS 26 文件夹选择：** `UIDocumentPickerViewController` 在 iOS 26 上不支持文件夹选择（Apple 开发者论坛已确认 bug）。替代方案：用户手动压缩文件夹为 .zip，或使用多文件选择自动打包。

---

## 三、设备配对优化

### 已配对设备持久化

| 数据 | 存储 | 卸载重装 |
|------|------|----------|
| `deviceId` | Keychain | ✅ 保留 |
| `baseURL` | Keychain | ✅ 保留 |
| `pairedDevices` | Keychain | ✅ 保留 |

### Bonjour 设备发现 → 自动配对

修复链路：

```
Windows mDNS TXT 记录 (含 deviceId)
  → multicast-dns 加 DNS-SD 长度前缀
  → iOS 跳过前缀 → JSON 解析 → 提取 deviceId
  → 用户点"连接" → currentDeviceId 赋值
  → socket.io auth:ok → 创建 PairedDevice → Keychain 持久化
```

### 发现的设备去重

- Bonjour `didFind` 按服务名去重（阻止重复解析）
- 发现列表过滤已配对设备（按 host:port）
- 去重键按 Bonjour 服务名（避免 hostname vs IP 重复）

### IP 地址优先

`DiscoveryService` 从 `sender.addresses` 提取 IPv4，替代 hostName 用于连接。

---

## 四、UI 优化

| 改动 | 说明 |
|------|------|
| "发现的设备"过滤 | 排除已在 pairedDevices 中的设备 |
| "剪贴板测试" 更名 | → "剪贴板" |
| "文件传输" 独立 | 新 Section，含发送文件 + 多文件打包 |
| 传输记录 "操作列" | "打开文件夹" 按钮（`shell.showItemInFolder`） |
| 注销清理 | `stopBrowsing()` / `startBrowsing()` 清空 resolve 集合 |

---

## 五、改动文件清单

### iOS
| 文件 | 操作 |
|------|------|
| `Services/KeychainHelper.swift` | 恢复（无 accessGroup） |
| `Services/ConnectionManager.swift` | 多处修改 |
| `Services/DiscoveryService.swift` | TXT 解析 + IP 提取 + 去重 |
| `Services/AdvertiseService.swift` | NSDictionary + Keychain |
| `Services/ClipboardService.swift` | 无修改 |
| `Services/DebugLogger.swift` | 文件日志 |
| `Services/FolderZipper.swift` | 新建（手动 ZIP + 多文件打包） |
| `Views/ContentView.swift` | UI 重组 + 文件传输按钮 |
| `Views/FilePickerView.swift` | 文件选择 + 多选模式 |
| `App.swift` | 延迟服务启动 |
| `Info.plist` | iTunes 文件共享 |
| `project.yml` | 移除 ShareExtension + 锁定 SocketIO |

### Windows
| 文件 | 操作 |
|------|------|
| `http-server.ts` | `/file/upload` + zip 解压 + boundary 修复 |
| `mdns.ts` | TXT 加 deviceId |
| `config.ts` | `fileMaxSize` |
| `handoff-ipc-client.ts` | 事件转发 |
| `ipc/handoff.ts` | open-folder + scan IPC |
| `preload/index.ts` | 暴露新方法 |
| `renderer/HandoffSettings.vue` | 文件大小限制 (MB) |
| `renderer/TransferHistory.vue` | 操作列 + 打开文件夹 |
| `renderer/env.d.ts` | 类型声明 |

---

## 六、未完成项

- [ ] 多文件 zip 解压后内容验证（待用户测试）
- [ ] iOS 26 原生文件夹选择（等待 Apple 修复）
- [ ] 已配对设备在 Windows 设备列表中显示在线状态（已有基础，待完善）
