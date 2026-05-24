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

    init() {
        isDebugMode = UserDefaults.standard.bool(forKey: "handoff_debug_mode")
    }

    func log(_ message: String, level: String = "info") {
        let entry = LogEntry(timestamp: Date(), level: level, message: message)
        // Always store errors/warnings; only store info/debug when debug mode is on
        if isDebugMode || level == "error" || level == "warn" {
            DispatchQueue.main.async { [weak self] in
                self?.entries.append(entry)
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
