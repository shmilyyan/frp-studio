import Foundation
import UIKit
import Network

class ConnectionManager: ObservableObject {
    @Published var pairedDevices: [PairedDevice] = []
    @Published var isScanning = false
    @Published var clipboardContent: String?
    @Published var isConnecting = false
    @Published var connectionError: String?

    var baseURL: String = "" {
        didSet {
            if !baseURL.isEmpty { startPolling() } else { stopPolling() }
        }
    }
    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var pollTimer: Timer?

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

        if let token = json["token"] as? String {
            logger.info("配对 token: \(token)")
        }
        if let deviceId = json["deviceId"] as? String {
            logger.info("目标设备 ID: \(deviceId)")
        }

        let targetId = json["deviceId"] as? String ?? host

        // Dedup: don't add the same device twice
        if pairedDevices.contains(where: { $0.deviceId == targetId }) {
            logger.info("设备已存在，跳过添加: \(targetId)")
        } else {
            let device = PairedDevice(
                deviceId: targetId,
                name: "Windows-\(host)",
                platform: "windows",
                isConnected: true
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
        logger.info("HTTP GET 剪贴板: \(url.absoluteString)")
        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            if let error = error {
                self?.logger.error("剪贴板请求失败: \(error.localizedDescription)")
                return
            }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let payload = json["payload"] as? String, !payload.isEmpty else {
                self?.logger.warn("剪贴板为空或解析失败")
                return
            }
            DispatchQueue.main.async {
                self?.clipboardContent = payload
                UIPasteboard.general.string = payload
                self?.logger.info("剪贴板已更新 (\(payload.count) 字符)")
            }
        }.resume()
    }

    func sendClipboard(_ content: String) {
        guard !baseURL.isEmpty else {
            logger.warn("sendClipboard: baseURL not set")
            return
        }
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
}
