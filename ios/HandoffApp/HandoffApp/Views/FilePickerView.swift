import SwiftUI

struct FilePickerView: UIViewControllerRepresentable {
    let onFileSelected: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        // Use legacy documentTypes API for iOS 26 compatibility
        let picker = UIDocumentPickerViewController(documentTypes: ["public.item"], in: .import)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFileSelected: onFileSelected)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onFileSelected: (URL) -> Void

        init(onFileSelected: @escaping (URL) -> Void) {
            self.onFileSelected = onFileSelected
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            // Copy to temp to avoid security-scoped resource expiry during upload
            let tempURL = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathComponent(url.lastPathComponent)
            try? FileManager.default.createDirectory(at: tempURL.deletingLastPathComponent(),
                                                      withIntermediateDirectories: true)
            do {
                if url.startAccessingSecurityScopedResource() {
                    defer { url.stopAccessingSecurityScopedResource() }
                    try FileManager.default.copyItem(at: url, to: tempURL)
                } else {
                    try FileManager.default.copyItem(at: url, to: tempURL)
                }
                onFileSelected(tempURL)
            } catch {
                // Fallback: try direct URL
                _ = url.startAccessingSecurityScopedResource()
                onFileSelected(url)
            }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            // User cancelled — no action needed
        }
    }
}
