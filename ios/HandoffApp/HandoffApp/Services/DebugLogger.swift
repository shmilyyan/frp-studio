import Foundation
import SwiftUI

struct LogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let level: String
    let message: String
}

class DebugLogger: ObservableObject {
    static let shared = DebugLogger()

    @Published var entries: [LogEntry] = []
    @Published var isDebugMode: Bool {
        didSet {
            UserDefaults.standard.set(isDebugMode, forKey: "handoff_debug_mode")
        }
    }

    private var fileHandle: FileHandle?
    private let logQueue = DispatchQueue(label: "handoff.logger", qos: .utility)

    init() {
        isDebugMode = UserDefaults.standard.bool(forKey: "handoff_debug_mode")
        setupFileLogging()
    }

    private func setupFileLogging() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let logsDir = docs.appendingPathComponent("Logs")
        try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let filename = "handoff_\(formatter.string(from: Date())).log"
        let logFile = logsDir.appendingPathComponent(filename)

        FileManager.default.createFile(atPath: logFile.path, contents: nil)
        fileHandle = try? FileHandle(forWritingTo: logFile)
        // Keep only last 10 log files
        cleanupOldLogs(in: logsDir, keep: 10)
    }

    private func cleanupOldLogs(in dir: URL, keep: Int) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.creationDateKey])
        else { return }
        let sorted = files.filter { $0.pathExtension == "log" }.sorted {
            (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate ?? .distantPast) ?? .distantPast
            > (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate ?? .distantPast) ?? .distantPast
        }
        for file in sorted.dropFirst(keep) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    func log(_ message: String, level: String = "info") {
        let entry = LogEntry(timestamp: Date(), level: level, message: message)
        // Always store errors/warnings; only store info/debug when debug mode is on
        if isDebugMode || level == "error" || level == "warn" {
            DispatchQueue.main.async { [weak self] in
                self?.entries.append(entry)
            }
        }
        // Always write to file log for crash diagnosis
        logQueue.async { [weak self] in
            let ts = ISO8601DateFormatter().string(from: entry.timestamp)
            let line = "[\(ts)] [\(level)] \(message)\n"
            if let data = line.data(using: .utf8) {
                self?.fileHandle?.write(data)
            }
        }
        if isDebugMode {
            print("[Handoff:\(level)] \(message)")
        } else if level == "error" || level == "warn" {
            print("[Handoff:\(level)] \(message)")
        }
    }

    func info(_ message: String) { log(message, level: "info") }
    func warn(_ message: String) { log(message, level: "warn") }
    func error(_ message: String) { log(message, level: "error") }
    func debug(_ message: String) { log(message, level: "debug") }

    func clear() {
        entries.removeAll()
    }
}
