import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @EnvironmentObject var discoveryService: DiscoveryService
    @EnvironmentObject var logger: DebugLogger
    @State private var showPairing = false
    @State private var showLogs = false

    var body: some View {
        NavigationView {
            List {
                // Connection status
                Section("连接状态") {
                    HStack {
                        Circle()
                            .fill(connectionManager.baseURL.isEmpty ? Color.gray : Color.green)
                            .frame(width: 10, height: 10)
                        Text(connectionManager.baseURL.isEmpty ? "未配对" : "已配对: \(connectionManager.baseURL)")
                            .font(.subheadline)
                    }
                    if let error = connectionManager.connectionError {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.red)
                            Text(error).foregroundColor(.red).font(.caption)
                        }
                    }
                }

                // Discovered devices
                Section("发现的设备") {
                    if discoveryService.discoveredDevices.isEmpty {
                        Text("正在搜索...").foregroundColor(.secondary)
                    }
                    ForEach(discoveryService.discoveredDevices) { device in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(device.name).font(.subheadline)
                                Text("\(device.host):\(device.port)").font(.caption).foregroundColor(.secondary)
                            }
                            Spacer()
                            Button("连接") {
                                connectionManager.baseURL = "\(device.host):\(device.port)"
                                logger.info("手动连接设备: \(device.name)")
                            }
                        }
                    }
                }

                // Paired devices
                Section("已配对设备") {
                    if connectionManager.pairedDevices.isEmpty {
                        Text("暂无配对设备").foregroundColor(.secondary)
                    }
                    ForEach(connectionManager.pairedDevices) { device in
                        HStack {
                            Image(systemName: "desktopcomputer")
                            VStack(alignment: .leading) {
                                Text(device.name)
                                Text(device.isConnected ? "在线" : "离线")
                                    .font(.caption)
                                    .foregroundColor(device.isConnected ? .green : .secondary)
                            }
                        }
                    }
                }

                // Clipboard test
                Section("剪贴板测试") {
                    Button(action: { connectionManager.pullClipboard() }) {
                        Label("获取 Windows 剪贴板", systemImage: "arrow.down.doc")
                    }
                    .disabled(connectionManager.baseURL.isEmpty)

                    Button(action: {
                        if let text = UIPasteboard.general.string, !text.isEmpty {
                            connectionManager.sendClipboard(text)
                        } else {
                            logger.warn("iOS 剪贴板为空")
                        }
                    }) {
                        Label("发送 iOS 剪贴板", systemImage: "arrow.up.doc")
                    }
                    .disabled(connectionManager.baseURL.isEmpty)

                    if let content = connectionManager.clipboardContent, !content.isEmpty {
                        Text("最新剪贴板: \(content.prefix(100))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .onAppear {
                ClipboardService.shared.onClipboardChanged = { text in
                    connectionManager.sendClipboard(text)
                }
                ClipboardService.shared.startMonitoring()
            }
            .navigationTitle("Handoff")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button(action: { showLogs = true }) {
                            Image(systemName: "terminal")
                        }
                        Button(action: {
                            logger.info("打开扫码配对")
                            showPairing = true
                        }) {
                            Image(systemName: "qrcode.viewfinder")
                        }
                    }
                }
            }
            .sheet(isPresented: $showPairing) { PairingView() }
            .sheet(isPresented: $showLogs) {
                NavigationView {
                    LogView()
                        .toolbar {
                            Button("关闭") { showLogs = false }
                        }
                }
            }
        }
    }
}
