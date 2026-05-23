import SwiftUI

@main
struct HandoffApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    @StateObject private var logger = DebugLogger.shared

    init() {
        logger.info("HandoffApp 启动")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
                .environmentObject(logger)
                .onAppear {
                    logger.info("开始设备发现")
                    connectionManager.startDiscovery()
                }
        }
    }
}
