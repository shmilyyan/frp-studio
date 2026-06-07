import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    private let devicePicker = UIButton(type: .system)
    private let sendButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .default)
    private var fileURL: URL?
    private var filename: String = ""

    private var selectedBaseURL: String = ""
    private var deviceId: String = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadSharedData()
        loadFileFromExtensionContext()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.layoutMargins = UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.isLayoutMarginsRelativeArrangement = true

        let titleLabel = UILabel()
        titleLabel.text = "发送文件"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        stack.addArrangedSubview(titleLabel)

        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textColor = .secondaryLabel
        statusLabel.text = "准备中..."
        stack.addArrangedSubview(statusLabel)

        devicePicker.setTitle("选择目标设备 ▾", for: .normal)
        devicePicker.addTarget(self, action: #selector(showDevicePicker), for: .touchUpInside)
        stack.addArrangedSubview(devicePicker)

        progressView.isHidden = true
        stack.addArrangedSubview(progressView)

        let buttonStack = UIStackView()
        buttonStack.axis = .horizontal
        buttonStack.distribution = .fillEqually
        buttonStack.spacing = 12

        cancelButton.setTitle("取消", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        buttonStack.addArrangedSubview(cancelButton)

        sendButton.setTitle("发送", for: .normal)
        sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        sendButton.isEnabled = false
        buttonStack.addArrangedSubview(sendButton)

        stack.addArrangedSubview(buttonStack)

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    private func loadSharedData() {
        let extDefaults = UserDefaults(suiteName: nil) ?? UserDefaults.standard
        selectedBaseURL = extDefaults.string(forKey: "handoff_last_server") ?? ""

        // Auto-fill from clipboard if no saved server
        if selectedBaseURL.isEmpty {
            if let clip = UIPasteboard.general.string {
                // Match host:port pattern (e.g., 192.168.1.100:19528 or frp.example.com:19528)
                let pattern = #/[\w.\-]+:\d{4,5}/#
                if let match = clip.firstMatch(of: pattern) {
                    selectedBaseURL = String(match.0)
                    extDefaults.set(selectedBaseURL, forKey: "handoff_last_server")
                }
            }
        }

        if !selectedBaseURL.isEmpty {
            devicePicker.setTitle("📤 发送到: \(selectedBaseURL)", for: .normal)
            sendButton.isEnabled = true
        } else {
            devicePicker.setTitle("输入服务端地址 ▾", for: .normal)
        }
    }

    private func loadFileFromExtensionContext() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let provider = item.attachments?.first else { return }

        if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.data.identifier, options: nil) { [weak self] url, error in
                guard let fileURL = url as? URL else { return }
                DispatchQueue.main.async {
                    self?.fileURL = fileURL
                    self?.filename = fileURL.lastPathComponent
                    let size = (try? Data(contentsOf: fileURL))?.count ?? 0
                    self?.statusLabel.text = "📄 \(fileURL.lastPathComponent) (\(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)))"
                }
            }
        }
    }

    @objc private func showDevicePicker() {
        let alert = UIAlertController(title: "输入服务端地址", message: "例如: 192.168.1.100:19528", preferredStyle: .alert)
        alert.addTextField { textField in
            textField.placeholder = "192.168.1.100:19528"
            textField.text = self.selectedBaseURL
            textField.keyboardType = .URL
        }
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak self] _ in
            guard let text = alert.textFields?.first?.text, !text.isEmpty else { return }
            self?.selectedBaseURL = text
            self?.devicePicker.setTitle("📤 发送到: \(text)", for: .normal)
            self?.sendButton.isEnabled = true
            // Remember for next time
            let extDefaults = UserDefaults(suiteName: nil) ?? UserDefaults.standard
            extDefaults.set(text, forKey: "handoff_last_server")
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func send() {
        guard let fileURL = fileURL, !selectedBaseURL.isEmpty else { return }
        sendButton.isEnabled = false
        progressView.isHidden = false
        progressView.progress = 0
        statusLabel.text = "正在发送..."

        UploadService.upload(fileURL: fileURL, to: selectedBaseURL, deviceId: deviceId) { [weak self] success, message in
            DispatchQueue.main.async {
                self?.progressView.progress = 1.0
                if success {
                    self?.statusLabel.text = "✅ 已发送: \(message)"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                    }
                } else {
                    self?.statusLabel.text = "❌ 发送失败: \(message)"
                    self?.sendButton.isEnabled = true
                }
            }
        }
    }

    @objc private func cancel() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}