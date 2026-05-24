import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared

    init() {
        logger.info("HandoffApp 启动 v\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")")
        DiscoveryService.shared.startBrowsing()
        // Start clipboard monitoring at app level so it works without switching tabs
        ClipboardService.shared.onClipboardChanged = { [weak connectionManager] text in
            connectionManager?.sendClipboard(text)
        }
        ClipboardService.shared.startMonitoring()
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
