import AppKit
import WebKit

/// Back, forward, reload and the address, along the top of a page (Conquer's,
/// and the workspace app's). Whoever owns it sets the buttons' actions.
final class PageBar: NSView {
    let back = NSButton()
    let forward = NSButton()
    let reload = NSButton()
    let address = NSTextField()
    let row = NSStackView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        for (button, symbol, help) in [(back, "chevron.left", "Back (⌘[)"), (forward, "chevron.right", "Forward (⌘])"),
                                       (reload, "arrow.clockwise", "Reload (⌘R)")] {
            button.bezelStyle = .accessoryBarAction
            button.controlSize = .small
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: help)
            button.toolTip = help
        }
        address.placeholderString = "Search or enter address"
        address.font = .systemFont(ofSize: 12)
        address.bezelStyle = .roundedBezel
        address.focusRingType = .none
        address.lineBreakMode = .byTruncatingTail
        address.cell?.isScrollable = true
        address.cell?.wraps = false
        address.setContentHuggingPriority(.init(1), for: .horizontal)
        for v in [back, forward, reload, address] { row.addArrangedSubview(v) }
        row.orientation = .horizontal
        row.spacing = 4
        row.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 10)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        let line = NSBox()
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 38),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }
    private func restyle() { layer?.backgroundColor = Ink.color(Ink.base, effectiveAppearance).cgColor }

    /// Show `web`'s state: back and forward, reload or stop, and its address (unless it is being typed).
    func show(_ web: WKWebView?) {
        back.isEnabled = web?.canGoBack ?? false
        forward.isEnabled = web?.canGoForward ?? false
        let loading = web?.isLoading == true
        reload.image = NSImage(systemSymbolName: loading ? "xmark" : "arrow.clockwise", accessibilityDescription: loading ? "Stop" : "Reload")
        if address.currentEditor() == nil { address.stringValue = web?.url?.scheme?.hasPrefix("http") == true ? web?.url?.absoluteString ?? "" : "" }
    }
}

/// The map area's Map / App switch (View → Show Workspace App, ⌥⌘`).
final class MapAppSwitch: NSSegmentedControl {
    var onChange: ((_ app: Bool) -> Void)?

    convenience init() {
        self.init(labels: ["Map", "App"], trackingMode: .selectOne, target: nil, action: nil)
        target = self
        action = #selector(changed)
        controlSize = .small
        selectedSegment = 0
        toolTip = "The map, or the selected workspace's app (⌥⌘`)"
        sizeToFit()
    }

    var app: Bool {
        get { selectedSegment == 1 }
        set { selectedSegment = newValue ? 1 : 0 }
    }

    @objc private func changed() { onChange?(app) }
}

/// An experiment: the selected workspace's app where the map is. A page under
/// the page bar, signed in as Conquer is (its configuration and cookies). Until
/// Paseo Command can learn a workspace's app address, it says so, and each
/// workspace keeps whatever address is typed for it.
final class WorkspaceAppView: NSView, NSTextFieldDelegate, WKNavigationDelegate, WKUIDelegate {
    let bar = PageBar()
    let web: WKWebView
    private var workspace: TerminalWorkspace?
    /// Each workspace's address, as typed or browsed to.
    private var addresses: [String: URL] = [:]
    private var watches: [NSKeyValueObservation] = []

    init(frame: NSRect, configuration: WKWebViewConfiguration) {
        web = WKWebView(frame: .zero, configuration: configuration)
        super.init(frame: frame)
        wantsLayer = true
        web.isInspectable = true
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = self
        web.uiDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        bar.back.target = web
        bar.back.action = #selector(WKWebView.goBack(_:))
        bar.forward.target = web
        bar.forward.action = #selector(WKWebView.goForward(_:))
        bar.reload.target = self
        bar.reload.action = #selector(reloadPage)
        bar.address.delegate = self
        bar.address.target = self
        bar.address.action = #selector(submit)
        addSubview(bar)
        addSubview(web)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: topAnchor),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: trailingAnchor),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: leadingAnchor),
            web.trailingAnchor.constraint(equalTo: trailingAnchor),
            web.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        let changed = { [weak self] in self?.bar.show(self?.web) }
        watches = [
            web.observe(\.url) { _, _ in changed() },
            web.observe(\.canGoBack) { _, _ in changed() },
            web.observe(\.canGoForward) { _, _ in changed() },
            web.observe(\.isLoading) { _, _ in changed() },
        ]
        note()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The page selected another workspace (or none): show its app, or say there is none yet.
    func show(_ next: TerminalWorkspace?) {
        guard next != workspace else { return }
        workspace = next
        if let id = next?.id, let url = addresses[id] { web.load(URLRequest(url: url)) } else { note() }
    }

    private func note() {
        let name = (workspace?.name ?? "").replacingOccurrences(of: "<", with: "&lt;")
        let text = workspace == nil
            ? "<h2>No workspace selected</h2><p>Select an agent or workspace to see its app here.</p>"
            : "<h2>\(name)</h2><p>Paseo Command doesn’t know this workspace’s app address yet.</p><p>Type one above to open it here; this workspace keeps it while the app runs.</p>"
        web.loadHTMLString("<style>:root{color-scheme:light dark}body{font:14px -apple-system;padding:48px;max-width:520px;color:#8a93a0}h2{font-weight:600;color:CanvasText}</style>\(text)",
                           baseURL: nil)
        bar.address.stringValue = ""
    }

    @objc private func reloadPage() {
        if web.isLoading { web.stopLoading() } else if web.url?.scheme?.hasPrefix("http") == true { web.reload() }
    }

    @objc private func submit() { open(bar.address.stringValue) }

    /// Open what was typed: an address, or a search.
    func open(_ typed: String) {
        guard let url = ConquerView.destination(typed) else { return }
        web.load(URLRequest(url: url))
        window?.makeFirstResponder(web)
    }

    func controlTextDidEndEditing(_ obj: Notification) { bar.show(web) }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        if let id = workspace?.id, let url = webView.url, url.scheme?.hasPrefix("http") == true { addresses[id] = url }
    }

    // Links that open a window open here.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }

    /// What it shows, for checks.
    func state() -> [String: Any] {
        ["workspace": workspace?.name ?? "", "url": web.url?.absoluteString ?? "", "addresses": addresses.count]
    }
}
