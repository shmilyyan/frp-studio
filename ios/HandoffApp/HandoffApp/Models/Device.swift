import Foundation

enum DeviceConnectionState: String {
    case connecting
    case connected
    case reconnecting
    case offline

    var label: String {
        switch self {
        case .connecting: return "连接中"
        case .connected: return "在线"
        case .reconnecting: return "重连中"
        case .offline: return "离线"
        }
    }
}

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

    init(deviceId: String, name: String, platform: String, isConnected: Bool = false,
         lastSeen: Date = Date(), host: String = "", port: UInt16 = 19528) {
        self.deviceId = deviceId
        self.name = name
        self.platform = platform
        self.isConnected = isConnected
        self.lastSeen = lastSeen
        self.host = host
        self.port = port
    }

    private enum CodingKeys: String, CodingKey {
        case deviceId, name, platform, isConnected, lastSeen, host, port
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try values.decode(String.self, forKey: .deviceId)
        name = try values.decode(String.self, forKey: .name)
        platform = try values.decode(String.self, forKey: .platform)
        isConnected = try values.decodeIfPresent(Bool.self, forKey: .isConnected) ?? false
        lastSeen = try values.decodeIfPresent(Date.self, forKey: .lastSeen) ?? Date()
        host = try values.decodeIfPresent(String.self, forKey: .host) ?? ""
        port = try values.decodeIfPresent(UInt16.self, forKey: .port) ?? 19528
    }
}
