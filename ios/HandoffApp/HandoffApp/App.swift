import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var discoveryService = DiscoveryService.shared
    @StateObject private var logger = DebugLogger.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        logger.info("HandoffApp 启动 v\(version)")
        // Services deferred to ContentView.onAppear to avoid init-time races
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
                .environmentObject(discoveryService)
                .environmentObject(logger)
        }
//        .onChange(of: scenePhase) { phase in
//            switch phase {
//            case .active:
//                AdvertiseService.shared.start()
//                DiscoveryService.shared.startBrowsing()
//            case .background, .inactive:
//                AdvertiseService.shared.stop()
//            @unknown default:
//                break
//            }
//        }
    }
}
