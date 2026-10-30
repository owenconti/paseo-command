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

/// An experiment: the selected workspace's app where the map is. Tabs along
/// the top, then the page bar, then the page, signed in as Conquer is (its
/// configuration and cookies). Each workspace keeps its own tabs while the app
/// runs; links clicked in the chat open here as new tabs. Until Paseo Command
/// can learn a workspace's app address, a workspace without tabs shows a note.
final class WorkspaceAppView: NSView, NSTextFieldDelegate, WKNavigationDelegate, WKUIDelegate {
    let bar = PageBar()
    /// The tab strip's row: the Map / App switch leads it, then the tabs and +.
    let tabRow = NSStackView()
    private let tabStrip = NSView()
    private let tabList = NSStackView()
    private let body = NSView()
    /// Shown while the workspace has no tabs.
    private let note: WKWebView
    private let configuration: WKWebViewConfiguration
    private var workspace: TerminalWorkspace?
    private var tabsByWorkspace: [String: [WKWebView]] = [:]
    private var currentByWorkspace: [String: WKWebView] = [:]
    private var watches: [ObjectIdentifier: [NSKeyValueObservation]] = [:]
    private(set) var current: WKWebView?

    private var key: String { workspace?.id ?? "" }
    private var tabs: [WKWebView] {
        get { tabsByWorkspace[key] ?? [] }
        set { tabsByWorkspace[key] = newValue }
    }
    /// The page showing: the current tab's, or the note.
    var web: WKWebView { current ?? note }

    init(frame: NSRect, configuration: WKWebViewConfiguration) {
        self.configuration = configuration
        note = WKWebView(frame: .zero, configuration: configuration)
        super.init(frame: frame)
        wantsLayer = true
        bar.back.target = self
        bar.back.action = #selector(goBack)
        bar.forward.target = self
        bar.forward.action = #selector(goForward)
        bar.reload.target = self
        bar.reload.action = #selector(reloadPage)
        bar.address.delegate = self
        bar.address.target = self
        bar.address.action = #selector(submit)

        tabStrip.wantsLayer = true
        tabList.orientation = .horizontal
        tabList.spacing = 2
        tabList.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let add = NSButton(image: NSImage(systemSymbolName: "plus", accessibilityDescription: "New tab")!, target: self, action: #selector(newTab))
        add.bezelStyle = .accessoryBarAction
        add.controlSize = .small
        add.toolTip = "New tab"
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        for v in [tabList, add, spacer] { tabRow.addArrangedSubview(v) }
        tabRow.orientation = .horizontal
        tabRow.spacing = 6
        tabRow.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 8)
        tabRow.translatesAutoresizingMaskIntoConstraints = false
        tabStrip.addSubview(tabRow)
        note.translatesAutoresizingMaskIntoConstraints = true
        for v in [tabStrip, bar, body] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            tabStrip.topAnchor.constraint(equalTo: topAnchor),
            tabStrip.leadingAnchor.constraint(equalTo: leadingAnchor),
            tabStrip.trailingAnchor.constraint(equalTo: trailingAnchor),
            tabStrip.heightAnchor.constraint(equalToConstant: 32),
            tabRow.leadingAnchor.constraint(equalTo: tabStrip.leadingAnchor),
            tabRow.trailingAnchor.constraint(equalTo: tabStrip.trailingAnchor),
            tabRow.topAnchor.constraint(equalTo: tabStrip.topAnchor),
            tabRow.bottomAnchor.constraint(equalTo: tabStrip.bottomAnchor),
            bar.topAnchor.constraint(equalTo: tabStrip.bottomAnchor),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.topAnchor.constraint(equalTo: bar.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: leadingAnchor),
            body.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        restyle()
        render()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }
    private func restyle() { tabStrip.layer?.backgroundColor = Ink.color(Ink.bar, effectiveAppearance).cgColor }

    /// The page selected another workspace (or none): show its tabs, or say there are none yet.
    func show(_ next: TerminalWorkspace?) {
        guard next != workspace else { return }
        workspace = next
        current = currentByWorkspace[key] ?? tabs.last
        render()
    }

    // MARK: Tabs

    /// Open `url` in a new tab of the selected workspace (a link from the chat, say).
    func openTab(_ url: URL) {
        let web = make(configuration)
        tabs.append(web)
        select(web)
        web.load(URLRequest(url: url))
    }

    @objc func newTab() {
        let web = make(configuration)
        tabs.append(web)
        select(web)
        window?.makeFirstResponder(bar.address)
    }

    private func make(_ configuration: WKWebViewConfiguration) -> WKWebView {
        let web = WKWebView(frame: body.bounds, configuration: configuration)
        web.isInspectable = true
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = self
        web.uiDelegate = self
        web.autoresizingMask = [.width, .height]
        let changed = { [weak self, weak web] in
            guard let self, let web else { return }
            if web === self.current { self.bar.show(web) }
            self.renderTabs()
        }
        watches[ObjectIdentifier(web)] = [
            web.observe(\.title) { _, _ in changed() },
            web.observe(\.url) { _, _ in changed() },
            web.observe(\.canGoBack) { _, _ in changed() },
            web.observe(\.canGoForward) { _, _ in changed() },
            web.observe(\.isLoading) { _, _ in changed() },
        ]
        return web
    }

    private func select(_ web: WKWebView) {
        current = web
        currentByWorkspace[key] = web
        render()
        if web.url != nil { window?.makeFirstResponder(web) }
    }

    private func close(_ web: WKWebView) {
        guard let i = tabs.firstIndex(of: web) else { return }
        web.stopLoading()
        web.removeFromSuperview()
        watches[ObjectIdentifier(web)] = nil
        tabs.remove(at: i)
        if current === web {
            current = tabs.isEmpty ? nil : tabs[min(i, tabs.count - 1)]
            currentByWorkspace[key] = current
        }
        render()
    }

    private func render() {
        for v in body.subviews where v !== web { v.removeFromSuperview() }
        if web.superview !== body {
            web.frame = body.bounds
            web.autoresizingMask = [.width, .height]
            body.addSubview(web)
        }
        if current == nil { showNote() }
        renderTabs()
        bar.show(current)
    }

    private func renderTabs() {
        for v in tabList.arrangedSubviews { tabList.removeArrangedSubview(v); v.removeFromSuperview() }
        for web in tabs {
            let tab = TerminalTab(id: "", closeHelp: "Close this tab")
            let title = (web.title?.isEmpty == false ? web.title : nil) ?? web.url?.host ?? "New Tab"
            tab.set(label: title, help: web.url?.absoluteString ?? title)
            tab.look = web === current ? .focused : .plain
            tab.draggable = false
            tab.onSelect = { [weak self, weak web] in if let web { self?.select(web) } }
            tab.onClose = { [weak self, weak web] in if let web { self?.close(web) } }
            tabList.addArrangedSubview(tab)
        }
    }

    private func showNote() {
        let name = (workspace?.name ?? "").replacingOccurrences(of: "<", with: "&lt;")
        let text = workspace == nil
            ? "<h2>No workspace selected</h2><p>Select an agent or workspace to see its app here.</p>"
            : "<h2>\(name)</h2><p>Paseo Command doesn’t know this workspace’s app address yet.</p><p>Type one above, or click a link in the chat, to open it here; this workspace keeps its tabs while the app runs.</p>"
        note.loadHTMLString("<style>:root{color-scheme:light dark}body{font:14px -apple-system;padding:48px;max-width:520px;color:#8a93a0}h2{font-weight:600;color:CanvasText}</style>\(text)",
                            baseURL: nil)
        bar.address.stringValue = ""
    }

    // MARK: Page bar

    @objc private func goBack() { current?.goBack() }
    @objc private func goForward() { current?.goForward() }
    @objc private func reloadPage() {
        guard let web = current else { return }
        if web.isLoading { web.stopLoading() } else { web.reload() }
    }

    @objc private func submit() { open(bar.address.stringValue) }

    /// Open what was typed: an address, or a search (in a new tab when there is none).
    func open(_ typed: String) {
        guard let url = ConquerView.destination(typed) else { return }
        guard let web = current else { return openTab(url) }
        web.load(URLRequest(url: url))
        window?.makeFirstResponder(web)
    }

    func controlTextDidEndEditing(_ obj: Notification) { bar.show(current) }

    // MARK: WKUIDelegate

    /// A page opening a window gets a new tab that keeps its opener (sign-in popups).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let web = make(configuration)
        tabs.append(web)
        select(web)
        return web
    }

    func webViewDidClose(_ webView: WKWebView) { close(webView) }

    /// What it shows, for checks.
    func state() -> [String: Any] {
        ["workspace": workspace?.name ?? "", "tabs": tabs.map { $0.url?.absoluteString ?? "" },
         "current": current.flatMap { tabs.firstIndex(of: $0) } ?? -1,
         "workspaces": tabsByWorkspace.filter { !$0.value.isEmpty }.count]
    }
}
