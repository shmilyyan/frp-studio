import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared

    init() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        logger.info("HandoffApp 启动 v\(version)")
        // Request all permissions proactively on app launch
        requestPermissions()
        // Use strong ref — ConnectionManager is owned by App, no retain cycle
        let mgr = connectionManager
        ClipboardService.shared.onClipboardChanged = { text in
            mgr.sendClipboard(text)
        }
        ClipboardService.shared.startMonitoring()
    }

    private func requestPermissions() {
        // Bonjour browsing triggers local network permission dialog (iOS 14+)
        DiscoveryService.shared.startBrowsing()
        // Read pasteboard to trigger paste access if needed (iOS 16+)
        _ = UIPasteboard.general.string
        // Trigger local network permission by making a dummy connection attempt
        let dummyURL = URL(string: "http://127.0.0.1:19528/health")!
        URLSession.shared.dataTask(with: dummyURL) { _, _, _ in }.resume()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
                .environmentObject(discoveryService)
                .environmentObject(logger)
        }
    }
}
