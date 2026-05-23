import UIKit

class ClipboardService {
    static let shared = ClipboardService()

    func getClipboard() -> String? {
        return UIPasteboard.general.string
    }

    func setClipboard(_ text: String) {
        UIPasteboard.general.string = text
    }
}
