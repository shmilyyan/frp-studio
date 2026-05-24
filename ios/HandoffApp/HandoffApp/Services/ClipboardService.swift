import UIKit
import CryptoKit

class ClipboardService: NSObject, ObservableObject {
    static let shared = ClipboardService()

    private var lastChangeCount: Int = 0
    private var lastSentHash: String = ""
    private var pollTimer: Timer?
    var onClipboardChanged: ((String) -> Void)?

    override private init() {
        super.init()
        lastChangeCount = UIPasteboard.general.changeCount
    }

    func startMonitoring(interval: TimeInterval = 2.0) {
        stopMonitoring()
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
        guard current != lastChangeCount else { return }
        lastChangeCount = current

        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        let hash = sha256(text)
        guard hash != lastSentHash else { return }

        lastSentHash = hash
        onClipboardChanged?(text)
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
    }
}
