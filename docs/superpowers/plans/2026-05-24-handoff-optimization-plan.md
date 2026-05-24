# 设备接力优化 — 实现计划

> **Goal:** 统一版本管理、修复 iOS 设备去重持久化、修复图标、解决版本不一致问题

**Architecture:** 根目录 `VERSION` 文件作为唯一版本源，CI 和工作流自动读取注入各平台

---

### Task 1: 创建 VERSION 文件 + HandoffService 注入版本号

**Files:** Create `VERSION`, Modify `src/handoff-service/http-server.ts`

- [ ] **Step 1: 创建 VERSION 文件**

```bash
echo "0.1.1" > VERSION
```

- [ ] **Step 2: HandoffService /health 读取 VERSION**

```typescript
// 在 http-server.ts 顶部添加
import fs from 'fs'
import path from 'path'

function getAppVersion(): string {
  try {
    return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'VERSION'), 'utf-8').trim()
  } catch {
    return '0.0.0'
  }
}
```

将 `/health` 中 `version: '0.1.0'` 改为 `version: getAppVersion()`。

注意：esbuild 打包后 `__dirname` 不可用，改用读取 `process.cwd()` 拼接路径：`path.join(process.cwd(), 'VERSION')`。

- [ ] **Step 3: 编译验证 + 提交**

```bash
pnpm build:handoff
git add VERSION src/handoff-service/http-server.ts
git commit -m "feat: add VERSION file, inject into HandoffService /health"
```

---

### Task 2: iOS 设备持久化 + 版本注入

**Files:** Modify `ios/HandoffApp/HandoffApp/Models/Device.swift`, `ios/.../Services/ConnectionManager.swift`, `ios/HandoffApp/HandoffApp/App.swift`

- [ ] **Step 1: PairedDevice 改为 Codable**

```swift
struct PairedDevice: Identifiable, Codable {
    var id: String { deviceId }
    let deviceId: String
    var name: String
    let platform: String
    var isConnected: Bool = false
    var status: String { isConnected ? "在线" : "离线" }
}
```

- [ ] **Step 2: ConnectionManager 添加持久化**

```swift
    private let storageKey = "handoff_paired_devices"

    init() {
        loadDevices()
    }

    private func saveDevices() {
        if let data = try? JSONEncoder().encode(pairedDevices) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func loadDevices() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode([PairedDevice].self, from: data) else { return }
        pairedDevices = saved
    }
```

在 `handleQRCode` 添加设备后调用 `saveDevices()`。

- [ ] **Step 3: 提交**

```bash
git add ios/
git commit -m "fix: iOS device persistence via UserDefaults, Codable model"
```

---

### Task 3: CI 读取 VERSION 统一注入

**Files:** Modify `.github/workflows/release.yml`, `.github/workflows/ios-build.yml`

- [ ] **Step 1: release.yml 从 VERSION 读取**

```yaml
      - name: Read version
        id: ver
        run: echo "VERSION=$(cat VERSION)" >> $GITHUB_OUTPUT
```

iOS `MARKETING_VERSION` 改为 `${{ steps.ver.outputs.VERSION }}`。

- [ ] **Step 2: ios-build.yml 同样处理**

```yaml
      - name: Read version
        id: ver
        run: echo "VERSION=$(cat VERSION)" >> $GITHUB_OUTPUT
```

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/
git commit -m "feat: CI reads unified VERSION file for all platforms"
```

---

### Task 4: iOS 图标修复

**Files:** Create new SVG icon, Modify `ios/.../Assets.xcassets/AppIcon.appiconset/icon.svg`

- [ ] **Step 1: 创建方形背景 SVG**

生成的 SVG 背景色填充整个 512x512 画布四角，主题图案居中。使用深色渐变背景 `#121212` → `#1a1a2e`，确保 iOS 系统圆角蒙版显效。

- [ ] **Step 2: 提交**

```bash
git add ios/.../icon.svg
git commit -m "fix: iOS icon with full-square background for rounded-square mask"
```

---

### Task 5: 集成验证

- [ ] 执行 `pnpm dev:full` 启动开发模式
- [ ] 验证 `/health` 返回 `version: "0.1.1"`
- [ ] 验证 iOS 设备去重和持久化
