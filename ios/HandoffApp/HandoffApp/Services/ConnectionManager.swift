import Foundation
import UIKit
import Network
import Security
import SocketIO

struct ClipboardFeedback: Identifiable {
    let id = UUID()
    let deviceId: String
    let transferId: String
    let kind: String
    let message: String
    let isError: Bool
}

class ConnectionManager: ObservableObject {
    @Published var pairedDevices: [PairedDevice] = []
    @Published var isScanning = false
    @Published var clipboardContent: String?
    @Published var clipboardFeedback: [String: ClipboardFeedback] = [:]
    @Published var isConnecting = false
    @Published var connectionError: String?
    @Published private(set) var connectionStates: [String: DeviceConnectionState] = [:]
    @Published var selectedDeviceId: String = "" {
        didSet {
            guard let device = pairedDevices.first(where: {
                $0.deviceId == selectedDeviceId && $0.platform.lowercased() == "windows"
            }) else { return }
            baseURL = device.host.isEmpty ? "" : "\(device.host):\(device.port)"
            currentDeviceId = device.deviceId
        }
    }

    // Retained for file uploads and the selected clipboard target.
    var baseURL: String = "" {
        didSet {
            if !baseURL.isEmpty {
                _ = KeychainHelper.save(key: "handoff_base_url", value: baseURL)
                startPolling()
            } else {
                stopPolling()
            }
        }
    }
    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var pollTimer: Timer?
    private struct DeviceSocket {
        let manager: SocketManager
        let socket: SocketIOClient
        let host: String
        let port: UInt16
    }
    private var sockets: [String: DeviceSocket] = [:]
    private var pendingManualDeviceIds: Set<String> = []

    private var lastRemoteClipboardHash: String = ""
    private var receiptOutcomes: [String: Bool] = [:]
    private var receiptOrder: [String] = []
    private var lastLocalCopyTime: Date = Date()
    var currentDeviceId: String = ""

    // Task 10b: Device identity
    private(set) var deviceId: String = ""
    private let identityKey = "handoff_identity"

    func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self = self, !self.selectedDeviceId.isEmpty else { return }
            self.pullClipboard(from: self.selectedDeviceId)
        }
        logger.info("剪贴板轮询已启动 (3s)")
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
    private let logger = DebugLogger.shared
    private let storageKey = "handoff_paired_devices"

    init() {
        loadDevices()
        ensureIdentity()
        var restoredURL = ""
        if let saved = KeychainHelper.read(key: "handoff_base_url"), !saved.isEmpty {
            restoredURL = saved
        } else if let legacyURL = UserDefaults.standard.string(forKey: "handoff_baseURL"), !legacyURL.isEmpty {
            restoredURL = legacyURL
            if KeychainHelper.save(key: "handoff_base_url", value: legacyURL) {
                UserDefaults.standard.removeObject(forKey: "handoff_baseURL")
                logger.warn("连接信息已迁移到 Keychain: \(legacyURL)")
            } else {
                logger.error("连接信息迁移到 Keychain 失败，保留旧记录")
            }
        }
        // Older paired records may not contain an endpoint. The single saved URL
        // can safely be assigned when exactly one Windows server was paired.
        let windowsIndices = pairedDevices.indices.filter {
            pairedDevices[$0].platform.lowercased() == "windows"
        }
        let endpoint = restoredURL.split(separator: ":")
        if windowsIndices.count == 1, endpoint.count == 2,
           let port = UInt16(endpoint[1]), pairedDevices[windowsIndices[0]].host.isEmpty {
            pairedDevices[windowsIndices[0]].host = String(endpoint[0])
            pairedDevices[windowsIndices[0]].port = port
            saveDevices()
        }
        let selected = pairedDevices.first(where: {
            $0.platform.lowercased() == "windows" && "\($0.host):\($0.port)" == restoredURL
        }) ?? pairedDevices.first(where: { $0.platform.lowercased() == "windows" })
        if let selected = selected {
            selectedDeviceId = selected.deviceId
            currentDeviceId = selected.deviceId
            if !selected.host.isEmpty {
                baseURL = "\(selected.host):\(selected.port)"
                _ = KeychainHelper.save(key: "handoff_base_url", value: baseURL)
                startPolling()
            }
        }
        for index in pairedDevices.indices {
            pairedDevices[index].isConnected = false
            connectionStates[pairedDevices[index].deviceId] = .offline
        }
        logger.info("已加载 \(pairedDevices.count) 个已配对设备")
        NotificationCenter.default.addObserver(forName: ClipboardService.clipboardChangedNotification, object: nil, queue: .main) { [weak self] notification in
            if let text = notification.userInfo?["text"] as? String {
                self?.sendClipboard(text)
            }
        }
    }

    private struct PendingClipboard {
        let content: String
        let transferId: String
    }
    private var pendingClipboard: [String: PendingClipboard] = [:]
    private var inFlightClipboardAttempt: [String: UUID] = [:]

    private func feedbackKey(for serverId: String, kind: String, transferId: String) -> String {
        "\(serverId):\(kind):\(transferId)"
    }

    private func clearClipboardFeedback(for serverId: String, kind: String) {
        clipboardFeedback = clipboardFeedback.filter {
            !($0.value.deviceId == serverId && $0.value.kind == kind)
        }
    }

    private func showClipboardFeedback(_ message: String, for serverId: String = "general",
                                       kind: String = "general", transferId: String = "",
                                       error: Bool = false) {
        let key = feedbackKey(for: serverId, kind: kind, transferId: transferId)
        let feedback = ClipboardFeedback(deviceId: serverId, transferId: transferId,
                                         kind: kind, message: message, isError: error)
        clipboardFeedback[key] = feedback
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self = self, self.clipboardFeedback[key]?.id == feedback.id else { return }
            self.clipboardFeedback.removeValue(forKey: key)
        }
    }

    private func saveDevices() {
        if let data = try? JSONEncoder().encode(pairedDevices),
           let json = String(data: data, encoding: .utf8) {
            _ = KeychainHelper.save(key: "handoff_paired_devices", value: json)
            logger.debug("设备列表已保存 (Keychain): \(pairedDevices.count) 个设备")
        }
    }

    private func loadDevices() {
        // Keychain first
        if let json = KeychainHelper.read(key: "handoff_paired_devices"),
           let data = json.data(using: .utf8),
           let saved = try? JSONDecoder().decode([PairedDevice].self, from: data) {
            pairedDevices = saved
            return
        }
        // Migrate UserDefaults legacy
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let saved = try? JSONDecoder().decode([PairedDevice].self, from: data) {
            pairedDevices = saved
            if let json = String(data: data, encoding: .utf8) {
                _ = KeychainHelper.save(key: "handoff_paired_devices", value: json)
            }
            UserDefaults.standard.removeObject(forKey: storageKey)
            logger.info("已配对设备已迁移到 Keychain: \(saved.count) 个")
        }
    }

    func startDiscovery() {
        isScanning = true
        logger.info("设备发现已启动")
    }

    func connect(to host: String, port: UInt16) {
        isConnecting = true
        connectionError = nil
        logger.info("正在连接 \(host):\(port)...")

        guard let url = URL(string: "ws://\(host):\(port)") else {
            connectionError = "无效的连接地址"
            logger.error("无效的 URL: ws://\(host):\(port)")
            isConnecting = false
            return
        }

        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        receiveMessage()

        logger.info("WebSocket 连接已发起")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.isConnecting = false
        }
    }

    func handleQRCode(_ code: String) -> Bool {
        logger.info("扫码内容长度: \(code.count) 字符")
        logger.debug("扫码原始内容: \(code.prefix(200))")

        guard let data = code.data(using: .utf8) else {
            connectionError = "二维码内容无法解析为 UTF-8"
            logger.error("UTF-8 解析失败")
            return false
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? NSDictionary else {
            connectionError = "二维码内容不是有效的 JSON"
            logger.error("JSON 解析失败")
            return false
        }

        logger.debug("解析 JSON 成功: \((json.allKeys as? [String])?.joined(separator: ", ") ?? "")")

        guard let host = json["host"] as? String else {
            connectionError = "二维码缺少 host 字段"
            logger.error("JSON 缺少 host, 可用字段: \((json.allKeys as? [String])?.joined(separator: ", ") ?? "")")
            return false
        }

        guard let port = json["port"] as? Int else {
            connectionError = "二维码缺少 port 字段"
            logger.error("JSON 缺少 port")
            return false
        }

        logger.info("QR 解析成功: host=\(host), port=\(port)")

        let serverDeviceId = json["deviceId"] as? String ?? host
        guard let validPort = UInt16(exactly: port), !serverDeviceId.isEmpty else {
            connectionError = "二维码中的设备地址无效"
            return false
        }

        // Dedup: don't add the same device twice
        if pairedDevices.contains(where: { $0.deviceId == serverDeviceId }) {
            logger.info("设备已存在，跳过添加: \(serverDeviceId)")
        } else {
            let device = PairedDevice(
                deviceId: serverDeviceId,
                name: "Windows-\(host)",
                platform: "windows",
                isConnected: false,
                host: host,
                port: validPort
            )
            pairedDevices.append(device)
            saveDevices()
            logger.info("设备已添加到列表: \(device.name)")
        }
        if let idx = pairedDevices.firstIndex(where: { $0.deviceId == serverDeviceId }) {
            pairedDevices[idx].host = host
            pairedDevices[idx].port = validPort
            saveDevices()
        }
        selectedDeviceId = serverDeviceId
        connectPairedDevice(serverDeviceId, host: host, port: validPort)

        return true
    }

    func pullClipboard() {
        pullClipboard(from: selectedDeviceId, manual: true)
    }

    func pullClipboard(from serverId: String, manual: Bool = false) {
        guard connectionStates[serverId] == .connected,
              let device = pairedDevices.first(where: { $0.deviceId == serverId }),
              let url = URL(string: "http://\(device.host):\(device.port)/clipboard/latest") else {
            logger.warn("pullClipboard: 目标设备未连接")
            if manual { showClipboardFeedback("目标设备未连接", for: serverId, kind: "pull", error: true) }
            return
        }
        if manual { showClipboardFeedback("正在获取 \(device.name) 的剪贴板…", for: serverId, kind: "pull") }
        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let error = error {
                    self.logger.error("剪贴板请求失败: \(error.localizedDescription)")
                    if manual { self.showClipboardFeedback("获取 \(device.name) 的剪贴板失败", for: serverId, kind: "pull", error: true) }
                    return
                }
                guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let payload = json["payload"] as? String, !payload.isEmpty,
                      let hash = json["hash"] as? String, !hash.isEmpty else {
                    if manual { self.showClipboardFeedback("\(device.name) 的剪贴板为空或不可用", for: serverId, kind: "pull", error: true) }
                    return
                }
                if manual { self.clearClipboardFeedback(for: serverId, kind: "pull") }
                self.receiveClipboard(payload, hash: hash, transferId: json["transferId"] as? String ?? "",
                                      from: serverId, manual: manual)
            }
        }.resume()
    }

    private func receiveClipboard(_ content: String, hash: String, transferId: String,
                                  from serverId: String, manual: Bool) {
        let name = pairedDevices.first(where: { $0.deviceId == serverId })?.name ?? "设备"
        guard !content.isEmpty, !hash.isEmpty else {
            if manual { showClipboardFeedback("\(name) 的剪贴板为空", for: serverId, kind: "receive", transferId: transferId, error: true) }
            return
        }
        let receiptKey = "\(serverId):\(transferId)"
        let currentContent = UIPasteboard.general.string
        if currentContent == content {
            // Content can already match because another Windows service delivered
            // it. Confirm this server's receipt without another pasteboard write.
            lastRemoteClipboardHash = hash
            clipboardContent = content
            if !transferId.isEmpty { rememberClipboardReceipt(true, key: receiptKey) }
            emitClipboardReceipt(true, transferId: transferId, to: serverId)
            if manual {
                showClipboardFeedback("\(name)：剪贴板已是最新内容", for: serverId,
                                      kind: "receive", transferId: transferId)
            }
            return
        }
        guard Date().timeIntervalSince(lastLocalCopyTime) >= 2.0 else {
            if manual { showClipboardFeedback("刚复制了本机内容，请稍后重试", for: serverId, kind: "receive", transferId: transferId) }
            return
        }
        // An explicit pull represents a new user request. Once the local-copy
        // guard expires, it may restore an older server value. Socket pushes
        // still ignore transfers and hashes already received automatically.
        if !manual && ((!transferId.isEmpty && receiptOutcomes[receiptKey] == true) ||
                       hash == lastRemoteClipboardHash) {
            return
        }
        ClipboardService.shared.setClipboard(content)
        guard UIPasteboard.general.string == content else {
            emitClipboardReceipt(false, transferId: transferId, to: serverId, error: "pasteboard write failed")
            if transferId.isEmpty || receiptOutcomes[receiptKey] != false {
                showClipboardFeedback("\(name)：写入 iOS 剪贴板失败", for: serverId, kind: "receive", transferId: transferId, error: true)
            }
            if !transferId.isEmpty { rememberClipboardReceipt(false, key: receiptKey) }
            return
        }
        lastRemoteClipboardHash = hash
        if !transferId.isEmpty { rememberClipboardReceipt(true, key: receiptKey) }
        clipboardContent = content
        emitClipboardReceipt(true, transferId: transferId, to: serverId)
        showClipboardFeedback("来自 \(name)，已复制到剪贴板", for: serverId, kind: "receive", transferId: transferId)
        logger.warn("剪贴板已同步 (\(content.count) 字符)")
    }

    private func emitClipboardReceipt(_ success: Bool, transferId: String,
                                      to serverId: String, error: String? = nil) {
        guard !transferId.isEmpty, let socket = sockets[serverId]?.socket else { return }
        var receipt: [String: Any] = [
            "transferId": transferId, "deviceId": deviceId, "success": success
        ]
        if let error = error { receipt["error"] = error }
        socket.emit("clipboard:received", receipt)
    }

    private func rememberClipboardReceipt(_ success: Bool, key: String) {
        if receiptOutcomes[key] == nil { receiptOrder.append(key) }
        receiptOutcomes[key] = success
        while receiptOrder.count > 500 {
            receiptOutcomes.removeValue(forKey: receiptOrder.removeFirst())
        }
    }

    func sendClipboard(_ content: String, manual: Bool = false) {
        guard !content.isEmpty else {
            if manual { showClipboardFeedback("iOS 剪贴板为空", error: true) }
            return
        }
        lastLocalCopyTime = Date()
        let transferId = UUID().uuidString
        var deviceCount = 0
        for device in pairedDevices where device.platform.lowercased() == "windows" {
            deviceCount += 1
            let pending = PendingClipboard(content: content, transferId: transferId)
            // This is the sole desired transfer for this device. Callbacks from
            // earlier transfers must not change it or its visible result.
            clearClipboardFeedback(for: device.deviceId, kind: "send")
            inFlightClipboardAttempt.removeValue(forKey: device.deviceId)
            pendingClipboard[device.deviceId] = pending
            if connectionStates[device.deviceId] == .connected,
               let socket = sockets[device.deviceId]?.socket {
                showClipboardFeedback("等待 \(device.name) 确认…", for: device.deviceId,
                                      kind: "send", transferId: transferId)
                sendClipboard(pending, to: device.deviceId, socket: socket)
            } else {
                showClipboardFeedback("\(device.name) 离线，连接后重试", for: device.deviceId,
                                      kind: "send", transferId: transferId)
            }
        }
        if deviceCount == 0 {
            showClipboardFeedback("尚无已配对的 Windows 设备", error: true)
        }
    }

    private func sendClipboard(_ pending: PendingClipboard, to serverId: String,
                               socket: SocketIOClient, attempt: Int = 0) {
        guard pendingClipboard[serverId]?.transferId == pending.transferId else { return }
        let attemptId = UUID()
        inFlightClipboardAttempt[serverId] = attemptId
        socket.emitWithAck("clipboard", ["payload": pending.content, "transferId": pending.transferId])
            .timingOut(after: 8) { [weak self] data in
                DispatchQueue.main.async {
                    guard let self = self,
                          self.pendingClipboard[serverId]?.transferId == pending.transferId,
                          self.inFlightClipboardAttempt[serverId] == attemptId else { return }
                    let name = self.pairedDevices.first(where: { $0.deviceId == serverId })?.name ?? "设备"
                    guard let result = data.first as? [String: Any],
                          result["transferId"] as? String == pending.transferId,
                          let success = result["success"] as? Bool else {
                        let delay = min(Double(1 << min(attempt, 4)), 15.0)
                        self.showClipboardFeedback("\(name) 未确认，正在重试…", for: serverId,
                                                   kind: "send", transferId: pending.transferId)
                        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                            guard let self = self,
                                  self.pendingClipboard[serverId]?.transferId == pending.transferId,
                                  self.inFlightClipboardAttempt[serverId] == attemptId,
                                  self.connectionStates[serverId] == .connected,
                                  let currentSocket = self.sockets[serverId]?.socket,
                                  currentSocket.status == .connected else { return }
                            self.sendClipboard(pending, to: serverId, socket: currentSocket,
                                               attempt: attempt + 1)
                        }
                        return
                    }
                    self.pendingClipboard.removeValue(forKey: serverId)
                    self.inFlightClipboardAttempt.removeValue(forKey: serverId)
                    if success {
                        self.showClipboardFeedback("已同步到 \(name)", for: serverId,
                                                   kind: "send", transferId: pending.transferId)
                    } else {
                        let reason = result["error"] as? String
                        let detail = reason == "clipboard payload too large"
                            ? "内容超过 \(name) 允许的剪贴板大小"
                            : "\(name) 写入剪贴板失败"
                        self.showClipboardFeedback(detail, for: serverId,
                                                   kind: "send", transferId: pending.transferId, error: true)
                    }
                }
            }
    }

    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.logger.debug("WebSocket 收到文本: \(text.prefix(100))")
                    self?.handleMessage(text)
                case .data(let data):
                    self?.logger.debug("WebSocket 收到二进制: \(data.count) bytes")
                    self?.handleBinary(data)
                @unknown default: break
                }
                self?.receiveMessage()
            case .failure(let error):
                self?.logger.error("WebSocket 接收失败: \(error.localizedDescription)")
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? NSDictionary,
              let type = json["type"] as? String else {
            logger.warn("WebSocket 消息解析失败: \(text.prefix(100))")
            return
        }

        logger.info("收到消息类型: \(type)")

        DispatchQueue.main.async {
            switch type {
            case "clipboard":
                if let content = json["payload"] as? String,
                   let hash = json["hash"] as? String {
                    self.receiveClipboard(content, hash: hash,
                                          transferId: json["transferId"] as? String ?? "",
                                          from: self.selectedDeviceId, manual: false)
                }
            case "file:offer":
                if let filename = json["filename"] as? String,
                   let size = json["size"] as? Int {
                    self.logger.info("收到文件传输请求: \(filename) (\(size) bytes)")
                }
            default:
                self.logger.debug("未处理的消息类型: \(type)")
            }
        }
    }

    private func handleBinary(_ data: Data) {
        logger.debug("收到二进制数据块: \(data.count) bytes")
    }

    // MARK: - Task 10b: Device identity + /pair/confirm

    private func ensureIdentity() {
        // 1. Keychain (survives uninstall)
        if let savedId = KeychainHelper.read(key: "device_identity") {
            deviceId = savedId
            logger.info("设备身份已加载 (Keychain): \(deviceId)")
            return
        }

        // 2. Migrate from UserDefaults legacy
        if let saved = UserDefaults.standard.data(forKey: identityKey),
           let dict = try? JSONSerialization.jsonObject(with: saved) as? NSDictionary,
           let savedDeviceId = dict["deviceId"] as? String {
            deviceId = savedDeviceId
            _ = KeychainHelper.save(key: "device_identity", value: deviceId)
            UserDefaults.standard.removeObject(forKey: identityKey)
            logger.info("设备身份已迁移到 Keychain: \(deviceId)")
            return
        }

        // 3. Generate new
        var randomBytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &randomBytes)
        deviceId = randomBytes.map { String(format: "%02x", $0) }.joined()
        _ = KeychainHelper.save(key: "device_identity", value: deviceId)
        logger.info("新设备身份已生成 (Keychain): \(deviceId)")
    }

    func restorePairedConnections(using discoveredDevices: [DiscoveredDevice]) {
        for device in pairedDevices where device.platform.lowercased() == "windows" {
            let discovered = discoveredDevices.first {
                !$0.deviceId.isEmpty && $0.deviceId == device.deviceId &&
                $0.platform.lowercased() == "windows"
            }
            let host = discovered?.host ?? device.host
            let port = discovered?.port ?? device.port
            if let discovered = discovered, host != device.host || port != device.port {
                updateDiscoveredDevice(discovered)
            } else {
                connectPairedDevice(device.deviceId, host: host, port: port)
            }
        }
    }

    func updateDiscoveredDevice(_ device: DiscoveredDevice) {
        guard !device.deviceId.isEmpty, device.platform.lowercased() == "windows",
              pairedDevices.contains(where: {
                  $0.deviceId == device.deviceId && $0.platform.lowercased() == "windows"
              }) else { return }
        // A Bonjour TXT record only proposes an endpoint. Persist it after the
        // server confirms its own device ID through the socket handshake.
        connectPairedDevice(device.deviceId, host: device.host, port: device.port)
    }

    func connectToDiscoveredDevice(_ device: DiscoveredDevice) {
        guard device.platform.lowercased() == "windows", !device.deviceId.isEmpty else {
            connectionError = "发现的设备缺少 Windows 身份，请扫描二维码连接"
            return
        }
        if !pairedDevices.contains(where: { $0.deviceId == device.deviceId }) {
            pairedDevices.append(PairedDevice(deviceId: device.deviceId, name: device.name,
                                              platform: "windows", host: device.host, port: device.port))
            pendingManualDeviceIds.insert(device.deviceId)
        } else {
            selectedDeviceId = device.deviceId
        }
        updateDiscoveredDevice(device)
    }

    func connectSocketIO(host: String, port: Int) {
        guard let validPort = UInt16(exactly: port),
              let device = pairedDevices.first(where: { $0.host == host && $0.port == validPort }) else { return }
        connectPairedDevice(device.deviceId, host: host, port: validPort)
    }

    private func setState(_ state: DeviceConnectionState, for serverId: String) {
        connectionStates[serverId] = state
        if let index = pairedDevices.firstIndex(where: { $0.deviceId == serverId }) {
            pairedDevices[index].isConnected = state == .connected
            if state == .connected { pairedDevices[index].lastSeen = Date() }
        }
    }

    private func connectPairedDevice(_ serverId: String, host: String, port: UInt16) {
        guard !host.isEmpty, port > 0,
              pairedDevices.contains(where: { $0.deviceId == serverId && $0.platform.lowercased() == "windows" }),
              let url = URL(string: "http://\(host):\(port)") else {
            setState(.offline, for: serverId)
            return
        }
        if let existing = sockets[serverId] {
            if existing.host == host && existing.port == port {
                if existing.socket.status == .disconnected {
                    setState(.reconnecting, for: serverId)
                    existing.socket.connect()
                }
                return
            }
            existing.socket.removeAllHandlers()
            existing.socket.disconnect()
            sockets.removeValue(forKey: serverId)
        }
        setState(.connecting, for: serverId)
        let manager = SocketManager(socketURL: url, config: [
            .log(true),
            .reconnects(true),
            .reconnectAttempts(-1),
            .reconnectWait(1),
            .reconnectWaitMax(15),
            .extraHeaders(["User-Agent": "Handoff-iOS"])
        ])
        let socket = manager.defaultSocket
        sockets[serverId] = DeviceSocket(manager: manager, socket: socket, host: host, port: port)

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            guard let self = self else { return }
            self.logger.warn("socket.io 已连接: \(serverId)")
            self.connectionError = nil
            socket.emit("auth", [
                "deviceId": self.deviceId,
                "deviceName": UIDevice.current.name,
                "platform": "ios"
            ])
        }

        socket.on("auth:ok") { [weak self] data, _ in
            guard let self = self else { return }
            guard let confirmation = data.first as? [String: Any],
                  let confirmedServerId = confirmation["serverDeviceId"] as? String,
                  confirmedServerId == serverId else {
                self.connectionError = "服务端身份不匹配: \(host):\(port)"
                self.logger.error("拒绝服务端身份不匹配的连接: \(serverId) @ \(host):\(port)")
                socket.removeAllHandlers()
                socket.disconnect()
                self.sockets.removeValue(forKey: serverId)
                self.setState(.offline, for: serverId)
                if self.pendingManualDeviceIds.remove(serverId) != nil {
                    self.pairedDevices.removeAll { $0.deviceId == serverId }
                    self.connectionStates.removeValue(forKey: serverId)
                }
                return
            }
            if let index = self.pairedDevices.firstIndex(where: { $0.deviceId == serverId }),
               self.pairedDevices[index].host != host || self.pairedDevices[index].port != port {
                self.pairedDevices[index].host = host
                self.pairedDevices[index].port = port
                if self.selectedDeviceId == serverId { self.selectedDeviceId = serverId }
            }
            self.setState(.connected, for: serverId)
            if self.pendingManualDeviceIds.remove(serverId) != nil {
                self.selectedDeviceId = serverId
            }
            self.logger.info("设备已注册: \(self.deviceId), serverId=\(serverId)")
            if let pending = self.pendingClipboard[serverId] {
                self.showClipboardFeedback("正在重试发送到 \(self.pairedDevices.first(where: { $0.deviceId == serverId })?.name ?? "设备")…",
                                           for: serverId, kind: "send", transferId: pending.transferId)
                self.sendClipboard(pending, to: serverId, socket: socket)
            }
            self.saveDevices()
            ClipboardService.shared.checkNow()
        }

        socket.on("clipboard") { [weak self] data, _ in
            guard let self = self,
                  let msg = data.first as? [String: Any],
                  let payload = msg["payload"] as? String,
                  let hash = msg["hash"] as? String else { return }
            self.receiveClipboard(payload, hash: hash,
                                  transferId: msg["transferId"] as? String ?? "",
                                  from: serverId, manual: false)
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.logger.warn("socket.io 断开: \(serverId)")
            self?.setState(.reconnecting, for: serverId)
            if let pending = self?.pendingClipboard[serverId] {
                let name = self?.pairedDevices.first(where: { $0.deviceId == serverId })?.name ?? "设备"
                self?.showClipboardFeedback("\(name) 重连后继续发送", for: serverId,
                                            kind: "send", transferId: pending.transferId)
            }
        }

        socket.on(clientEvent: .error) { [weak self] data, _ in
            self?.setState(.reconnecting, for: serverId)
            self?.logger.warn("socket.io 重连中 (\(host):\(port)): \(data)")
        }

        logger.warn("正在连接 socket.io: \(host):\(port)")
        socket.connect()
    }

    func reconnect() {
        logger.warn("手动重连触发")
        for (serverId, entry) in sockets where entry.socket.status == .disconnected {
            setState(.reconnecting, for: serverId)
            entry.socket.connect()
        }
        restorePairedConnections(using: DiscoveryService.shared.discoveredDevices)
        DiscoveryService.shared.startBrowsing()
        ClipboardService.shared.checkNow()
    }

    @Published var uploadProgress: Double = 0
    @Published var isUploading = false

    func uploadFile(_ fileURL: URL) {
        guard !baseURL.isEmpty else {
            logger.warn("上传失败: baseURL 为空")
            return
        }

        isUploading = true
        uploadProgress = 0

        guard let uploadURL = URL(string: "http://\(baseURL)/file/upload") else { return }
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"deviceId\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(deviceId)\r\n".data(using: .utf8)!)

        guard let fileData = try? Data(contentsOf: fileURL) else {
            logger.error("无法读取文件: \(fileURL.lastPathComponent)")
            isUploading = false
            return
        }
        let filename = fileURL.lastPathComponent
        logger.warn("上传 deviceId=\(deviceId) filename=\(filename) size=\(fileData.count)")

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
                } else if let httpResponse = response as? HTTPURLResponse {
                    let statusCode = httpResponse.statusCode
                    let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "nil"
                    if statusCode == 200,
                       let data = data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? NSDictionary,
                       json["success"] as? Bool == true {
                        let path = json["path"] as? String ?? filename
                        let size = json["size"] as? Int ?? fileData.count
                        self?.logger.warn("文件已发送: \(path) (\(size) bytes)")
                    } else {
                        self?.logger.error("文件上传失败: HTTP \(statusCode) body=\(bodyStr)")
                    }
                } else {
                    self?.logger.error("文件上传失败: 无 HTTP 响应")
                }
                // Clean up temp file after upload (success or failure)
                let tempDir = fileURL.deletingLastPathComponent().deletingLastPathComponent()
                if tempDir.path.contains(NSTemporaryDirectory()) {
                    try? FileManager.default.removeItem(at: tempDir)
                }
            }
        }

        _ = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
            DispatchQueue.main.async {
                self?.uploadProgress = progress.fractionCompleted
            }
        }

        task.resume()
        logger.warn("正在上传: \(filename) (\(fileData.count) bytes)")
    }
}
