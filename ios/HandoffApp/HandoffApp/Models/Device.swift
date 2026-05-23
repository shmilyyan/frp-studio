import Foundation

struct PairedDevice: Identifiable, Codable {
    var id: String { deviceId }
    let deviceId: String
    var name: String
    let platform: String
    var isConnected: Bool = false

    var status: String {
        isConnected ? "在线" : "离线"
    }
}
