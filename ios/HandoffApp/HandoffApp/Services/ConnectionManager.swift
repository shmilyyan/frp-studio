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
    @Published var uploadProgress: Double = 0
    @Published var isUploading = false

    var baseURL: String = "" {
        didSet {
            if !baseURL.isEmpty {
                _ = KeychainHelper.save(key: "handoff_base_url", value: baseURL)
                startPolling()
                let parts = baseURL.split(separator: ":")
                if parts.count == 2, let portNum = Int(parts[1]) {
                    connectSocketIO(host: String(parts[0]), port: portNum)
                }
            } else {
                KeychainHelper.delete(key: "handoff_base_url")
                stopPolling()
                socket?.disconnect()
                socket = nil
            }
        }
    }
    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var pollTimer: Timer?
    private var manager: SocketManager?
    private var socket: SocketIOClient?

    private var lastRemoteClipboardHash: String = ""
    private var lastLocalCopyTime: Date = Date()
    private var currentDeviceId: String = ""

    // Task 10b: Device identity
    private(set) var deviceId: String = ""
    private let identityKey = "handoff_identity"

    func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.pullClipboard()
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
        // Restore previous connection (Keychain first, then migrate UserDefaults)
        if let saved = KeychainHelper.read(key: "handoff_base_url"), !saved.isEmpty {
            baseURL = saved
            logger.warn("已恢复连接 (Keychain): \(saved)")
        } else if let legacyURL = UserDefaults.standard.string(forKey: "handoff_baseURL"), !legacyURL.isEmpty {
            baseURL = legacyURL
            _ = KeychainHelper.save(key: "handoff_base_url", value: legacyURL)
            UserDefaults.standard.removeObject(forKey: "handoff_baseURL")
            logger.warn("连接信息已迁移到 Keychain: \(legacyURL)")
        }
        logger.info("已加载 \(pairedDevices.count) 个已配对设备")
        // Observe clipboard changes via NotificationCenter (avoids @StateObject capture issues)
        NotificationCenter.default.addObserver(forName: ClipboardService.clipboardChangedNotification, object: nil, queue: .main) { [weak self] notification in
            if let text = notification.userInfo?["text"] as? String {
                self?.sendClipboard(text)
            }
        }
    }

    private var pendingClipboard: String?

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
        // Migrate UserDefaults legacy data
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let saved = try? JSONDecoder().decode([PairedDevice].self, from: data) {
            pairedDevices = saved
            // Migrate to Keychain
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

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            connectionError = "二维码内容不是有效的 JSON"
            logger.error("JSON 解析失败")
            return false
        }

        logger.debug("解析 JSON 成功: \(json.keys.joined(separator: ", "))")

        guard let host = json["host"] as? String else {
            connectionError = "二维码缺少 host 字段"
            logger.error("JSON 缺少 host, 可用字段: \(json.keys.joined(separator: ", "))")
            return false
        }

        guard let port = json["port"] as? Int else {
            connectionError = "二维码缺少 port 字段"
            logger.error("JSON 缺少 port")
            return false
        }

        logger.info("QR 解析成功: host=\(host), port=\(port)")

        baseURL = "\(host):\(port)"
        logger.info("baseURL 已设置: \(baseURL)")

        let serverDeviceId = json["deviceId"] as? String ?? host
        currentDeviceId = serverDeviceId

        // Dedup: don't add the same device twice
        if pairedDevices.contains(where: { $0.deviceId == serverDeviceId }) {
            logger.info("设备已存在，跳过添加: \(serverDeviceId)")
        } else {
            let device = PairedDevice(
                deviceId: serverDeviceId,
                name: "Windows-\(host)",
                platform: "windows",
                isConnected: true,
                host: host,
                port: UInt16(port)
            )
            pairedDevices.append(device)
            saveDevices()
            logger.info("设备已添加到列表: \(device.name)")
        }

        return true
    }

    func pullClipboard() {
        guard !baseURL.isEmpty else {
            logger.warn("pullClipboard: baseURL not set")
            return
        }
        let url = URL(string: "http://\(baseURL)/clipboard/latest")!
        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            if let error = error {
                self?.logger.error("剪贴板请求失败: \(error.localizedDescription)")
                return
            }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
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
        if !baseURL.isEmpty && socket?.status == .connected {
            socket?.emit("clipboard", ["payload": content])
            pendingClipboard = nil
            logger.warn("剪贴板已发送 (\(content.count) 字符)")
        } else {
            // Cache regardless of why — no URL, no socket, or not connected
            pendingClipboard = content
            let reason = baseURL.isEmpty ? "baseURL 为空" : "socket 未连接"
            logger.warn("剪贴板已缓存 (\(content.count) 字符), \(reason)")
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
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
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
        // 1. 优先从 Keychain 读取（卸载重装后保持不变）
        if let savedId = KeychainHelper.read(key: "device_identity") {
            deviceId = savedId
            logger.info("设备身份已加载 (Keychain): \(deviceId)")
            return
        }

        // 2. 兼容旧数据：从 UserDefaults 迁移到 Keychain
        if let saved = UserDefaults.standard.data(forKey: identityKey),
           let dict = try? JSONSerialization.jsonObject(with: saved) as? [String: String],
           let savedDeviceId = dict["deviceId"] {
            deviceId = savedDeviceId
            _ = KeychainHelper.save(key: "device_identity", value: deviceId)
            UserDefaults.standard.removeObject(forKey: identityKey)
            logger.info("设备身份已迁移到 Keychain: \(deviceId)")
            return
        }

        // 3. 全新生成
        var randomBytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &randomBytes)
        deviceId = randomBytes.map { String(format: "%02x", $0) }.joined()
        _ = KeychainHelper.save(key: "device_identity", value: deviceId)
        logger.info("新设备身份已生成 (Keychain): \(deviceId)")
    }

    func connectSocketIO(host: String, port: Int) {
        guard let url = URL(string: "http://\(host):\(port)") else { return }
        manager = SocketManager(socketURL: url, config: [
            .log(true),
            .reconnects(true),
            .reconnectAttempts(-1),
            .reconnectWait(1),
            .reconnectWaitMax(15),
            .extraHeaders(["User-Agent": "Handoff-iOS"])
        ])
        socket = manager?.defaultSocket

        socket?.on(clientEvent: .connect) { [weak self] data, ack in
            self?.logger.warn("socket.io 已连接")
            _ = KeychainHelper.save(key: "handoff_last_active", value: self?.baseURL ?? "")
            self?.connectionError = nil
            // Auth with device identity
            self?.socket?.emit("auth", [
                "deviceId": self?.deviceId ?? "",
                "deviceName": UIDevice.current.name,
                "platform": "ios"
            ])
            // Flush any pending clipboard content first
            if let pending = self?.pendingClipboard {
                self?.socket?.emit("clipboard", ["payload": pending])
                self?.logger.warn("缓存的剪贴板已发送 (\(pending.count) 字符)")
                self?.pendingClipboard = nil
            }
            // Check clipboard on reconnect (may have changed while disconnected)
            ClipboardService.shared.checkNow()
        }

        socket?.on("auth:ok") { [weak self] data, ack in
            self?.logger.info("设备已注册: \(self?.deviceId ?? "")")
            // Update paired device connection status
            if let idx = self?.pairedDevices.firstIndex(where: { $0.deviceId == self?.currentDeviceId }) {
                self?.pairedDevices[idx].isConnected = true
                self?.pairedDevices[idx].lastSeen = Date()
                self?.saveDevices()
            }
        }

        socket?.on("clipboard") { [weak self] data, ack in
            guard let self = self,
                  let items = data as? [[String: Any]],
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

        socket?.on(clientEvent: .disconnect) { [weak self] data, ack in
            self?.logger.warn("socket.io 断开")
            if let idx = self?.pairedDevices.firstIndex(where: { $0.deviceId == self?.currentDeviceId }) {
                self?.pairedDevices[idx].isConnected = false
                self?.saveDevices()
            }
        }

        socket?.on(clientEvent: .error) { [weak self] data, ack in
            // Log but don't surface — socket.io will auto-reconnect
            self?.logger.warn("socket.io 连接中 (\(host):\(port)): \(data)")
        }

        logger.warn("正在连接 socket.io: \(host):\(port)")
        socket?.connect()
    }

    func reconnect() {
        logger.warn("手动重连触发")
        socket?.disconnect()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.socket?.connect()
            DiscoveryService.shared.startBrowsing()
            ClipboardService.shared.checkNow()
        }
    }

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

        let observation = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
            DispatchQueue.main.async {
                self?.uploadProgress = progress.fractionCompleted
            }
        }

        task.resume()
        logger.warn("正在上传: \(filename) (\(fileData.count) bytes)")
    }
}
