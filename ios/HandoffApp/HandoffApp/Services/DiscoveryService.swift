import Foundation

class DiscoveryService: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    static let shared = DiscoveryService()

    @Published var discoveredDevices: [DiscoveredDevice] = []

    private var browser: NetServiceBrowser?
    private var resolvingServices: Set<NetService> = []
    private var retryCount = 0
    private let maxRetries = 5
    private let logger = DebugLogger.shared

    override private init() {
        super.init()
    }

    func startBrowsing() {
        logger.info("Bonjour 浏览器启动: _handoff._tcp")
        retryCount = 0
        browser?.stop()
        browser = NetServiceBrowser()
        browser?.delegate = self
        // Use empty domain for default browse domains; no trailing dot on type
        browser?.searchForServices(ofType: "_handoff._tcp", inDomain: "")
    }

    func stopBrowsing() {
        browser?.stop()
        browser = nil
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        logger.info("发现服务: \(service.name)")
        service.delegate = self
        resolvingServices.insert(service)
        service.resolve(withTimeout: 5)
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        discoveredDevices.removeAll { $0.name == service.name }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        logger.warn("Bonjour 搜索失败 (重试 \(retryCount + 1)/\(maxRetries)): \(errorDict.keys)")
        retryCount += 1
        if retryCount <= maxRetries {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                self?.browser?.searchForServices(ofType: "_handoff._tcp", inDomain: "")
            }
        }
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        logger.warn("服务解析失败: \(sender.name) — \(errorDict.keys)")
        resolvingServices.remove(sender)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        defer { resolvingServices.remove(sender) }
        guard let hostName = sender.hostName else { return }
        let port = sender.port

        // Extract IPv4 address from resolved addresses (prefer over hostName for connectivity)
        var ipString = hostName
        if let addresses = sender.addresses {
            for case let addr as NSData in addresses {
                var storage = sockaddr_storage()
                addr.getBytes(&storage, length: MemoryLayout<sockaddr_storage>.size)
                if storage.ss_family == sa_family_t(AF_INET) {
                    let addr4 = withUnsafePointer(to: &storage) {
                        $0.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
                    }
                    var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                    var addr4Copy = addr4
                    if let ip = inet_ntop(AF_INET, &addr4Copy, &buffer, socklen_t(INET_ADDRSTRLEN)) {
                        ipString = String(cString: ip)
                        break
                    }
                }
            }
        }

        // Manually parse TXT record to avoid iOS 26 ObjC→Swift Dictionary bridging crash
        let txtRecord = sender.txtRecordData() ?? Data()
        var info: [String: String] = [:]
        var offset = 0
        let bytes = [UInt8](txtRecord)
        while offset < bytes.count {
            let len = Int(bytes[offset])
            offset += 1
            guard offset + len <= bytes.count, len > 0 else { break }
            let entry = Data(bytes[offset..<offset + len])
            if let entryStr = String(data: entry, encoding: .utf8) {
                if let eqIdx = entryStr.firstIndex(of: "=") {
                    let key = String(entryStr[..<eqIdx])
                    let value = String(entryStr[entryStr.index(after: eqIdx)...])
                    info[key] = value
                }
            }
            offset += len
        }
        let device = DiscoveredDevice(
            name: info["deviceName"] ?? sender.name,
            host: ipString,
            port: UInt16(port),
            platform: info["platform"] ?? "unknown",
            version: info["version"] ?? "?"
        )
        if !discoveredDevices.contains(where: { $0.host == ipString && $0.port == port }) {
            DispatchQueue.main.async { [weak self] in
                self?.discoveredDevices.append(device)
                self?.logger.info("设备已发现: \(device.name) @ \(ipString):\(port)")
            }
        }
    }
}

struct DiscoveredDevice: Identifiable {
    var id: String { "\(host):\(port)" }
    let name: String
    let host: String
    let port: UInt16
    let platform: String
    let version: String
}
