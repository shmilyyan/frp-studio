import Foundation
import UIKit
import Network

class ConnectionManager: ObservableObject {
    @Published var pairedDevices: [PairedDevice] = []
    @Published var isScanning = false
    @Published var clipboardContent: String?

    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)

    func startDiscovery() {
        isScanning = true
    }

    @Published var isConnecting = false
    @Published var connectionError: String?

    func connect(to host: String, port: UInt16) {
        isConnecting = true
        connectionError = nil
        let url = URL(string: "ws://\(host):\(port)")!
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        receiveMessage()
        // Mark as connected after a brief delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.isConnecting = false
        }
    }

    func handleQRCode(_ code: String) -> Bool {
        guard let data = code.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let host = json["host"] as? String,
              let port = json["port"] as? Int else {
            connectionError = "无效的二维码内容"
            return false
        }

        connect(to: host, port: UInt16(port))
        return true
    }

    func pullClipboard() {
        guard let ws = webSocket else { return }
        let message = URLSessionWebSocketTask.Message.string("{\"type\":\"clipboard:latest\"}")
        ws.send(message) { _ in }
    }

    func sendClipboard(_ content: String) {
        guard let ws = webSocket else { return }
        let escaped = content.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let msg = "{\"type\":\"clipboard\",\"payload\":\"\(escaped)\",\"timestamp\":\(Date().timeIntervalSince1970)}"
        ws.send(.string(msg)) { _ in }
    }

    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleMessage(text)
                case .data(let data):
                    self?.handleBinary(data)
                @unknown default: break
                }
                self?.receiveMessage()
            case .failure:
                break
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        DispatchQueue.main.async {
            switch type {
            case "clipboard":
                self.clipboardContent = json["payload"] as? String
                if let content = self.clipboardContent {
                    UIPasteboard.general.string = content
                }
            case "file:offer":
                break
            default:
                break
            }
        }
    }

    private func handleBinary(_ data: Data) {
        // File chunk handling
    }
}
