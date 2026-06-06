# iOS 设备 ID Keychain 持久化

> 创建：2026-06-07 | 状态：待实现

## 问题

iOS 设备 ID 存储在 `UserDefaults` 中，App 卸载后 `UserDefaults` 被系统清除。重新安装 App 时生成新的设备 ID，Windows 服务端将其视为全新设备，用户需重新扫码配对——体验极差。

## 目标

将设备 ID 存储从 `UserDefaults` 迁移到 iOS Keychain，确保 App 卸载重装后设备 ID 不变，配对关系得以保持。

## 方案

### 存储策略

```
ensureIdentity() 读取优先级:
  1. Keychain (kSecClassGenericPassword)
     → 命中：直接使用
  2. UserDefaults (旧应用迁移)
     → 命中：迁移到 Keychain，删除 UserDefaults 旧条目
  3. 都没有
     → 新设备：SecRandomCopyBytes(16) → 写入 Keychain
```

### Keychain 访问配置

| 参数 | 值 |
|------|-----|
| Class | `kSecClassGenericPassword` |
| Service | `frp-studio-handoff` |
| Account | `device_identity` |
| Accessibility | `kSecAttrAccessibleAfterFirstUnlock` |

无 iCloud 同步需求，不加 `kSecAttrSynchronizable`。

### 删除条件

| 场景 | ID 是否保留 |
|------|------------|
| App 卸载 → 重装 | ✅ 保留 |
| 设备抹掉/恢复出厂 | ❌ 删除 |
| 换新 iPhone | ❌ 不存在（合理空状态） |
| 更换开发者签名 | ⚠️ 不可访问（access group 隔离） |

## 改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `ios/HandoffApp/HandoffApp/Services/KeychainHelper.swift` | 新建 | Keychain 读写封装 |
| `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift` | 修改 | `ensureIdentity()` 替换读取路径 |
| `ios/HandoffApp/HandoffApp/Services/AdvertiseService.swift` | 修改 | `start()` 中 deviceId 读取改用 Keychain |

总共 1 个新文件 + 2 处修改。
