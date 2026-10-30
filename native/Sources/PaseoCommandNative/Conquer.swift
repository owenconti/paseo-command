import AppKit
import ImageIO
import WebKit

/// The window's two sides: the map and panels, or the Conquer browser.
enum Mode: String {
    case command, conquer
}

/// One of the mode bar's tabs: it says when the pointer is over it, and shows a pointing hand.
final class ModeButton: NSButton {
    var onHover: ((Bool) -> Void)?
    private(set) var hovered = false

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; onHover?(true) }
    override func mouseExited(with event: NSEvent) { hovered = false; onHover?(false) }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
}

/// The strip across the top of the window that switches between Command and Conquer (⌘` toggles).
final class ModeBar: NSView {
    var onSelect: ((Mode) -> Void)?
    var mode: Mode = .command { didSet { restyle() } }
    private let buttons: [(Mode, ModeButton)]
    private let underline = NSView()
    /// A fainter line under a tab the pointer is over, where the underline would go.
    private let hoverLine = NSView()

    override init(frame: NSRect) {
        buttons = [(.command, ModeButton()), (.conquer, ModeButton())]
        super.init(frame: frame)
        wantsLayer = true
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 18
        row.edgeInsets = NSEdgeInsets(top: 0, left: 14, bottom: 0, right: 14)
        row.translatesAutoresizingMaskIntoConstraints = false
        for (mode, button) in buttons {
            button.isBordered = false
            button.target = self
            button.action = #selector(pick(_:))
            button.tag = mode == .command ? 0 : 1
            button.toolTip = mode == .command ? "The map and panels (⌘`)" : "The browser (⌘`)"
            button.onHover = { [weak self] _ in self?.restyle() }
            row.addArrangedSubview(button)
        }
        addSubview(row)
        for v in [hoverLine, underline] {
            v.wantsLayer = true
            addSubview(v)
        }
        let line = NSBox()
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func pick(_ sender: NSButton) { onSelect?(sender.tag == 0 ? .command : .conquer) }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }

    /// Dark or light with the system, as the page's panels are.
    private func restyle() {
        let look = effectiveAppearance
        layer?.backgroundColor = Ink.color(Ink.bar, look).cgColor
        underline.layer?.backgroundColor = Ink.color(Ink.accent, look).cgColor
        hoverLine.layer?.backgroundColor = Ink.color(Ink.accent, look, 0.35).cgColor
        for (mode, button) in buttons {
            let on = mode == self.mode
            button.attributedTitle = NSAttributedString(string: mode == .command ? "COMMAND" : "CONQUER", attributes: [
                .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
                .foregroundColor: Ink.color(on ? Ink.strong : button.hovered ? Ink.mid : Ink.off, look),
                .kern: 1.2,
            ])
        }
        needsLayout = true
    }

    override func layout() {
        super.layout()
        func line(under button: NSButton) -> CGRect {
            let r = convert(button.bounds, from: button)
            return CGRect(x: r.minX, y: 1, width: r.width, height: 2)
        }
        if let button = buttons.first(where: { $0.0 == mode })?.1 { underline.frame = line(under: button) }
        let hovered = buttons.first(where: { $0.0 != mode && $0.1.hovered })?.1
        hoverLine.isHidden = hovered == nil
        if let hovered { hoverLine.frame = line(under: hovered) }
    }
}

/// One page of the browser and what the bar shows for it.
final class BrowserTab: NSObject {
    let web: WKWebView
    var onChange: (() -> Void)?
    private var watches: [NSKeyValueObservation] = []

    init(configuration: WKWebViewConfiguration) {
        web = WKWebView(frame: .zero, configuration: configuration)
        web.isInspectable = true
        web.allowsBackForwardNavigationGestures = true
        web.allowsMagnification = true
        super.init()
        watches = [
            web.observe(\.title) { [weak self] _, _ in self?.onChange?() },
            web.observe(\.url) { [weak self] _, _ in self?.onChange?() },
            web.observe(\.canGoBack) { [weak self] _, _ in self?.onChange?() },
            web.observe(\.canGoForward) { [weak self] _, _ in self?.onChange?() },
            web.observe(\.isLoading) { [weak self] _, _ in self?.onChange?() },
        ]
    }

    var title: String {
        if let t = web.title, !t.isEmpty { return t }
        return web.url?.host ?? "New Tab"
    }
}

/// Conquer: a browser of tabbed pages, signed in with Zen Browser's cookies
/// (see `ZenCookies`) and keeping a cookie store of its own between launches.
final class ConquerView: NSView, WKNavigationDelegate, WKUIDelegate, NSTextFieldDelegate, WKDownloadDelegate {
    private let configuration = WKWebViewConfiguration()
    private(set) var tabs: [BrowserTab] = []
    private(set) var current: BrowserTab?
    private let tabBar = NSStackView()
    private let back = NSButton()
    private let forward = NSButton()
    private let reloadButton = NSButton()
    private let address = NSTextField()
    private let body = NSView()
    /// The last cookie import, for the menu and checks.
    private(set) var imported = "not yet"
    private var restored = false
    /// Tabs come back on the next launch (checks keep theirs to themselves).
    private let remember: Bool

    init(frame: NSRect, persistent: Bool) {
        remember = persistent
        // A store of its own, kept on disk: Command's page keeps its own.
        configuration.websiteDataStore = persistent ? WKWebsiteDataStore(forIdentifier: Self.store) : .nonPersistent()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        // As Safari names itself, so sites treat it as a browser rather than an embedded view.
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        configuration.applicationNameForUserAgent = "Version/\(major >= 26 ? major : 18).0 Safari/605.1.15"
        super.init(frame: frame)
        // Its chrome and its pages' prefers-color-scheme follow the system.
        wantsLayer = true
        layer?.backgroundColor = background.cgColor

        tabBar.orientation = .horizontal
        tabBar.spacing = 2
        tabBar.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let add = NSButton()
        let tabRow = NSStackView()
        tabRow.orientation = .horizontal
        tabRow.spacing = 6
        tabRow.edgeInsets = NSEdgeInsets(top: 4, left: 8, bottom: 0, right: 8)
        let tabSpacer = NSView()
        tabSpacer.setContentHuggingPriority(.init(1), for: .horizontal)
        for v in [tabBar, add, tabSpacer] { tabRow.addArrangedSubview(v) }

        for (button, symbol, help, action) in [(back, "chevron.left", "Back", #selector(goBack)),
                                               (forward, "chevron.right", "Forward", #selector(goForward)),
                                               (reloadButton, "arrow.clockwise", "Reload (⌘R)", #selector(reloadPage)),
                                               (add, "plus", "New tab (⌘T)", #selector(newTab))] {
            button.bezelStyle = .accessoryBarAction
            button.controlSize = .small
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: help)
            button.toolTip = help
            button.target = self
            button.action = action
        }
        address.placeholderString = "Search or enter address"
        address.font = .systemFont(ofSize: 12)
        address.bezelStyle = .roundedBezel
        address.focusRingType = .none
        address.lineBreakMode = .byTruncatingTail
        address.cell?.isScrollable = true
        address.cell?.wraps = false
        address.delegate = self
        address.target = self
        address.action = #selector(go)
        let nav = NSStackView()
        nav.orientation = .horizontal
        nav.spacing = 4
        nav.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 10)
        for v in [back, forward, reloadButton, address] { nav.addArrangedSubview(v) }

        for v in [tabRow, nav, body] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            tabRow.topAnchor.constraint(equalTo: topAnchor),
            tabRow.leadingAnchor.constraint(equalTo: leadingAnchor),
            tabRow.trailingAnchor.constraint(equalTo: trailingAnchor),
            tabRow.heightAnchor.constraint(equalToConstant: 30),
            nav.topAnchor.constraint(equalTo: tabRow.bottomAnchor),
            nav.leadingAnchor.constraint(equalTo: leadingAnchor),
            nav.trailingAnchor.constraint(equalTo: trailingAnchor),
            nav.heightAnchor.constraint(equalToConstant: 34),
            body.topAnchor.constraint(equalTo: nav.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: leadingAnchor),
            body.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var background: NSColor { Ink.color(Ink.base, effectiveAppearance) }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        layer?.backgroundColor = background.cgColor
        renderTabs()
    }

    /// Conquer's cookie store's identity, the same every launch.
    private static let store = UUID(uuidString: "C0A9B6E2-5F1D-4C3E-9A71-2D8E4B6F0C15")!

    /// The first time Conquer shows: Zen's cookies first, then the tabs from last time.
    func start() {
        guard !restored else { return }
        restored = true
        importZenCookies { [weak self] in
            guard let self else { return }
            let saved = self.remember ? UserDefaults.standard.stringArray(forKey: "conquerTabs") ?? [] : []
            for link in saved { if let url = URL(string: link) { self.open(url, select: false) } }
            if self.tabs.isEmpty { self.newTab() } else {
                self.select(self.tabs[min(max(0, UserDefaults.standard.integer(forKey: "conquerTab")), self.tabs.count - 1)])
            }
        }
    }

    /// Copy Zen's cookies into Conquer's store (at the start, and from the menu).
    func importZenCookies(then done: (() -> Void)? = nil) {
        ZenCookies.load(into: configuration.websiteDataStore.httpCookieStore) { [weak self] result in
            switch result {
            case .success(let count): self?.imported = "\(count) cookies"
            case .failure(let error): self?.imported = error.localizedDescription
            }
            Log.line("Zen cookies: \(self?.imported ?? "")")
            done?()
        }
    }

    // MARK: Tabs

    @discardableResult
    private func add(_ tab: BrowserTab, select chosen: Bool) -> BrowserTab {
        tab.web.navigationDelegate = self
        tab.web.uiDelegate = self
        tab.web.frame = body.bounds
        tab.web.autoresizingMask = [.width, .height]
        tab.onChange = { [weak self, weak tab] in
            guard let self, let tab else { return }
            self.renderTabs()
            if tab === self.current { self.renderBar() }
            self.save()
        }
        tabs.append(tab)
        if chosen || current == nil { select(tab) } else { renderTabs() }
        return tab
    }

    @discardableResult
    func open(_ url: URL, select chosen: Bool = true) -> BrowserTab {
        let tab = add(BrowserTab(configuration: configuration), select: chosen)
        tab.web.load(URLRequest(url: url))
        return tab
    }

    /// A blank tab, with the address bar ready (⌘T).
    @objc func newTab() {
        add(BrowserTab(configuration: configuration), select: true)
        focusAddress()
    }

    /// Close the current tab (⌘W); the last one leaves a blank tab behind.
    @objc func closeTab() {
        guard let tab = current else { return }
        close(tab)
    }

    private func close(_ tab: BrowserTab) {
        guard let index = tabs.firstIndex(where: { $0 === tab }) else { return }
        tab.web.stopLoading()
        tab.web.removeFromSuperview()
        tabs.remove(at: index)
        if current === tab {
            current = nil
            if tabs.isEmpty { newTab() } else { select(tabs[min(index, tabs.count - 1)]) }
        } else { renderTabs() }
        save()
    }

    private func select(_ tab: BrowserTab) {
        current?.web.removeFromSuperview()
        current = tab
        tab.web.frame = body.bounds
        body.addSubview(tab.web)
        renderTabs()
        renderBar()
        save()
        if tab.web.url != nil { window?.makeFirstResponder(tab.web) }
    }

    /// Step through the tabs (⌃Tab, ⌃⇧Tab).
    func cycle(_ step: Int) {
        guard let current, let i = tabs.firstIndex(where: { $0 === current }), tabs.count > 1 else { return }
        select(tabs[(i + step + tabs.count) % tabs.count])
    }

    /// Go to the `number`th tab (⌘1…⌘8); 9 is the last, as in other browsers.
    func selectTab(_ number: Int) {
        guard !tabs.isEmpty else { return }
        let i = number == 9 ? tabs.count - 1 : number - 1
        if tabs.indices.contains(i), tabs[i] !== current { select(tabs[i]) }
    }

    private func renderTabs() {
        for v in tabBar.arrangedSubviews { tabBar.removeArrangedSubview(v); v.removeFromSuperview() }
        for tab in tabs {
            let view = TerminalTab(id: "", closeHelp: "Close this tab (⌘W)")
            view.set(label: tab.title, help: tab.web.url?.absoluteString ?? tab.title)
            view.look = tab === current ? .focused : .plain
            view.onSelect = { [weak self, weak tab] in if let tab { self?.select(tab) } }
            view.onClose = { [weak self, weak tab] in if let tab { self?.close(tab) } }
            view.draggable = false
            tabBar.addArrangedSubview(view)
        }
    }

    private func renderBar() {
        let web = current?.web
        back.isEnabled = web?.canGoBack ?? false
        forward.isEnabled = web?.canGoForward ?? false
        reloadButton.image = NSImage(systemSymbolName: web?.isLoading == true ? "xmark" : "arrow.clockwise",
                                     accessibilityDescription: web?.isLoading == true ? "Stop" : "Reload")
        // Leave what's being typed alone.
        if address.currentEditor() == nil { address.stringValue = web?.url?.absoluteString ?? "" }
    }

    private func save() {
        guard remember, restored else { return }
        UserDefaults.standard.set(tabs.compactMap { $0.web.url?.absoluteString }.filter { $0.hasPrefix("http") }, forKey: "conquerTabs")
        if let current, let i = tabs.filter({ $0.web.url?.absoluteString.hasPrefix("http") == true }).firstIndex(where: { $0 === current }) {
            UserDefaults.standard.set(i, forKey: "conquerTab")
        }
    }

    // MARK: Navigation

    @objc private func goBack() { current?.web.goBack() }
    @objc private func goForward() { current?.web.goForward() }
    @objc func reloadPage() {
        guard let web = current?.web else { return }
        if web.isLoading { web.stopLoading() } else { web.reload() }
    }

    /// The address bar takes the keyboard (⌘L).
    @objc func focusAddress() {
        window?.makeFirstResponder(address)
        address.currentEditor()?.selectAll(nil)
    }

    /// Whatever was typed: an address (https unless it is local), or a search.
    static func destination(_ typed: String) -> URL? {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if text.contains("://"), let url = URL(string: text) { return url }
        let local = text.hasPrefix("localhost") || text.hasPrefix("127.") || text.range(of: #"^\d+\.\d+\.\d+\.\d+"#, options: .regularExpression) != nil
        if !text.contains(" "), local || text.contains(".") || text.contains(":"), let url = URL(string: (local ? "http://" : "https://") + text) {
            return url
        }
        var search = URLComponents(string: "https://www.google.com/search")!
        search.queryItems = [URLQueryItem(name: "q", value: text)]
        return search.url
    }

    @objc private func go() {
        guard let url = Self.destination(address.stringValue) else { return }
        if let web = current?.web { web.load(URLRequest(url: url)); window?.makeFirstResponder(web) } else { open(url) }
    }

    func controlTextDidEndEditing(_ obj: Notification) { renderBar() }

    // MARK: WKNavigationDelegate, WKUIDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        // ⌘-click opens a link in a tab behind this one.
        if navigationAction.navigationType == .linkActivated, navigationAction.modifierFlags.contains(.command),
           let url = navigationAction.request.url {
            open(url, select: false)
            return decisionHandler(.cancel)
        }
        // Schemes a browser hands to other apps (mailto:, zoommtg:, …).
        if let url = navigationAction.request.url, let scheme = url.scheme,
           !["http", "https", "about", "data", "blob", "file"].contains(scheme) {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    /// Downloads go to ~/Downloads, under a name not already taken.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let name = suggestedFilename as NSString
        var url = folder.appendingPathComponent(suggestedFilename)
        var n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            n += 1
            let ext = name.pathExtension.isEmpty ? "" : ".\(name.pathExtension)"
            url = folder.appendingPathComponent("\(name.deletingPathExtension) \(n)\(ext)")
        }
        completionHandler(url)
    }
    func downloadDidFinish(_ download: WKDownload) { Log.line("Conquer download finished") }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        Log.line("Conquer download failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        // Cancelled or handed off as a download: nothing to show.
        guard e.code != NSURLErrorCancelled, !(e.domain == "WebKitErrorDomain" && e.code == 102) else { return }
        let text = e.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
        webView.loadHTMLString("<style>:root{color-scheme:light dark}body{font:15px -apple-system;padding:40px}</style><h2>Can’t open this page</h2><p>\(text)</p>",
                               baseURL: nil)
    }

    /// A page opening a window (target=_blank, sign-in popups) gets a new tab
    /// that keeps its opener, so popups can report back.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        add(BrowserTab(configuration: configuration), select: true).web
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let tab = tabs.first(where: { $0.web === webView }) { close(tab) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let window else { return completionHandler() }
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let window else { return completionHandler(false) }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let window else { return completionHandler(nil) }
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: CGRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let window else { return completionHandler(nil) }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    /// The mode bar and Conquer as the user sees them, written as a PNG (checks):
    /// the chrome's layers, with the current page's snapshot in its place.
    func snapshot(under bar: NSView, to path: String) {
        guard let window, let root = window.contentView else { return }
        let scale = window.backingScaleFactor
        let whole = root.bounds
        func picture(_ view: NSView) -> CGImage? {
            guard let layer = view.layer, let ctx = Textures.context(Int(view.bounds.width * scale), Int(view.bounds.height * scale)) else { return nil }
            ctx.scaleBy(x: scale, y: scale)
            layer.render(in: ctx)
            return ctx.makeImage()
        }
        let chrome = picture(self), strip = picture(bar)
        let page = current?.web
        let draw = { (shot: NSImage?) in
            guard let ctx = Textures.context(Int(whole.width * scale), Int(whole.height * scale)) else { return }
            ctx.scaleBy(x: scale, y: scale)
            if let chrome { ctx.draw(chrome, in: self.frame) }
            if let strip { ctx.draw(strip, in: bar.frame) }
            if let page, let image = shot?.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                ctx.draw(image, in: root.convert(page.bounds, from: page))
            }
            guard let image = ctx.makeImage(),
                  let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)
            else { return }
            CGImageDestinationAddImage(destination, image, nil)
            CGImageDestinationFinalize(destination)
        }
        if let page { page.takeSnapshot(with: nil) { shot, _ in draw(shot) } } else { draw(nil) }
    }

    /// Conquer's state, for checks.
    func state() -> [String: Any] {
        ["tabs": tabs.map { ["url": $0.web.url?.absoluteString ?? "", "title": $0.title] },
         "current": current.flatMap { c in tabs.firstIndex(where: { $0 === c }) } ?? -1,
         "imported": imported]
    }
}
