import UIKit
import CryptoKit

class ClipboardService: NSObject, ObservableObject {
    static let shared = ClipboardService()
    static let clipboardChangedNotification = Notification.Name("ClipboardChanged")

    private var lastChangeCount: Int = 0
    private var lastSentHash: String = ""
    private var pollTimer: Timer?

    override private init() {
        super.init()
        lastChangeCount = UIPasteboard.general.changeCount
    }

    private var checkCount = 0
    private let logger = DebugLogger.shared

    func startMonitoring(interval: TimeInterval = 2.0) {
        stopMonitoring()
        checkCount = 0
        logger.warn("剪贴板监听已启动 (间隔 \(interval)s)")
        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.checkForChanges()
        }
    }

    func stopMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func checkNow() {
        checkForChanges()
    }

    private func checkForChanges() {
        let current = UIPasteboard.general.changeCount
        guard current != lastChangeCount else {
            checkCount += 1
            if checkCount % 30 == 0 {
                logger.debug("剪贴板监听中... (已检查 \(checkCount) 次, cc=\(current))")
            }
            return
        }
        checkCount = 0
        lastChangeCount = current

        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        let hash = sha256(text)
        guard hash != lastSentHash else { return }

        lastSentHash = hash
        logger.warn("剪贴板变化检测到 (\(text.count) 字符), 发送中")
        NotificationCenter.default.post(name: Self.clipboardChangedNotification, object: nil, userInfo: ["text": text])
    }

    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashed = SHA256.hash(data: inputData)
        return hashed.compactMap { String(format: "%02x", $0) }.joined()
    }

    func getClipboard() -> String? {
        return UIPasteboard.general.string
    }

    func setClipboard(_ text: String) {
        UIPasteboard.general.string = text
        lastSentHash = sha256(text)
        lastChangeCount = UIPasteboard.general.changeCount  // prevent re-detection loop
    }
}
