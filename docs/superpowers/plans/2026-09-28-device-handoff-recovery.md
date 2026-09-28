# 设备接力连接恢复与反馈实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Windows 主动发现、iOS 多设备自动恢复连接，以及双向剪贴板传输的确认和即时反馈。

**Architecture:** 保留现有 Bonjour、Socket.IO、HTTP/IPC 与 SwiftUI 结构。Windows 服务把可靠的发现记录推到管理界面；iOS 用设备 ID 管理各已配对服务端的独立 socket；剪贴板消息通过 Socket.IO ACK 和接收回报形成送达反馈，两端以短暂应用内提示呈现。

**Tech Stack:** Electron、Node.js、TypeScript、Socket.IO、Vue 3/Pinia、Swift、SwiftUI、Bonjour。

**Spec:** `docs/superpowers/specs/2026-09-28-device-handoff-recovery-design.md`

## Global Constraints

- Bonjour 发现只表示局域网可达；不得自动配对或建立未经认证的信任。
- 自动恢复只连接本地已配对的 Windows 服务端。
- 每台设备的在线状态以已认证 Socket.IO 会话为准，mDNS 不得显示为在线。
- 剪贴板反馈不含剪贴板正文，不新增系统通知权限请求。
- 重复传输按传输 ID/hash 去重，避免重复写入和重复提示。
- 保留已有二维码/手动连接入口和本地复制保护。

## Review Focus

- Bonjour 答复延迟超过单轮窗口：不能把仍在线设备误报离线；由 Task 1 检查迟到/重叠扫描的集合更新。
- Bonjour TXT 缺少 deviceId 或响应缺少可用 A/AAAA：不能生成虚假的 `0.0.0.0` 可连接项；由 Task 1 检查设备身份与地址的降级行为。
- 多台已配对服务器同时启动或回到前台：不能覆盖连接状态或创建重复 socket；由 Task 2 检查每设备连接键和幂等恢复。
- iOS 收到的剪贴板内容与刚刚本地复制的内容冲突，或同一内容通过推送/轮询重复到达：保留本地复制保护并只写入/提示一次；由 Task 3 检查 hash 与传输 ID 去重。
- Socket 发送 ACK 超时、写 Windows 剪贴板失败、iOS 写剪贴板失败，或 2 秒本地复制保护拦截 Windows 推送：界面显示失败/待重试，不能静默或显示成功；由 Task 3 检查每个确认阶段。
- 用户连续复制新内容时旧 ACK/超时回调晚到：旧内容不能覆盖或排在新内容之后重发；由 Task 3 检查每设备最新传输序列。
- 多个 Windows 服务端在短时间内确认相同内容：每个目标仍需得到自己的接收确认和可见状态，但系统剪贴板只需写入一次；由 Task 3 检查每设备 ACK 与全局写入去重的分离。
- 用户明确手动拉取与历史上相同的服务端内容，但当前剪贴板已经变化且本地复制保护窗口已过：应按用户这次手动操作写入该内容，不能被自动推送的 hash/receipt 去重状态拦截；由 Task 3 检查手动路径语义。

## Implementation Notes

本仓库未配置接力模块的自动化测试脚本；本计划不增加或运行测试。每个任务完成后由独立审阅子代理对照规格和代码路径审查，最终只做 diff/协议路径审查。

---

### Task 1: Windows Bonjour 发现结果与管理界面

**Files:**
- Modify: `src/handoff-service/mdns.ts`
- Modify: `src/handoff-service/scanner.ts`
- Modify: `src/handoff-service/http-server.ts`
- Modify: `src/main/handoff-ipc-client.ts` (forward the complete discovery event payload if required)
- Modify: `src/renderer/src/stores/handoff.ts`
- Modify: `src/renderer/src/components/DeviceList.vue`
- Modify: `src/renderer/src/env.d.ts` only if a changed IPC shape requires a public type

**Interfaces:**
- Discovery event `bonjour:found`: `{ discoveryId: string; deviceId?: string; deviceName: string; platform: string; host?: string; port?: number; lastSeen: number }`; `discoveryId` is `deviceId` when available, otherwise a stable name/endpoint key. Omit `host` when address resolution fails and omit `port` when the SRV record advertises port `0`.
- Discovery event `bonjour:lost`: `{ discoveryId: string; deviceId?: string }`.
- Pinia `DiscoveredPeer`: the same found fields plus `status: 'reachable' | 'offline'`; port `0` means “client discovered, no Windows-connectable listener,” not a malformed discovery.
- Existing `window.api.handoff.scanDevices()` remains the manual refresh entry point.

- [x] **Step 1: Repair service-record address resolution.** In `mdns.ts`, associate A/AAAA records with the SRV target hostname; publish a host only when resolved and omit a port of `0` (iOS advertises as a client and has no Windows-connectable listener). Parse name/platform from TXT metadata and preserve a stable deviceId when available.
- [x] **Step 2: Make each scan cycle explicit.** In `scanner.ts`, maintain a current discovery map and last-seen timestamps; finalize a scan only for its own response window, tolerate late/overlapping responses, and mark missing devices stale only after multiple missed intervals. Make `refreshScan()` clear/start an immediate query without erasing valid prior state before the response window completes.
- [x] **Step 3: Emit complete discovery state.** Send the defined `bonjour:found` payload and `bonjour:lost` payload through the existing admin socket notification. Use `discoveryId` to add/remove devices that lack a deviceId. Keep discovery separate from paired-device persistence and peer-authenticated online state.
- [x] **Step 4: Render discoveries independently from paired devices.** In the Handoff store and `DeviceList.vue`, show a “局域网发现” section with device name, platform, resolved address when present, and last seen. Label port-zero iOS advertisements “已发现，等待客户端连接”; do not present them as Windows-connectable endpoints. Retain pairing as an explicit separate action. Make manual scan refresh this list and avoid conflating it with the paired list.
- [x] **Step 5: Review Task 1 diff against discovery requirements.** No automated test command is part of this task; inspect data flow from mDNS answer through admin event to the visible list, including missing ID/address and late response behavior.

### Task 2: iOS per-device startup and foreground reconnection

**Files:**
- Modify: `ios/HandoffApp/HandoffApp/Models/Device.swift`
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift`
- Modify: `ios/HandoffApp/HandoffApp/Services/DiscoveryService.swift`
- Modify: `ios/HandoffApp/HandoffApp/App.swift`
- Modify: `ios/HandoffApp/HandoffApp/Views/ContentView.swift`
- Modify: `src/handoff-service/socket.ts` (include Windows server identity in peer auth confirmation)

**Interfaces:**
- `ConnectionManager.restorePairedConnections(using discoveredDevices: [DiscoveredDevice])` starts/reuses one Socket.IO connection per paired `deviceId`, preferring a matching discovered endpoint and otherwise using the persisted `host`/`port`.
- `ConnectionManager.updateDiscoveredDevice(_ device: DiscoveredDevice)` updates and reconnects only a matching paired device.
- `DiscoveryService.onDeviceDiscovered: ((DiscoveredDevice) -> Void)?` reports newly resolved/updated Bonjour endpoints to the connection manager.
- Per-device connection states are `connecting`, `connected`, `reconnecting`, or `offline` and are keyed by `deviceId`.
- Automatic local clipboard changes are sent to every currently connected paired Windows service; manual clipboard pulls target one selected device.
- Peer `auth:ok` response includes both the authenticated iOS `deviceId` and the Windows `serverDeviceId`; the client must match `serverDeviceId` to the intended paired Windows device before saving a newly discovered endpoint or showing connected state.

- [x] **Step 1: Separate persistent device identity from live socket state.** Preserve `PairedDevice` Codable compatibility and existing Keychain migration; migrate the legacy UserDefaults URL to Keychain before clearing it; initialize the selected Windows device and `baseURL` explicitly (property observers do not run during init); choose a Windows device only. Maintain each device's current endpoint and connection status without treating the legacy single `baseURL` as the complete device list.
- [x] **Step 2: Add an idempotent connection registry.** In `ConnectionManager`, retain SocketManager/SocketIOClient pairs by `deviceId`; configure existing infinite retry/backoff for every socket; authenticate with the local iOS identity; update only that device's state on connect, auth success, error, and disconnect. In `socket.ts`, return the Windows `serverDeviceId` in peer `auth:ok`; reject mismatches before changing the saved endpoint or connected state. Preserve the QR/manual connection path by adding its server to the same registry.
- [x] **Step 3: Restore known devices on launch and foreground.** Invoke `restorePairedConnections(using:)` after persisted devices load and when the app becomes active. Reuse existing sockets and prevent parallel duplicate attempts; explicitly reconnect any socket whose transport is disconnected, including the reconnecting state after foreground suspension. Only iterate paired Windows services.
- [x] **Step 4: Refresh saved endpoints from Bonjour.** Have `DiscoveryService` call `onDeviceDiscovered`; `ConnectionManager.updateDiscoveredDevice(_:)` matches by stable deviceId, updates the saved host/port and retries only that known device. Keep unpaired discovered servers visible for explicit user connection and never auto-trust them.
- [x] **Step 5: Show per-device state.** In `ContentView.swift`, list each saved device's real live state and give clipboard pull/send actions a clear target when multiple services are connected. Keep existing QR pairing and manual refresh actions.
- [x] **Step 6: Review Task 2 diff against reconnect requirements.** No automated test command is part of this task; inspect launch/foreground, duplicate activation, one-server-offline, Bonjour address change, QR migration, and multi-device state paths.

### Task 3: Clipboard acknowledgments and immediate feedback

**Files:**
- Modify: `src/handoff-service/socket.ts`
- Modify: `src/handoff-service/clipboard.ts`
- Modify: `src/handoff-service/index.ts` (pass watcher transfer metadata to the broadcast callback)
- Modify: `src/main/handoff-ipc-client.ts`
- Modify: `src/renderer/src/stores/handoff.ts`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/views/HandoffView.vue` (move service-event lifecycle to App.vue)
- Modify: `ios/HandoffApp/HandoffApp/Services/ConnectionManager.swift`
- Modify: `ios/HandoffApp/HandoffApp/Views/ContentView.swift`

**Interfaces:**
- iOS-to-Windows `clipboard` payload: `{ payload: string; transferId: string }`; Socket.IO ACK: `{ success: boolean; transferId: string; error?: string; written?: number }`.
- Windows-to-iOS `clipboard` payload: `{ payload: string; hash: string; transferId: string; sourceId: string; timestamp: number }`.
- iOS receive confirmation event `clipboard:received`: `{ transferId: string; deviceId: string; success: boolean; error?: string }`.
- Windows admin delivery event `clipboard:delivery`: `{ transferId: string; deviceId: string; deviceName: string; direction: 'send' | 'receive'; success: boolean; error?: string; size: number }`.

- [x] **Step 1: Acknowledge iOS-to-Windows writes.** In `socket.ts`, accept an ACK callback for authenticated peer clipboard messages, validate payload size against `clipboardMaxSize`, perform the existing Windows clipboard write, and ACK only after the write succeeds. Return a structured failure for invalid/oversize content or write failure. Notify the admin with the corresponding successful receive event.
- [x] **Step 2: Track Windows-to-iOS delivery.** In `clipboard.ts` and `socket.ts`, assign one transferId to each newly detected Windows clipboard hash, pass it through the service entry point in `index.ts`, include it in the peer broadcast, accept authenticated `clipboard:received` events, and notify the admin UI per receiving device. Deduplicate repeated receipts by transfer/device/status while allowing a later success to replace an earlier failed result.
- [x] **Step 3: Surface Windows feedback across the app.** Keep the Handoff Socket.IO event stream connected for the renderer app lifetime by moving its lifecycle from `HandoffView.vue` to `App.vue`. Forward `clipboard:delivery` through the admin socket client and store; display short success/failure messages with device and direction, never clipboard text. Keep passive background polling silent until a real delivery result arrives.
- [x] **Step 4: Confirm iOS sends and receives.** In `ConnectionManager`, send local changes to each currently connected paired Windows service independently, collect each service's ACK, keep only the latest intended transfer per device, and retry a missing ACK while connected without allowing an older timeout to replace newer content. Emit `clipboard:received` after a new pasteboard write and for every authenticated server whose content already matches the current pasteboard. Route socket push and device-targeted manual pull through one receive function; deduplicate automatic pasteboard writes globally by hash/content but track confirmations independently by server/transfer. An explicit manual pull may reapply a previously seen transfer after the two-second local-copy protection if the current pasteboard differs; if it already matches, report success without another write.
- [x] **Step 5: Present concise iOS feedback.** In `ContentView.swift`, show per-device transient statuses for confirmed sends, completed receives, waiting/retrying, and errors so concurrent device results remain visible. Manual pull/send controls must report their own result. Repeated hashes or transferIds produce one pasteboard write, while each server receives an accurate confirmation. Retain the existing latest-clipboard preview; notifications/status must not expose clipboard text.
- [x] **Step 6: Review Task 3 diff against the transfer contract.** No automated test command is part of this task; inspect each direction from origin through ACK/receive confirmation to UI, including no-ACK, write failure, duplicate delivery, reconnect queue behavior, and a push deferred by local-copy protection.

### Task 4: Cross-task integration review

**Files:**
- Review all files changed by Tasks 1–3; edit only to resolve a confirmed integration defect.

- [x] **Step 1: Check event and model consistency.** Confirm device IDs, Bonjour endpoint fields, connection status, transfer IDs, event names, and ACK result shapes agree across Node, preload/renderer, and Swift.
- [x] **Step 2: Check user-facing state transitions.** Confirm “reachable” never means paired/online, offline status is per device, clipboard feedback is tied to a write/delivery result, and duplicate events do not spam.
- [x] **Step 3: Review the final diff.** Do not add or run tests; report any platform build checks that were not run.



