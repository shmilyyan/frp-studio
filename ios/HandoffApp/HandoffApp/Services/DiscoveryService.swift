import Foundation

class DiscoveryService: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    var onDeviceFound: ((String, UInt16, [String: String]) -> Void)?

    private var browser: NetServiceBrowser?

    func startBrowsing() {
        browser = NetServiceBrowser()
        browser?.delegate = self
        browser?.searchForServices(ofType: "_handoff._tcp.", inDomain: "local.")
    }

    func stopBrowsing() {
        browser?.stop()
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        service.resolve(withTimeout: 5)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let hostName = sender.hostName else { return }
        let port = sender.port
        let txtData = NetService.dictionary(fromTXTRecord: sender.txtRecordData() ?? Data())
        var info: [String: String] = [:]
        for (key, value) in txtData {
            info[key] = String(data: value, encoding: .utf8)
        }
        onDeviceFound?(hostName, UInt16(port), info)
    }
}
