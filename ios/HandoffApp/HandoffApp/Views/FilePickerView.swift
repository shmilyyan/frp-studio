import SwiftUI

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
            picker = UIDocumentPickerViewController(documentTypes: ["public.directory"], in: .open)
        } else {
            picker = UIDocumentPickerViewController(documentTypes: ["public.item"], in: .import)
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
            let tempBase = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
            try? FileManager.default.createDirectory(at: tempBase, withIntermediateDirectories: true)
            let tempURL = tempBase.appendingPathComponent(url.lastPathComponent)

            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }

            if pickFolders {
                let coordinator = NSFileCoordinator()
                var coordError: NSError?
                coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { readURL in
                    try? FileManager.default.copyItem(at: readURL, to: tempURL)
                    onFileSelected(tempURL)
                }
            } else {
                try? FileManager.default.copyItem(at: url, to: tempURL)
                onFileSelected(tempURL)
            }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {}
    }
}
