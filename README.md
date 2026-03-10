# FRP Studio

> A modern desktop client for managing frpc — visualize, control, and monitor your FRP tunnels with ease.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs)
![License](https://img.shields.io/badge/license-MIT-green)

[English](#english) | [中文](#中文)

---

## English

### What is FRP Studio?

FRP Studio is a desktop GUI application for managing [frpc](https://github.com/fatedier/frp) (FRP client). It provides a clean, developer-friendly interface to configure, run, and monitor your FRP tunnels — no command-line knowledge required.

### Screenshots

> Dashboard / Tunnels / Monitor

### Features

#### Tunnel Management
- **6 tunnel types**: TCP, UDP, HTTP, HTTPS, STCP, SUDP
- **Step-by-step wizard** for creating tunnels
- **Quick templates**: SSH, Windows RDP, local web service, database
- **Group management**: organize tunnels into named groups
- **Bulk operations**: enable / disable / delete multiple tunnels at once
- **TOML import / export**: compatible with native frpc config format

#### Node Management
- Manage multiple FRP server nodes
- TCP connectivity test for each node
- Set active node for frpc startup
- Cascade delete: removing a node also removes its tunnels

#### Process Control
- Start / stop frpc with one click
- Auto-reconnect on disconnect (configurable delay and retry count)
- Windows Service support: run frpc as a background service without keeping the app open

#### Real-time Monitoring
- Live log output (stdout / stderr) with auto-scroll and export
- Traffic chart: connection count over the last 6 hours (1-minute resolution)
- Status indicators: PID, uptime, active tunnel count

#### Version Management
- Download frpc binaries from GitHub Releases
- Import local frpc executables
- Automatic version backup and restore
- Auto update detection (configurable interval)

#### System Integration
- Launch on system startup
- Minimize to system tray
- HTTP / HTTPS / SOCKS5 proxy support for downloads
- Windows Service install / uninstall / start / stop

### Installation

Download the latest installer from the [Releases](../../releases) page:

- `Frper Setup x.x.x.exe` — NSIS installer (recommended, supports custom install directory)
- `win-unpacked/` — portable version, no installation needed

### Quick Start

1. **Add a node** — Enter your FRP server address, port, and token
2. **Test connectivity** — Verify the server is reachable
3. **Create a tunnel** — Use the wizard to configure your first tunnel
4. **Start frpc** — Click "Start" and monitor via the Monitor page

### Build from Source

**Prerequisites**: Node.js 18+, pnpm

```bash
# Clone the repository
git clone https://github.com/your-username/frp-studio.git
cd frp-studio

# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build installer
pnpm build
```

Output: `dist/Frper Setup x.x.x.exe`

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 33 |
| UI Framework | Vue 3 + TypeScript |
| UI Components | Ant Design Vue 4 |
| State Management | Pinia |
| Database | sql.js (SQLite via WASM) |
| Config Format | TOML (@iarna/toml) |
| Build Tool | electron-vite + Vite 6 |
| Packager | electron-builder 25 |

### Project Structure

```
src/
├── main/               # Electron main process
│   ├── ipc/            # IPC handlers (node, tunnel, system)
│   ├── db/             # SQLite database (sql.js)
│   ├── frpc.ts         # frpc process management
│   ├── downloader.ts   # FRP version download & backup
│   ├── winsvc.ts       # Windows Service management
│   └── tray.ts         # System tray
├── preload/            # Preload scripts
└── renderer/           # Vue 3 frontend
    └── src/
        ├── views/      # Pages (Dashboard, Nodes, Tunnels, Monitor, Settings)
        ├── components/ # Reusable components
        ├── stores/     # Pinia stores
        └── router/     # Vue Router
```

### License

[MIT](LICENSE)

---

## 中文

### 什么是 FRP Studio？

FRP Studio 是一款用于管理 [frpc](https://github.com/fatedier/frp) 客户端的桌面 GUI 应用。它提供了简洁、专业的可视化界面，帮助你配置、运行和监控 FRP 隧道，无需手动编辑配置文件或使用命令行。

### 功能特性

#### 隧道管理
- **6 种隧道类型**：TCP、UDP、HTTP、HTTPS、STCP、SUDP
- **向导式创建**：3 步完成隧道配置
- **快速模板**：SSH 远程登录、Windows 远程桌面、本地 Web 服务、数据库连接
- **分组管理**：为隧道设置分组，按组展开/折叠
- **批量操作**：批量启用、停用、删除隧道
- **配置导入/导出**：兼容 frpc 原生 TOML 格式

#### 节点管理
- 管理多个 FRP 服务器节点
- TCP 连通性测试，快速验证节点可用性
- 设置活动节点，启动 frpc 时自动使用
- 删除节点时自动级联删除关联隧道

#### 进程控制
- 一键启动 / 停止 frpc
- 断线自动重连（可配置重连延迟和最大重试次数）
- Windows 服务支持：将 frpc 注册为系统服务，无需保持应用窗口打开

#### 实时监控
- 实时日志输出（支持自动滚动、清空、导出为 TXT）
- 流量趋势图（连接数统计，最近 6 小时，1 分钟精度）
- 状态指示：PID、运行时长、启用隧道数

#### 版本管理
- 从 GitHub Releases 下载 frpc 二进制文件
- 导入本地已有的 frpc 可执行文件
- 自动备份旧版本，支持一键恢复
- 自动更新检测（可配置检测间隔）

#### 系统集成
- 开机自启动
- 关闭窗口时最小化到系统托盘
- 代理设置（HTTP / HTTPS / SOCKS5），用于版本下载和更新检测
- Windows 服务管理（安装、卸载、启动、停止）

### 安装

从 [Releases](../../releases) 页面下载最新版本：

- `Frper Setup x.x.x.exe` — NSIS 安装包（推荐，支持自定义安装目录）
- `win-unpacked/` — 便携版，无需安装，解压即用

### 快速上手

1. **添加节点** — 填写 FRP 服务器地址、端口和 Token
2. **测试连通性** — 验证服务器是否可达
3. **新建隧道** — 使用向导配置第一条隧道
4. **启动 frpc** — 点击"启动"，在监控页面查看实时状态

### 从源码构建

**前置条件**：Node.js 18+，pnpm

```bash
# 克隆仓库
git clone https://github.com/your-username/frp-studio.git
cd frp-studio

# 安装依赖
pnpm install

# 开发模式运行
pnpm dev

# 构建安装包
pnpm build
```

构建输出：`dist/Frper Setup x.x.x.exe`

### 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Electron 33 |
| UI 框架 | Vue 3 + TypeScript |
| UI 组件库 | Ant Design Vue 4 |
| 状态管理 | Pinia |
| 数据库 | sql.js（SQLite WASM，免编译） |
| 配置格式 | TOML（@iarna/toml） |
| 构建工具 | electron-vite + Vite 6 |
| 打包工具 | electron-builder 25 |

### 开源协议

[MIT](LICENSE)
