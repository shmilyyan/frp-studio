import Foundation
import UIKit

class AdvertiseService: NSObject, ObservableObject, NetServiceDelegate {
    static let shared = AdvertiseService()

    private var netService: NetService?
    private let logger = DebugLogger.shared

    override private init() {
        super.init()
    }

    func start() {
        stop()

        let deviceName = UIDevice.current.name

        // Get deviceId from UserDefaults (same key as ConnectionManager)
        let identityKey = "handoff_identity"
        var deviceId = ""
        if let saved = UserDefaults.standard.data(forKey: identityKey),
           let dict = try? JSONSerialization.jsonObject(with: saved) as? [String: String],
           let savedId = dict["deviceId"] {
            deviceId = savedId
        }

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"

        let txtDict: [String: Data] = [
            "deviceId": deviceId.data(using: .utf8) ?? Data(),
            "platform": "ios".data(using: .utf8) ?? Data(),
            "version": version.data(using: .utf8) ?? Data()
        ]

        netService = NetService(
            domain: "local.",
            type: "_handoff._tcp.",
            name: deviceName,
            port: 0
        )
        netService?.delegate = self
        netService?.setTXTRecord(NetService.data(fromTXTRecord: txtDict))
        netService?.publish()

        logger.warn("Bonjour 宣告已启动: \(deviceName)")
    }

    func stop() {
        netService?.stop()
        netService = nil
        logger.info("Bonjour 宣告已停止")
    }

    // MARK: - NetServiceDelegate

    func netServiceDidPublish(_ sender: NetService) {
        logger.info("Bonjour 宣告成功: \(sender.name)")
    }

    func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
        logger.warn("Bonjour 宣告失败: \(errorDict)")
    }

    func netServiceDidStop(_ sender: NetService) {
        logger.info("Bonjour 宣告已停止")
    }
}
