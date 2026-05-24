import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared

    init() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        logger.info("HandoffApp 启动 v\(version)")
        requestPermissions()
        ClipboardService.shared.startMonitoring()
    }

    private func requestPermissions() {
        // Bonjour browsing triggers local network permission dialog (iOS 14+)
        DiscoveryService.shared.startBrowsing()
        // Read pasteboard to trigger paste access if needed (iOS 16+)
        _ = UIPasteboard.general.string
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
