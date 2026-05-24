import Foundation
import UIKit
import Network
import Security

class ConnectionManager: ObservableObject {
    @Published var pairedDevices: [PairedDevice] = []
    @Published var isScanning = false
    @Published var clipboardContent: String?
    @Published var isConnecting = false
    @Published var connectionError: String?

    var baseURL: String = "" {
        didSet {
            if !baseURL.isEmpty {
                startPolling()
                startHeartbeat()
                connectWebSocket()
            } else {
                stopPolling()
                stopHeartbeat()
            }
        }
    }
    private var webSocket: URLSessionWebSocketTask?
    private var webSocketTask: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var pollTimer: Timer?

    // Task 9: WebSocket reconnect + heartbeat
    private var reconnectAttempts = 0
    private let maxReconnectDelay: TimeInterval = 30
    private var heartbeatTimer: Timer?
    private var isWebSocketConnected = false
    private var lastRemoteClipboardHash: String = ""
    private var lastLocalCopyTime: Date = Date()
    private var currentDeviceId: String = ""
    private var needsRegistration = false

    // Task 10b: Device identity
    private var deviceId: String = ""
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
        logger.info("已加载 \(pairedDevices.count) 个已配对设备")
    }

    private func saveDevices() {
        if let data = try? JSONEncoder().encode(pairedDevices) {
            UserDefaults.standard.set(data, forKey: storageKey)
            logger.debug("设备列表已保存: \(pairedDevices.count) 个设备")
        }
    }

    private func loadDevices() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode([PairedDevice].self, from: data) else { return }
        pairedDevices = saved
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

        // Mark for registration on first WebSocket connection
        needsRegistration = true
        logger.info("将在 WebSocket 连接后向 \(host):\(port) 发送注册消息")

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
                UIPasteboard.general.string = payload
                self.logger.info("剪贴板已同步 (\(payload.count) 字符)")
            }
        }.resume()
    }

    func sendClipboard(_ content: String) {
        guard !baseURL.isEmpty else {
            logger.warn("sendClipboard: baseURL not set")
            return
        }
        lastLocalCopyTime = Date()
        let url = URL(string: "http://\(baseURL)/clipboard")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["payload": content]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        logger.info("HTTP POST 剪贴板: \(content.count) 字符")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                self?.logger.error("剪贴板发送失败: \(error.localizedDescription)")
            } else {
                self?.logger.info("剪贴板已发送")
            }
        }.resume()
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
                    UIPasteboard.general.string = content
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

    // MARK: - Task 9: WebSocket reconnect + heartbeat

    private func connectWebSocket() {
        guard !baseURL.isEmpty else { return }
        guard let wsURL = URL(string: "ws://\(baseURL)") else { return }
        logger.info("WebSocket 连接: \(wsURL.absoluteString)")
        webSocketTask = session.webSocketTask(with: wsURL)
        webSocketTask?.resume()
        receiveWSMessage()
    }

    private func receiveWSMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                self?.reconnectAttempts = 0
                if !(self?.isWebSocketConnected ?? false) {
                    self?.isWebSocketConnected = true
                    self?.updateDeviceConnectionStatus(true)
                    // Send registration on first successful connection
                    self?.sendRegisterIfNeeded()
                }
                switch message {
                case .string(let text):
                    self?.handleWSMessage(text)
                case .data(let data):
                    self?.logger.debug("WebSocket 收到二进制: \(data.count) bytes")
                @unknown default: break
                }
                self?.receiveWSMessage()
            case .failure(let error):
                self?.logger.error("WebSocket 断开: \(error.localizedDescription)")
                self?.isWebSocketConnected = false
                self?.updateDeviceConnectionStatus(false)
                self?.scheduleReconnect()
            }
        }
    }

    private func scheduleReconnect() {
        let delay = min(5.0 * pow(2.0, Double(reconnectAttempts)), maxReconnectDelay)
        reconnectAttempts += 1
        logger.info("WebSocket 重连: \(Int(delay))s 后 (第 \(reconnectAttempts) 次)")
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.connectWebSocket()
        }
    }

    private func handleWSMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        DispatchQueue.main.async {
            switch type {
            case "clipboard":
                let payload = json["payload"] as? String ?? ""
                let hash = json["hash"] as? String ?? ""
                if !payload.isEmpty && hash != self.lastRemoteClipboardHash {
                    let now = Date()
                    if now.timeIntervalSince(self.lastLocalCopyTime) > 2.0 {
                        self.lastRemoteClipboardHash = hash
                        UIPasteboard.general.string = payload
                        self.logger.info("远程剪贴板已同步 (\(payload.count) 字符)")
                    }
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

    private func startHeartbeat() {
        stopHeartbeat()
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    private func checkHealth() {
        guard !baseURL.isEmpty else { return }
        guard let url = URL(string: "http://\(baseURL)/health") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] _, response, error in
            DispatchQueue.main.async {
                if error == nil, let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 {
                    self?.updateDeviceConnectionStatus(true)
                } else {
                    self?.updateDeviceConnectionStatus(false)
                }
            }
        }.resume()
    }

    private func updateDeviceConnectionStatus(_ connected: Bool) {
        if let idx = pairedDevices.firstIndex(where: { $0.deviceId == currentDeviceId }) {
            pairedDevices[idx].isConnected = connected
            pairedDevices[idx].lastSeen = connected ? Date() : pairedDevices[idx].lastSeen
            saveDevices()
        }
    }

    // MARK: - Task 10b: Device identity + /pair/confirm

    private func ensureIdentity() {
        if let saved = UserDefaults.standard.data(forKey: identityKey),
           let dict = try? JSONSerialization.jsonObject(with: saved) as? [String: String],
           let savedDeviceId = dict["deviceId"] {
            deviceId = savedDeviceId
            logger.info("设备身份已加载: \(deviceId)")
            return
        }

        var randomBytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &randomBytes)
        deviceId = randomBytes.map { String(format: "%02x", $0) }.joined()

        let identity: [String: String] = ["deviceId": deviceId]
        if let data = try? JSONSerialization.data(withJSONObject: identity) {
            UserDefaults.standard.set(data, forKey: identityKey)
        }
        logger.info("新设备身份已生成: \(deviceId)")
    }

    private func sendRegisterIfNeeded() {
        guard needsRegistration, !deviceId.isEmpty else { return }
        needsRegistration = false

        let msg: [String: Any] = [
            "type": "register",
            "deviceId": deviceId,
            "deviceName": UIDevice.current.name,
            "platform": "ios"
        ]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
              let jsonStr = String(data: jsonData, encoding: .utf8) else { return }

        webSocketTask?.send(.string(jsonStr)) { [weak self] error in
            if let error = error {
                self?.logger.error("注册消息发送失败: \(error.localizedDescription)")
                self?.needsRegistration = true  // retry on next connection
            } else {
                self?.logger.info("设备注册消息已发送: \(self?.deviceId ?? "")")
            }
        }
    }
}
