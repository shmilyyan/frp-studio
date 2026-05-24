import Foundation

struct PairedDevice: Identifiable, Codable {
    var id: String { deviceId }
    let deviceId: String
    var name: String
    let platform: String
    var isConnected: Bool = false
    var lastSeen: Date = Date()
    var host: String = ""
    var port: UInt16 = 19528

    var status: String {
        isConnected ? "在线" : "离线"
    }
}
