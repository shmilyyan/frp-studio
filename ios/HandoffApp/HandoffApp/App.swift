import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared

    init() {
        logger.info("HandoffApp 启动 v\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")")
        DiscoveryService.shared.startBrowsing()
        // Use strong ref — ConnectionManager is owned by App, no retain cycle
        let mgr = connectionManager
        ClipboardService.shared.onClipboardChanged = { text in
            mgr.sendClipboard(text)
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
