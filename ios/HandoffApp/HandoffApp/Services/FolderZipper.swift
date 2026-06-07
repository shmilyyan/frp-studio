import Foundation

class FolderZipper {
    static func zip(folderURL: URL) -> URL? {
        let fm = FileManager.default
        let folderName = folderURL.lastPathComponent
        let tempDir = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let zipURL = tempDir.appendingPathComponent("\(folderName).zip")

        // Create temp directory
        do {
            try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        } catch {
            DebugLogger.shared.error("创建临时目录失败: \(error.localizedDescription)")
            return nil
        }

        // Use Foundation's built-in zip via NSFileCoordinator / external process
        // On iOS, use libcompression or a manual zip approach
        guard let zipPath = createZip(folderURL: folderURL, destURL: zipURL) else {
            try? fm.removeItem(at: tempDir)
            return nil
        }
        return zipPath
    }

    private static func createZip(folderURL: URL, destURL: URL) -> URL? {
        let fm = FileManager.default
        // Enumerate all files recursively
        var filePaths: [(relativePath: String, fullURL: URL)] = []
        guard let enumerator = fm.enumerator(at: folderURL, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else {
            return nil
        }

        for case let fileURL as URL in enumerator {
            guard let resourceValues = try? fileURL.resourceValues(forKeys: [.isRegularFileKey]),
                  let isRegularFile = resourceValues.isRegularFile, isRegularFile else { continue }
            let relPath = fileURL.path.replacingOccurrences(of: folderURL.path + "/", with: "")
            filePaths.append((relativePath: relPath, fullURL: fileURL))
        }

        guard !filePaths.isEmpty else { return nil }

        // Build zip file manually
        guard let zipData = buildZip(folderName: folderURL.lastPathComponent, files: filePaths) else { return nil }
        do {
            try zipData.write(to: destURL)
        } catch {
            DebugLogger.shared.error("写入 zip 失败: \(error.localizedDescription)")
            return nil
        }
        return destURL
    }

    private static func buildZip(folderName: String, files: [(relativePath: String, fullURL: URL)]) -> Data? {
        var centralDir = Data()
        var entries = Data()
        var centralOffset: UInt32 = 0

        for file in files {
            guard let fileData = try? Data(contentsOf: file.fullURL) else { continue }
            let entryPath = "\(folderName)/\(file.relativePath)"

            // Local file header
            var localHeader = Data()
            localHeader.append(contentsOf: [0x50, 0x4B, 0x03, 0x04]) // signature
            localHeader.append(contentsOf: withUnsafeBytes(of: UInt16(20).littleEndian) { Data($0) }) // version
            localHeader.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // flags
            localHeader.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // compression (store)
            let modTime = dosTime(Date())
            localHeader.append(contentsOf: withUnsafeBytes(of: modTime) { Data($0) })
            localHeader.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // mod date
            let crc = crc32(fileData)
            localHeader.append(contentsOf: withUnsafeBytes(of: UInt32(crc).littleEndian) { Data($0) })
            let compressedSize = UInt32(fileData.count)
            let uncompressedSize = UInt32(fileData.count)
            localHeader.append(contentsOf: withUnsafeBytes(of: compressedSize) { Data($0) })
            localHeader.append(contentsOf: withUnsafeBytes(of: uncompressedSize) { Data($0) })
            let nameLen = UInt16(entryPath.utf8.count)
            let extraLen = UInt16(0)
            localHeader.append(contentsOf: withUnsafeBytes(of: nameLen) { Data($0) })
            localHeader.append(contentsOf: withUnsafeBytes(of: extraLen) { Data($0) })
            localHeader.append(contentsOf: entryPath.data(using: .utf8)!)
            localHeader.append(fileData)

            // Central directory entry
            var cdEntry = Data()
            cdEntry.append(contentsOf: [0x50, 0x4B, 0x01, 0x02]) // signature
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(20).littleEndian) { Data($0) }) // version made by
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(20).littleEndian) { Data($0) }) // version needed
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // flags
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // compression
            cdEntry.append(contentsOf: withUnsafeBytes(of: modTime) { Data($0) })
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // mod date
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt32(crc).littleEndian) { Data($0) })
            cdEntry.append(contentsOf: withUnsafeBytes(of: compressedSize) { Data($0) })
            cdEntry.append(contentsOf: withUnsafeBytes(of: uncompressedSize) { Data($0) })
            cdEntry.append(contentsOf: withUnsafeBytes(of: nameLen) { Data($0) })
            cdEntry.append(contentsOf: withUnsafeBytes(of: extraLen) { Data($0) })
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // comment len
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // disk start
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // internal attrs
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt32(0).littleEndian) { Data($0) }) // external attrs
            cdEntry.append(contentsOf: withUnsafeBytes(of: UInt32(centralOffset).littleEndian) { Data($0) }) // local header offset
            cdEntry.append(contentsOf: entryPath.data(using: .utf8)!)

            centralDir.append(cdEntry)
            entries.append(localHeader)
            centralOffset += UInt32(localHeader.count)
        }

        // End of central directory
        var eocd = Data()
        eocd.append(contentsOf: [0x50, 0x4B, 0x05, 0x06]) // signature
        eocd.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // disk num
        eocd.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // disk with cd
        let entryCount = UInt16(files.count)
        eocd.append(contentsOf: withUnsafeBytes(of: entryCount) { Data($0) }) // entries on disk
        eocd.append(contentsOf: withUnsafeBytes(of: entryCount) { Data($0) }) // total entries
        eocd.append(contentsOf: withUnsafeBytes(of: UInt32(centralDir.count).littleEndian) { Data($0) }) // cd size
        eocd.append(contentsOf: withUnsafeBytes(of: UInt32(entries.count).littleEndian) { Data($0) }) // cd offset
        eocd.append(contentsOf: withUnsafeBytes(of: UInt16(0).littleEndian) { Data($0) }) // comment len

        var result = entries
        result.append(centralDir)
        result.append(eocd)
        return result
    }

    private static func dosTime(_ date: Date) -> UInt16 {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let year = max(0, (comps.year ?? 2026) - 1980)
        let month = comps.month ?? 1
        let day = comps.day ?? 1
        return UInt16(year << 9 | month << 5 | day)
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        let table = crc32Table()
        for byte in data {
            let idx = Int((crc ^ UInt32(byte)) & 0xFF)
            crc = (crc >> 8) ^ table[idx]
        }
        return crc ^ 0xFFFFFFFF
    }

    private static func crc32Table() -> [UInt32] {
        var table = [UInt32](repeating: 0, count: 256)
        for i in 0..<256 {
            var crc = UInt32(i)
            for _ in 0..<8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xEDB88320
                } else {
                    crc >>= 1
                }
            }
            table[i] = crc
        }
        return table
    }
}
