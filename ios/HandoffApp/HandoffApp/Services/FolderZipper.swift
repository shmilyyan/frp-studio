import Foundation

class FolderZipper {
    static func zip(folderURL: URL) -> URL? {
        let fm = FileManager.default
        let folderName = folderURL.lastPathComponent
        let cachesDir = fm.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let zipURL = cachesDir.appendingPathComponent("\(folderName).zip")

        if fm.fileExists(atPath: zipURL.path) {
            try? fm.removeItem(at: zipURL)
        }

        // Enumerate all files recursively
        var filePaths: [(relativePath: String, fullURL: URL)] = []
        guard let enumerator = fm.enumerator(at: folderURL, includingPropertiesForKeys: [.isRegularFileKey]) else {
            return nil
        }
        for case let fileURL as URL in enumerator {
            guard let values = try? fileURL.resourceValues(forKeys: [.isRegularFileKey]),
                  values.isRegularFile == true else { continue }
            let relPath = fileURL.path.replacingOccurrences(of: folderURL.path + "/", with: "")
            filePaths.append((relativePath: relPath, fullURL: fileURL))
        }
        guard !filePaths.isEmpty else { return nil }

        guard let zipData = buildZip(folderName: folderName, files: filePaths) else { return nil }
        do {
            try zipData.write(to: zipURL)
            DebugLogger.shared.warn("文件夹压缩完成: \(zipURL.path) (\(filePaths.count) 个文件)")
            return zipURL
        } catch {
            DebugLogger.shared.error("写入 zip 失败: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - ZIP builder

    private static func buildZip(folderName: String, files: [(relativePath: String, fullURL: URL)]) -> Data? {
        var centralDir = Data()
        var entries = Data()
        var centralOffset: UInt32 = 0

        for file in files {
            guard let fileData = try? Data(contentsOf: file.fullURL) else { continue }
            let entryPath = "\(folderName)/\(file.relativePath)"
            let entryData = entryPath.data(using: .utf8)!

            let compSize = UInt32(fileData.count)
            let uncompSize = UInt32(fileData.count)
            let crc = crc32(fileData)
            let modTime = dosTime()
            let nameLen = UInt16(entryData.count)

            // Local file header
            var local = Data()
            local.append(le32(0x04034b50))
            local.append(le16(20)) // version
            local.append(le16(0))  // flags
            local.append(le16(0))  // method (store)
            local.append(le16(modTime))
            local.append(le16(0))  // mod date
            local.append(le32(crc))
            local.append(le32(compSize))
            local.append(le32(uncompSize))
            local.append(le16(nameLen))
            local.append(le16(0))  // extra len
            local.append(entryData)
            local.append(fileData)

            // Central directory entry
            var cd = Data()
            cd.append(le32(0x02014b50))
            cd.append(le16(20))
            cd.append(le16(20))
            cd.append(le16(0))
            cd.append(le16(0))
            cd.append(le16(modTime))
            cd.append(le16(0))
            cd.append(le32(crc))
            cd.append(le32(compSize))
            cd.append(le32(uncompSize))
            cd.append(le16(nameLen))
            cd.append(le16(0))
            cd.append(le16(0)) // comment len
            cd.append(le16(0)) // disk start
            cd.append(le16(0)) // internal attrs
            cd.append(le32(0)) // external attrs
            cd.append(le32(centralOffset))
            cd.append(entryData)

            centralDir.append(cd)
            entries.append(local)
            centralOffset += UInt32(local.count)
        }

        // End of central directory
        var eocd = Data()
        eocd.append(le32(0x06054b50))
        eocd.append(le16(0)) // disk num
        eocd.append(le16(0)) // cd disk
        let count = UInt16(files.count)
        eocd.append(le16(count))
        eocd.append(le16(count))
        eocd.append(le32(UInt32(centralDir.count)))
        eocd.append(le32(UInt32(entries.count)))
        eocd.append(le16(0)) // comment len

        var result = entries
        result.append(centralDir)
        result.append(eocd)
        return result
    }

    // MARK: - Helpers

    private static func le16(_ v: UInt16) -> Data {
        var x = v.littleEndian
        return Data(bytes: &x, count: 2)
    }

    private static func le32(_ v: UInt32) -> Data {
        var x = v.littleEndian
        return Data(bytes: &x, count: 4)
    }

    private static func dosTime() -> UInt16 {
        let cal = Calendar.current
        let c = cal.dateComponents([.year, .month, .day], from: Date())
        let year = max(0, (c.year ?? 2026) - 1980)
        let month = c.month ?? 1
        let day = c.day ?? 1
        return UInt16((year << 9) | (month << 5) | day)
    }

    private static var crcTable: [UInt32] = {
        var t = [UInt32](repeating: 0, count: 256)
        for i in 0..<256 {
            var crc = UInt32(i)
            for _ in 0..<8 {
                crc = (crc & 1 != 0) ? (0xEDB88320 ^ (crc >> 1)) : (crc >> 1)
            }
            t[i] = crc
        }
        return t
    }()

    private static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data {
            crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFF_FFFF
    }
}
