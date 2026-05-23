import SwiftUI
import AVFoundation

struct PairingView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var isScanning = true

    var body: some View {
        NavigationView {
            VStack {
                Text("扫描 FRP Studio 上显示的二维码")
                    .foregroundColor(.secondary)
                    .padding()

                CameraPreview(isScanning: $isScanning) { code in
                    connectionManager.handleQRCode(code)
                    dismiss()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("配对设备")
            .toolbar {
                Button("取消") { dismiss() }
            }
        }
    }
}

struct CameraPreview: UIViewRepresentable {
    @Binding var isScanning: Bool
    let onCodeScanned: (String) -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        // Camera implementation would go here using AVCaptureSession
        // For now this is a placeholder
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
