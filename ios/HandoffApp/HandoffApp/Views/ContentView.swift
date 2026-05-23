import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showPairing = false

    var body: some View {
        NavigationView {
            List {
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
                Button(action: { showPairing = true }) {
                    Image(systemName: "qrcode.viewfinder")
                }
            }
            .sheet(isPresented: $showPairing) {
                PairingView()
            }
        }
    }
}
