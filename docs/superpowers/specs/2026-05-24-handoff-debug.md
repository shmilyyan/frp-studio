# 设备接力模块 — 调试基础设施设计 v1.3

> 创建：2026-05-24 | 状态：待实现

## 目标

在两端建立可观测性，用一个 HTTP 请求即可验证剪贴板全链路。

## HandoffService 调试端点

```
GET  /debug/status    → { uptime, wsClients, clipboardCache, pairedDevices, version }
POST /debug/clipboard  → 手动写入剪贴板（{ text: "test" }），返回 { success, written }
GET  /clipboard/latest → 独立 HTTP 端点返回最新剪贴板 { hash, payload }
POST /clipboard        → HTTP 接收剪贴板，功能等价于 WS clipboard handler
```

## FRP Studio 诊断 Tab

HandoffView 新增"诊断"Tab：进程状态、连接数、剪贴板手动测试、实时事件流。

## iOS 调试增强

- 连接状态指示（始终可见）
- 剪贴板测试按钮（发送/接收）
- 调试日志默认显示（不依赖开关）

## 剪贴板通道独立化

剪贴板同步不再经过 WebSocket 消息路由，改为独立 HTTP 端点。

| 方向 | 端点 |
|------|------|
| Windows → iOS | `GET /clipboard/latest` |
| iOS → Windows | `POST /clipboard` |
