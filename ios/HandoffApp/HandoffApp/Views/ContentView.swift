import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @EnvironmentObject var logger: DebugLogger
    @State private var showPairing = false
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Tab 0: Main
            NavigationView {
                List {
                    if let error = connectionManager.connectionError {
                        Section {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.red)
                                Text(error)
                                    .foregroundColor(.red)
                                    .font(.subheadline)
                            }
                        }
                    }

                    Section("已配对设备") {
                        if connectionManager.pairedDevices.isEmpty {
                            Text("暂无配对设备")
                                .foregroundColor(.secondary)
                        }
                        ForEach(connectionManager.pairedDevices) { device in
                            HStack {
                                Image(systemName: "desktopcomputer")
                                VStack(alignment: .leading) {
                                    Text(device.name)
                                    Text(device.status)
                                        .font(.caption)
                                        .foregroundColor(device.isConnected ? .green : .secondary)
                                }
                            }
                        }
                    }

                    Section("快速操作") {
                        Button(action: { connectionManager.pullClipboard() }) {
                            Label("获取 Windows 剪贴板", systemImage: "doc.on.clipboard")
                        }
                    }
                }
                .navigationTitle("Handoff")
                .toolbar {
                    Button(action: {
                        logger.info("打开扫码配对")
                        showPairing = true
                    }) {
                        Image(systemName: "qrcode.viewfinder")
                    }
                }
                .sheet(isPresented: $showPairing) {
                    PairingView()
                }
            }
            .tabItem {
                Image(systemName: "rectangle.connected.to.line.below")
                Text("设备")
            }
            .tag(0)

            // Tab 1: Logs (only when debug mode on)
            if logger.isDebugMode {
                NavigationView {
                    LogView()
                }
                .tabItem {
                    Image(systemName: "terminal.fill")
                    Text("日志")
                }
                .tag(1)
            }
        }
        .onChange(of: showPairing) { isShowing in
            if !isShowing {
                // modal dismissed, refresh device list
                logger.debug("配对弹窗关闭")
            }
        }
    }
}
