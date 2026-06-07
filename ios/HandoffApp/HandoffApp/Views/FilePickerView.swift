import SwiftUI

struct FilePickerView: UIViewControllerRepresentable {
    let onFileSelected: (URL) -> Void

    init(onFileSelected: @escaping (URL) -> Void) {
        self.onFileSelected = onFileSelected
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
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
            let tempBase = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
            try? FileManager.default.createDirectory(at: tempBase, withIntermediateDirectories: true)
            let tempURL = tempBase.appendingPathComponent(url.lastPathComponent)

            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            try? FileManager.default.copyItem(at: url, to: tempURL)
            onFileSelected(tempURL)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {}
    }
}
