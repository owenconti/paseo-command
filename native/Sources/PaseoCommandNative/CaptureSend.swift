import AppKit
import WebKit

/// Where a finished capture goes: a panel dropping from the top of the display, over the app you were in (it takes
/// the keyboard without bringing Paseo Command forward), showing the page's `capture.html` (`web/src/capture/`):
/// your sessions and projects on the left, the contact sheet and your message beside them. The page sends to an agent
/// itself (`POST /api/captures/:id/send`); a new agent, or opening the conversation, goes to the app's window, and
/// Copy's text (`copy`) to the clipboard.
final class CaptureSendPanel: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    let panel: CapturePanel
    private let web: WKWebView
    private let server: URL
    let id: String
    var onClose: (() -> Void)?
    /// The page asked the app's window for something: `{newAgent…}` or `{open…}`.
    var onApp: (([String: Any]) -> Void)?
    var onReveal: (() -> Void)?

    static let width: CGFloat = 1060

    init(id: String, server: URL, screen: NSScreen, persistent: Bool) {
        self.id = id
        self.server = server
        let height: CGFloat = 460
        let top = screen.visibleFrame.maxY
        let width = min(Self.width, screen.visibleFrame.width - 40)
        panel = CapturePanel(frame: CGRect(x: screen.frame.midX - width / 2, y: top - height - 8, width: width, height: height), key: true)
        panel.level = .floating
        panel.hasShadow = true
        let configuration = WKWebViewConfiguration()
        // The page's own storage (its theme, how you send), as the window's; a check run keeps its own.
        configuration.websiteDataStore = persistent ? .default() : .nonPersistent()
        web = WKWebView(frame: CGRect(x: 0, y: 0, width: width, height: height), configuration: configuration)
        web.setValue(false, forKey: "drawsBackground")
        web.isInspectable = true
        super.init()
        configuration.userContentController.add(WeakMessages(self), name: "paseoCapture")
        web.navigationDelegate = self
        let effect = NSVisualEffectView(frame: web.frame)
        effect.material = .popover
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 14
        effect.layer?.masksToBounds = true
        effect.autoresizingMask = [.width, .height]
        web.autoresizingMask = [.width, .height]
        effect.addSubview(web)
        panel.contentView = effect
        panel.delegate = self
        var url = URLComponents(url: server.appendingPathComponent("capture.html"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "id", value: id)]
        web.load(URLRequest(url: url.url!))
    }

    /// `key`: it takes the keyboard (a check run's never does: it would take the user's typing).
    func show(key: Bool = true) {
        guard key else { return panel.orderFrontRegardless() }
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(web)
    }

    func close() {
        panel.orderOut(nil)
        web.configuration.userContentController.removeScriptMessageHandler(forName: "paseoCapture")
        onClose?()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let sender = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              WebOrigin.matches(scheme: sender.protocol, host: sender.host, port: sender.port, to: server),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "size":
            guard let height = body["height"] as? Double else { return }
            let h = min(max(CGFloat(height), 160), (panel.screen?.visibleFrame.height ?? 900) - 40)
            var frame = panel.frame
            frame.origin.y = frame.maxY - h
            frame.size.height = h
            panel.setFrame(frame, display: true, animate: false)
        case "close": close()
        case "reveal": onReveal?()
        case "copy":
            guard let text = body["text"] as? String, text.count <= 200_000 else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        case "app":
            onApp?(body)
            close()
        default: break
        }
    }

    // Links on the page (none expected) open outside; the page itself stays.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == true, let url = action.request.url, !WebOrigin.matches(url, to: server) {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }
}

/// A script message handler that doesn't keep its target alive (WebKit retains its handlers).
private final class WeakMessages: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
