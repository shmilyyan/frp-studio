# 设备接力模块 — 优化设计 v1.2

> 创建：2026-05-24 | 状态：待实现

## 一、统一版本管理

**问题：** 三端版本独立，无法确认用户是否运行最新代码。

**方案：** 根目录 `VERSION` 文件作为唯一版本源。

```
VERSION      → 内容: 0.1.1
```

- **FRP Studio**: `package.json` 的 `version` 由 CI 从 VERSION 读取后写入
- **iOS**: CI 读取 `cat VERSION` 作为 `MARKETING_VERSION`，build 号使用 `git rev-parse --short=7 HEAD`
- **HandoffService**: `GET /health` 的 `version` 字段在编译时从 `VERSION` 文件注入到代码中

### VERSION 更新流程

- 开发者手动修改 `VERSION` 文件
- `pnpm dev:full` 将当前 VERSION 注入 HandoffService 构建
- CI release 工作流读取 VERSION 注入所有平台构建

---

## 二、iOS 设备去重 + 持久化

**问题：** App 重启后设备列表丢失；多次扫码同一设备仍可能重复。

**方案：**

1. 扫码时按 `deviceId` 去重（已有代码，`0167fc5`）
2. `pairedDevices` 数组持久化到 `UserDefaults`，使用 `Codable` 序列化
3. App 启动时从 `UserDefaults` 恢复设备列表
4. 配对新设备时同时更新内存数组和持久化存储

---

## 三、Windows 设备列表显示

**问题：** FRP Studio UI 不显示 iOS 已配对设备。

**方案：** 代码已修复（`/devices` 端点调用 `reloadConfig()`），确保以下步骤：

1. HandoffService 必须使用 `pnpm dev:full` 启动（先编译再运行）
2. FRP Studio 的 `fetchDevices()` 在页面加载和 SSE `device-paired` 事件时刷新
3. 设备数据格式统一为 camelCase（`deviceId`/`deviceName`），前端接口和服务端已对齐

---

## 四、iOS 圆角方形图标

**问题：** 当前 SVG 图标中心圆形图案外有透明/浅色区域，iOS 上显示为圆形。

**方案：** 修改 `option-c.svg` 或创建新 SVG，背景色填充整个 512x512 画布至四角，主题图案居中。iOS 系统自动应用圆角方形蒙版。

---

## 五、实施清单

| 序号 | 任务 | 涉及文件 |
|------|------|----------|
| 1 | 创建 `VERSION` 文件 | `VERSION` (新建) |
| 2 | HandoffService 注入版本号 | `src/handoff-service/http-server.ts` |
| 3 | 更新 iOS CI 读取 VERSION | `.github/workflows/release.yml`, `ios-build.yml` |
| 4 | iOS 设备持久化 | `ios/.../ConnectionManager.swift`, `PairedDevice` 改为 `Codable` |
| 5 | iOS 图标修复 | `icons/` 或 `ios/.../icon.svg` |
