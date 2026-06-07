import SwiftUI
import UniformTypeIdentifiers

struct FilePickerView: UIViewControllerRepresentable {
    let onFileSelected: (URL) -> Void
    let pickFolders: Bool

    init(pickFolders: Bool = false, onFileSelected: @escaping (URL) -> Void) {
        self.pickFolders = pickFolders
        self.onFileSelected = onFileSelected
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker: UIDocumentPickerViewController
        if pickFolders {
            // iOS 26: use asCopy=true to get a local copy, avoiding remote file provider issues
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: true)
        } else {
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item])
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFileSelected: onFileSelected, pickFolders: pickFolders)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onFileSelected: (URL) -> Void
        let pickFolders: Bool

        init(onFileSelected: @escaping (URL) -> Void, pickFolders: Bool) {
            self.onFileSelected = onFileSelected
            self.pickFolders = pickFolders
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            guard url.startAccessingSecurityScopedResource() else {
                onFileSelected(url)
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }

            if pickFolders {
                // iOS 26: Use NSFileCoordinator to prevent permission loss during folder operations
                let coordinator = NSFileCoordinator()
                var coordError: NSError?
                coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { readURL in
                    // Copy folder to temp for safe compression
                    let tempBase = FileManager.default.temporaryDirectory
                        .appendingPathComponent(UUID().uuidString)
                    try? FileManager.default.createDirectory(at: tempBase, withIntermediateDirectories: true)
                    let tempURL = tempBase.appendingPathComponent(url.lastPathComponent)
                    try? FileManager.default.copyItem(at: readURL, to: tempURL)
                    onFileSelected(tempURL)
                }
                if let error = coordError {
                    DebugLogger.shared.error("文件协调器错误: \(error.localizedDescription)")
                }
            } else {
                let tempBase = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                try? FileManager.default.createDirectory(at: tempBase, withIntermediateDirectories: true)
                let tempURL = tempBase.appendingPathComponent(url.lastPathComponent)
                try? FileManager.default.copyItem(at: url, to: tempURL)
                onFileSelected(tempURL)
            }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {}
    }
}
