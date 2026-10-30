import AppKit
import WebKit

/// One page of the browser. A tab can be unloaded (a closed pinned tab, or
/// one from the last launch not yet shown): it keeps its address, title and
/// icon, and makes its web view the first time it is shown.
final class BrowserTab: NSObject {
    private(set) var web: WKWebView?
    /// Where a pinned tab belongs (Back to Pinned Page returns there); nil when it isn't pinned.
    var home: URL?
    var favicon: NSImage?
    var faviconURL: URL?
    var onChange: (() -> Void)?
    private var savedURL: URL?
    private var savedTitle: String?
    private var watches: [NSKeyValueObservation] = []

    init(web: WKWebView) {
        super.init()
        attach(web)
    }

    init(url: URL?, title: String?) {
        savedURL = url
        savedTitle = title
        super.init()
    }

    var isPinned: Bool { home != nil }
    var url: URL? { web?.url ?? savedURL }
    var title: String {
        if let t = web?.title, !t.isEmpty { return t }
        if let t = savedTitle, !t.isEmpty, web?.url == nil || web?.url == savedURL { return t }
        return url?.host ?? "New Tab"
    }
    var isLoading: Bool { web?.isLoading ?? false }

    /// Its web view, made (and its address loaded) the first time it is needed;
    /// `prepare` sets it up before anything loads.
    func load(_ configuration: WKWebViewConfiguration, prepare: (WKWebView) -> Void) -> WKWebView {
        if let web { return web }
        let web = WKWebView(frame: .zero, configuration: configuration)
        attach(web)
        prepare(web)
        if let savedURL { web.load(URLRequest(url: savedURL)) }
        return web
    }

    /// Let its page go (a closed pinned tab): it keeps its place, address and title.
    func unload() {
        guard let web else { return }
        savedURL = web.url ?? savedURL
        savedTitle = title
        watches = []
        web.stopLoading()
        web.removeFromSuperview()
        self.web = nil
        onChange?()
    }

    private func attach(_ web: WKWebView) {
        web.isInspectable = true
        web.allowsBackForwardNavigationGestures = true
        web.allowsMagnification = true
        self.web = web
        let changed = { [weak self] in self?.onChange?() }
        watches = [
            web.observe(\.title) { _, _ in changed() },
            web.observe(\.url) { _, _ in changed() },
            web.observe(\.canGoBack) { _, _ in changed() },
            web.observe(\.canGoForward) { _, _ in changed() },
            web.observe(\.isLoading) { _, _ in changed() },
        ]
    }

    // MARK: Saved between launches

    func saved() -> [String: Any] {
        var d: [String: Any] = ["title": title]
        if let url, url.scheme?.hasPrefix("http") == true { d["url"] = url.absoluteString }
        if let home { d["home"] = home.absoluteString }
        if let faviconURL { d["icon"] = faviconURL.absoluteString }
        return d
    }

    static func restored(_ d: [String: Any]) -> BrowserTab {
        let tab = BrowserTab(url: (d["url"] as? String).flatMap(URL.init(string:)), title: d["title"] as? String)
        tab.home = (d["home"] as? String).flatMap(URL.init(string:))
        tab.faviconURL = (d["icon"] as? String).flatMap(URL.init(string:))
        return tab
    }
}

/// A folder of pinned tabs in the sidebar (one level, as Zen's are).
final class TabFolder: NSObject {
    var name: String
    var tabs: [BrowserTab]
    var open: Bool

    init(name: String, tabs: [BrowserTab] = [], open: Bool = true) {
        self.name = name
        self.tabs = tabs
        self.open = open
    }
}

/// The sidebar's "New Tab" row, between the pinned tabs and the others.
final class NewTabRow: NSObject {}

/// A sidebar row: the current tab sits on a raised tile, others lift on hover.
final class SidebarRowView: NSTableRowView {
    /// A line over the row (New Tab's, under the pinned tabs).
    var divider = false
    private var hovered = false

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true; hoverChanged() }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true; hoverChanged() }

    private func hoverChanged() {
        for case let cell as SidebarCell in subviews { cell.hovered = hovered }
    }

    /// The row's tile: below the divider, if it has one.
    private var tile: CGRect {
        var r = bounds.insetBy(dx: 4, dy: 1)
        if divider { r.size.height -= 10; if !isFlipped { r.origin.y = bounds.minY + 1 } else { r.origin.y += 10 } }
        return r
    }

    override func drawBackground(in dirtyRect: NSRect) {
        if divider {
            Ink.color(Ink.divider, effectiveAppearance).setFill()
            let y = isFlipped ? bounds.minY + 4 : bounds.maxY - 5
            CGRect(x: 10, y: y, width: bounds.width - 20, height: 1).fill()
        }
        guard hovered, !isSelected else { return }
        Chrome.color("row-hover", effectiveAppearance).setFill()
        NSBezierPath(roundedRect: tile, xRadius: Chrome.metric("radius-md", effectiveAppearance), yRadius: Chrome.metric("radius-md", effectiveAppearance)).fill()
    }

    override func drawSelection(in dirtyRect: NSRect) {
        Ink.color(Ink.tabFocused, effectiveAppearance).setFill()
        NSBezierPath(roundedRect: tile, xRadius: Chrome.metric("radius-md", effectiveAppearance), yRadius: Chrome.metric("radius-md", effectiveAppearance)).fill()
    }
    override var isEmphasized: Bool { get { false } set {} }
}

/// A sidebar row's contents: a tab (its icon, or a spinner while it loads, its
/// title and, on hover, ×), a folder, or New Tab.
final class SidebarCell: NSTableCellView {
    let icon = NSImageView()
    let spinner = NSProgressIndicator()
    let label = NSTextField(labelWithString: "")
    let close = ChromeButton()
    var onClose: (() -> Void)?
    var closable = false
    var chosen = false
    var hovered = false { didSet { updateClose() } }
    private func updateClose() { close.isHidden = !closable || !(hovered || chosen) }
    private var labelTone = Ink.mid
    private var labelWeight = NSFont.Weight.regular
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); restyle() }
    private func restyle() {
        label.font = Chrome.font(effectiveAppearance, weight: labelWeight)
        label.textColor = Ink.color(labelTone, effectiveAppearance)
        icon.contentTintColor = Ink.color(Ink.faint, effectiveAppearance)
        close.needsDisplay = true
    }

    override init(frame: NSRect) {
        super.init(frame: frame)
        icon.imageScaling = .scaleProportionallyUpOrDown
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        label.font = .systemFont(ofSize: 12)
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        close.configure(symbol: "xmark", help: "Close tab (⌘W)", compact: true)
        close.target = self
        close.action = #selector(closeTab)
        close.isHidden = true
        for v in [icon, spinner, label, close] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        imageView = icon
        textField = label
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 16),
            icon.heightAnchor.constraint(equalToConstant: 16),
            spinner.centerXAnchor.constraint(equalTo: icon.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: icon.centerYAnchor),
            spinner.widthAnchor.constraint(equalToConstant: 14),
            spinner.heightAnchor.constraint(equalToConstant: 14),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            close.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 4),
            close.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            close.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func closeTab() { onClose?() }

    func show(tab: BrowserTab, current: Bool) {
        chosen = current
        closable = true
        label.stringValue = tab.title
        toolTip = tab.url?.absoluteString
        labelWeight = current ? .medium : .regular
        labelTone = current ? Ink.strong : Ink.mid
        // An unloaded tab (closed pinned, or not yet shown) is dimmed.
        label.alphaValue = tab.web == nil && !current ? 0.7 : 1
        if tab.isLoading {
            icon.image = nil
            spinner.startAnimation(nil)
        } else {
            spinner.stopAnimation(nil)
            icon.image = tab.favicon ?? NSImage(systemSymbolName: "globe", accessibilityDescription: nil)
        }
        restyle()
        updateClose()
    }

    func show(folder: TabFolder) {
        chosen = false
        closable = false
        spinner.stopAnimation(nil)
        labelWeight = .medium
        labelTone = Ink.mid
        label.stringValue = folder.name
        toolTip = nil
        label.alphaValue = 1
        icon.image = NSImage(systemSymbolName: folder.open ? "folder" : "folder.fill", accessibilityDescription: "Folder")
        icon.contentTintColor = Ink.color(Ink.faint, effectiveAppearance)
        restyle()
        updateClose()
    }

    func showNewTab() {
        chosen = false
        closable = false
        spinner.stopAnimation(nil)
        labelWeight = .regular
        labelTone = Ink.faint
        label.stringValue = "New Tab"
        toolTip = "New tab (⌘T)"
        label.alphaValue = 1
        icon.image = NSImage(systemSymbolName: "plus", accessibilityDescription: nil)
        icon.contentTintColor = Ink.color(Ink.faint, effectiveAppearance)
        restyle()
        updateClose()
    }
}

/// The sidebar's list of pinned tabs and folders, New Tab, and the other tabs.
final class SidebarOutline: NSOutlineView {
    // Folders' triangles sit in the icon's column, not indenting the top level.
    override func frameOfOutlineCell(atRow row: Int) -> NSRect {
        var frame = super.frameOfOutlineCell(atRow: row)
        if level(forRow: row) == 0 { frame.origin.x = bounds.width - frame.width - 6 }
        return frame
    }
    override func frameOfCell(atColumn column: Int, row: Int) -> NSRect {
        var frame = super.frameOfCell(atColumn: column, row: row)
        let indent = CGFloat(level(forRow: row)) * indentationPerLevel
        frame.origin.x = 6 + indent
        frame.size.width = bounds.width - 12 - indent - (item(atRow: row) is TabFolder ? 18 : 0)
        // New Tab under the pinned tabs sits below its divider.
        if item(atRow: row) is NewTabRow, frame.height > 34 { frame.origin.y += 10; frame.size.height -= 10 }
        return frame
    }
}
