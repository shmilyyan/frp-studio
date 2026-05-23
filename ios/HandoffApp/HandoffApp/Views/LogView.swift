import SwiftUI

struct LogView: View {
    @EnvironmentObject var logger: DebugLogger

    var body: some View {
        VStack(spacing: 0) {
            // Header controls
            HStack {
                Text("调试日志")
                    .font(.headline)
                Spacer()
                Toggle("调试模式", isOn: $logger.isDebugMode)
                    .labelsHidden()
                    .scaleEffect(0.8)
                Text("调试模式")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Button(action: { logger.clear() }) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            if logger.entries.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "terminal")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)
                    Text("暂无日志")
                        .foregroundColor(.secondary)
                    Text("打开调试模式后，应用运行日志将显示在这里")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
            } else {
                List {
                    ForEach(logger.entries.reversed()) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(levelBadge(entry.level))
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(levelColor(entry.level).opacity(0.2))
                                    .cornerRadius(4)
                                Text(formatTime(entry.timestamp))
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            Text(entry.message)
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(.primary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .navigationTitle("日志")
    }

    private func levelBadge(_ level: String) -> String {
        switch level {
        case "error": return "ERR"
        case "warn":  return "WRN"
        case "debug": return "DBG"
        default:      return "INF"
        }
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "error": return .red
        case "warn":  return .orange
        case "debug": return .purple
        default:      return .blue
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: date)
    }
}
