import Foundation
import UIKit
import Network
import Security
import SocketIO

class ConnectionManager: ObservableObject {
    @Published var pairedDevices: [PairedDevice] = []
    @Published var isScanning = false
    @Published var clipboardContent: String?
    @Published var isConnecting = false
    @Published var connectionError: String?
    @Published private(set) var connectionStates: [String: DeviceConnectionState] = [:]
    @Published var selectedDeviceId: String = "" {
        didSet {
            guard let device = pairedDevices.first(where: { $0.deviceId == selectedDeviceId }) else { return }
            baseURL = "\(device.host):\(device.port)"
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

    private var lastRemoteClipboardHash: String = ""
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
        if let saved = KeychainHelper.read(key: "handoff_base_url"), !saved.isEmpty {
            baseURL = saved
        } else if let legacyURL = UserDefaults.standard.string(forKey: "handoff_baseURL"), !legacyURL.isEmpty {
            baseURL = legacyURL
            UserDefaults.standard.removeObject(forKey: "handoff_baseURL")
            logger.warn("连接信息已迁移到 Keychain: \(legacyURL)")
        }
        // Older paired records may not contain an endpoint. The single saved URL
        // can safely be assigned when exactly one Windows server was paired.
        let windowsIndices = pairedDevices.indices.filter {
            pairedDevices[$0].platform.lowercased() == "windows"
        }
        let endpoint = baseURL.split(separator: ":")
        if windowsIndices.count == 1, endpoint.count == 2,
           let port = UInt16(endpoint[1]), pairedDevices[windowsIndices[0]].host.isEmpty {
            pairedDevices[windowsIndices[0]].host = String(endpoint[0])
            pairedDevices[windowsIndices[0]].port = port
            saveDevices()
        }
        if let savedSelection = pairedDevices.first(where: { "\($0.host):\($0.port)" == baseURL }) {
            selectedDeviceId = savedSelection.deviceId
        } else if let first = pairedDevices.first {
            selectedDeviceId = first.deviceId
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

    private var pendingClipboard: [String: String] = [:]

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
        pullClipboard(from: selectedDeviceId)
    }

    func pullClipboard(from serverId: String) {
        guard connectionStates[serverId] == .connected,
              let device = pairedDevices.first(where: { $0.deviceId == serverId }),
              let url = URL(string: "http://\(device.host):\(device.port)/clipboard/latest") else {
            logger.warn("pullClipboard: 目标设备未连接")
            return
        }
        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            if let error = error {
                self?.logger.error("剪贴板请求失败: \(error.localizedDescription)")
                return
            }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? NSDictionary,
                  let payload = json["payload"] as? String, !payload.isEmpty else { return }
            let hash = json["hash"] as? String ?? ""
            DispatchQueue.main.async {
                guard let self = self else { return }
                // Dedup: skip if same hash already received
                if hash == self.lastRemoteClipboardHash { return }
                // Protect local copy: don't overwrite if user just copied locally
                let now = Date()
                if now.timeIntervalSince(self.lastLocalCopyTime) < 2.0 { return }
                self.lastRemoteClipboardHash = hash
                self.clipboardContent = payload
                ClipboardService.shared.setClipboard(payload)
                self.logger.warn("剪贴板已同步 (\(payload.count) 字符)")
            }
        }.resume()
    }

    func sendClipboard(_ content: String) {
        lastLocalCopyTime = Date()
        for device in pairedDevices where device.platform.lowercased() == "windows" {
            if connectionStates[device.deviceId] == .connected,
               let socket = sockets[device.deviceId]?.socket {
                socket.emit("clipboard", ["payload": content])
                pendingClipboard.removeValue(forKey: device.deviceId)
                logger.warn("剪贴板已发送到 \(device.name) (\(content.count) 字符)")
            } else {
                pendingClipboard[device.deviceId] = content
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
                self.clipboardContent = json["payload"] as? String
                if let content = self.clipboardContent {
                    ClipboardService.shared.setClipboard(content)
                    self.logger.info("剪贴板已更新 (\(content.count) 字符)")
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
              let index = pairedDevices.firstIndex(where: {
                  $0.deviceId == device.deviceId && $0.platform.lowercased() == "windows"
              }) else { return }
        let changed = pairedDevices[index].host != device.host || pairedDevices[index].port != device.port
        if changed {
            pairedDevices[index].host = device.host
            pairedDevices[index].port = device.port
            pairedDevices[index].lastSeen = Date()
            saveDevices()
            if selectedDeviceId == device.deviceId { selectedDeviceId = device.deviceId }
        }
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
            saveDevices()
        }
        selectedDeviceId = device.deviceId
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
                if existing.socket.status == .disconnected && connectionStates[serverId] == .offline {
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

        socket.on("auth:ok") { [weak self] _, _ in
            guard let self = self else { return }
            self.setState(.connected, for: serverId)
            self.logger.info("设备已注册: \(self.deviceId), serverId=\(serverId)")
            if let pending = self.pendingClipboard.removeValue(forKey: serverId) {
                socket.emit("clipboard", ["payload": pending])
            }
            self.saveDevices()
            ClipboardService.shared.checkNow()
        }

        socket.on("clipboard") { [weak self] data, _ in
            guard let self = self,
                  let items = data as? [NSDictionary],
                  let msg = items.first else { return }
            let payload = msg["payload"] as? String ?? ""
            let hash = msg["hash"] as? String ?? ""
            if !payload.isEmpty && hash != self.lastRemoteClipboardHash {
                let now = Date()
                if now.timeIntervalSince(self.lastLocalCopyTime) > 2.0 {
                    self.lastRemoteClipboardHash = hash
                    ClipboardService.shared.setClipboard(payload)
                    self.clipboardContent = payload
                    self.logger.warn("剪贴板已同步 (\(payload.count) 字符)")
                }
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.logger.warn("socket.io 断开: \(serverId)")
            self?.setState(.reconnecting, for: serverId)
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
