import Foundation
import AppleArchive

class FolderZipper {
    static func zip(folderURL: URL) -> URL? {
        let fm = FileManager.default
        let cachesDir = fm.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let zipURL = cachesDir.appendingPathComponent(folderURL.lastPathComponent)
            .appendingPathExtension("zip")

        // Clean up any existing zip
        if fm.fileExists(atPath: zipURL.path) {
            try? fm.removeItem(at: zipURL)
        }

        // Build Apple Archive stream chain
        guard let destStream = ArchiveByteStream.fileStream(
            path: FilePath(zipURL.path),
            mode: .writeOnly,
            options: [.create],
            permissions: [.ownerRead, .ownerWrite]
        ) else {
            DebugLogger.shared.error("无法创建归档文件流")
            return nil
        }
        defer { try? destStream.close() }

        guard let compressStream = ArchiveByteStream.compressionStream(
            using: .zlib,
            writingTo: destStream
        ) else {
            DebugLogger.shared.error("无法创建压缩流")
            return nil
        }
        defer { try? compressStream.close() }

        guard let encodeStream = ArchiveStream.encodeStream(writingTo: compressStream) else {
            DebugLogger.shared.error("无法创建编码流")
            return nil
        }
        defer { try? encodeStream.close() }

        do {
            try encodeStream.writeDirectoryContents(
                archiveFrom: FilePath(folderURL.path),
                keySet: ArchiveHeader.FieldKeySet("TYP,PAT,DAT,MTM"))
            DebugLogger.shared.warn("文件夹压缩完成: \(zipURL.path)")
            return zipURL
        } catch {
            DebugLogger.shared.error("压缩失败: \(error.localizedDescription)")
            try? fm.removeItem(at: zipURL)
            return nil
        }
    }
}
