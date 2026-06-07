import SwiftUI

struct FilePickerView: UIViewControllerRepresentable {
    let onFilesSelected: ([URL]) -> Void
    let multipleSelection: Bool

    init(multipleSelection: Bool = false, onFilesSelected: @escaping ([URL]) -> Void) {
        self.multipleSelection = multipleSelection
        self.onFilesSelected = onFilesSelected
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(documentTypes: ["public.item"], in: .import)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = multipleSelection
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFilesSelected: onFilesSelected)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onFilesSelected: ([URL]) -> Void

        init(onFilesSelected: @escaping ([URL]) -> Void) {
            self.onFilesSelected = onFilesSelected
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            var tempURLs: [URL] = []
            for url in urls {
                let tempBase = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                try? FileManager.default.createDirectory(at: tempBase, withIntermediateDirectories: true)
                let tempURL = tempBase.appendingPathComponent(url.lastPathComponent)
                let secured = url.startAccessingSecurityScopedResource()
                defer { if secured { url.stopAccessingSecurityScopedResource() } }
                if (try? FileManager.default.copyItem(at: url, to: tempURL)) != nil {
                    tempURLs.append(tempURL)
                }
            }
            onFilesSelected(tempURLs)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {}
    }
}
