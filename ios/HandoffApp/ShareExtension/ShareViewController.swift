import UIKit
import Social

class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { return true }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = item.attachments?.first else { return }

        if attachment.hasItemConformingToTypeIdentifier("public.plain-text") {
            attachment.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { (text, _) in
                if let text = text as? String {
                    let shared = UserDefaults(suiteName: "group.com.frper.handoff")
                    shared?.set(text, forKey: "pending_clipboard")
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else if attachment.hasItemConformingToTypeIdentifier("public.image") {
            attachment.loadItem(forTypeIdentifier: "public.image", options: nil) { (imageURL, _) in
                if let url = imageURL as? URL {
                    let shared = UserDefaults(suiteName: "group.com.frper.handoff")
                    shared?.set(url.path, forKey: "pending_file")
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else if attachment.hasItemConformingToTypeIdentifier("public.url") {
            attachment.loadItem(forTypeIdentifier: "public.url", options: nil) { (url, _) in
                if let url = url as? URL {
                    let shared = UserDefaults(suiteName: "group.com.frper.handoff")
                    shared?.set(url.absoluteString, forKey: "pending_clipboard")
                }
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        }
    }

    override func configurationItems() -> [Any]! { return [] }
}
