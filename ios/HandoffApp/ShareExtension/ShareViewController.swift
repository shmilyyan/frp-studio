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
    private var pairedServers: [(name: String, baseURL: String)] = []

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
        if let url = KeychainHelper.read(key: "handoff_last_active") {
            selectedBaseURL = url
        } else if let url = KeychainHelper.read(key: "handoff_base_url") {
            selectedBaseURL = url
        }
        deviceId = KeychainHelper.read(key: "device_identity") ?? ""

        if let json = KeychainHelper.read(key: "handoff_paired_devices"),
           let data = json.data(using: .utf8),
           let devices = try? JSONDecoder().decode([PairedDeviceInfo].self, from: data) {
            pairedServers = devices.map { ($0.name, "\($0.host ?? ""):\($0.port ?? 0)") }
                .filter { !$0.1.isEmpty && !$0.1.contains(":0") }
        }

        if !selectedBaseURL.isEmpty {
            let name = pairedServers.first(where: { $0.baseURL == selectedBaseURL })?.name ?? selectedBaseURL
            devicePicker.setTitle("📤 发送到: \(name)", for: .normal)
            sendButton.isEnabled = true
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
        guard !pairedServers.isEmpty else { return }
        let alert = UIAlertController(title: "选择目标设备", message: nil, preferredStyle: .actionSheet)
        for server in pairedServers {
            alert.addAction(UIAlertAction(title: server.name, style: .default) { [weak self] _ in
                self?.selectedBaseURL = server.baseURL
                self?.devicePicker.setTitle("📤 发送到: \(server.name)", for: .normal)
                self?.sendButton.isEnabled = true
            })
        }
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

struct PairedDeviceInfo: Decodable {
    let name: String
    let host: String?
    let port: Int?
}
