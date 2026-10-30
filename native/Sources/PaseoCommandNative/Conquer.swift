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
/// It stands in for the hidden title bar: the traffic lights sit at its left, it drags the
/// window, and it says when a newer build is waiting for ⌘R. It is the same surface as the
/// chrome under it (the page's panel header, Conquer's sidebar), with no line between them,
/// and its tabs are a small segmented control rather than a tab bar.
final class ModeBar: NSView {
    var onSelect: ((Mode) -> Void)?
    var mode: Mode = .command { didSet { restyle() } }
    /// Where the tabs start: past the traffic lights.
    var leading: CGFloat = 0 { didSet { rowLeading?.constant = leading } }
    var updateReady = false { didSet { if updateReady != oldValue { update.isHidden = !updateReady } } }
    private var rowLeading: NSLayoutConstraint?
    private let update = NSTextField(labelWithString: "Update ready · ⌘R")
    private let buttons: [(Mode, ModeButton)]
    /// The control's track, behind both tabs.
    private let track = NSStackView()

    override init(frame: NSRect) {
        buttons = [(.command, ModeButton()), (.conquer, ModeButton())]
        super.init(frame: frame)
        wantsLayer = true
        track.orientation = .horizontal
        track.spacing = 2
        track.edgeInsets = NSEdgeInsets(top: 2, left: 2, bottom: 2, right: 2)
        track.wantsLayer = true
        track.layer?.cornerRadius = 8
        track.translatesAutoresizingMaskIntoConstraints = false
        for (mode, button) in buttons {
            button.isBordered = false
            button.wantsLayer = true
            button.layer?.cornerRadius = 6
            button.target = self
            button.action = #selector(pick(_:))
            button.tag = mode == .command ? 0 : 1
            button.toolTip = mode == .command ? "The map and panels (⌘`)" : "The browser (⌘`)"
            let symbol = NSImage(systemSymbolName: mode == .command ? "map" : "globe", accessibilityDescription: nil)
            button.image = symbol?.withSymbolConfiguration(.init(pointSize: 11, weight: .medium))
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
            button.onHover = { [weak self] _ in self?.restyle() }
            button.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                button.heightAnchor.constraint(equalToConstant: 20),
                button.widthAnchor.constraint(greaterThanOrEqualToConstant: 92),
            ])
            track.addArrangedSubview(button)
        }
        addSubview(track)
        update.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        update.toolTip = "A newer build is ready: ⌘R applies it"
        update.isHidden = true
        update.translatesAutoresizingMaskIntoConstraints = false
        addSubview(update)
        let rowLeading = track.leadingAnchor.constraint(equalTo: leadingAnchor, constant: leading)
        self.rowLeading = rowLeading
        NSLayoutConstraint.activate([
            rowLeading,
            track.centerYAnchor.constraint(equalTo: centerYAnchor),
            update.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            update.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func pick(_ sender: NSButton) { onSelect?(sender.tag == 0 ? .command : .conquer) }

    // As a title bar: drag to move the window, double-click as System Settings says.
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseUp(with event: NSEvent) {
        guard event.clickCount == 2, let window else { return super.mouseUp(with: event) }
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": window.performMiniaturize(nil)
        case "None": break
        default: window.performZoom(nil)
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }

    /// Dark or light with the system, as the page's panels are.
    private func restyle() {
        let look = effectiveAppearance
        layer?.backgroundColor = Ink.color(Ink.base, look).cgColor
        track.layer?.backgroundColor = Ink.color(Ink.tabShown, look).cgColor
        update.textColor = Ink.color(Ink.accent, look)
        for (mode, button) in buttons {
            let on = mode == self.mode
            button.layer?.backgroundColor = on ? Ink.color(Ink.pane, look).cgColor
                : button.hovered ? Ink.color(Ink.tabFocused, look, 0.6).cgColor : nil
            button.layer?.shadowOpacity = on ? 0.12 : 0
            button.layer?.shadowRadius = 1.5
            button.layer?.shadowOffset = CGSize(width: 0, height: -0.5)
            let ink = Ink.color(on ? Ink.strong : button.hovered ? Ink.mid : Ink.off, look)
            button.contentTintColor = ink
            button.attributedTitle = NSAttributedString(string: mode == .command ? " Command" : " Conquer", attributes: [
                .font: NSFont.systemFont(ofSize: 12, weight: on ? .semibold : .medium),
                .foregroundColor: ink,
            ])
        }
    }
}

/// Conquer: a browser signed in with Zen Browser's cookies (see `ZenCookies`),
/// keeping a cookie store of its own between launches. A sidebar as in Zen and
/// Arc (the address bar, pinned tabs and their folders, New Tab, the other
/// tabs) beside the page.
final class ConquerView: NSView, WKNavigationDelegate, WKUIDelegate, NSTextFieldDelegate, WKDownloadDelegate,
                         NSOutlineViewDataSource, NSOutlineViewDelegate, NSSplitViewDelegate, NSMenuDelegate {
    /// A browser command: the Conquer menu lists these, and Conquer takes their
    /// keys before the page does (a page's editor would keep ⌘E, say).
    struct Command {
        let title: String
        let name: String
        let key: String
        let mods: NSEvent.ModifierFlags
        var hidden = false
    }
    static let commands: [Command?] = [
        Command(title: "New Tab", name: "newTab", key: "t", mods: .command),
        Command(title: "Reopen Closed Tab", name: "reopen", key: "t", mods: [.command, .shift]),
        Command(title: "Close Tab", name: "closeTab", key: "w", mods: .command),
        Command(title: "Open Location…", name: "openLocation", key: "l", mods: .command),
        nil,
        Command(title: "Back", name: "back", key: "[", mods: .command),
        Command(title: "Forward", name: "forward", key: "]", mods: .command),
        Command(title: "Next Tab", name: "nextTab", key: "e", mods: .command),
        Command(title: "Next Tab", name: "nextTab", key: "\t", mods: .control, hidden: true),
        Command(title: "Previous Tab", name: "previousTab", key: "\t", mods: [.control, .shift]),
        nil,
        Command(title: "Pin Tab", name: "togglePin", key: "d", mods: .command),
        Command(title: "New Folder", name: "newFolder", key: "", mods: []),
        nil,
        Command(title: "Find…", name: "find", key: "f", mods: .command),
        Command(title: "Find Next", name: "findNext", key: "g", mods: .command),
        Command(title: "Find Previous", name: "findPrevious", key: "g", mods: [.command, .shift]),
        nil,
        Command(title: "Zoom In", name: "zoomIn", key: "+", mods: .command),
        Command(title: "Zoom In", name: "zoomIn", key: "=", mods: .command, hidden: true),
        Command(title: "Zoom Out", name: "zoomOut", key: "-", mods: .command),
        Command(title: "Actual Size", name: "zoomReset", key: "0", mods: .command),
        nil,
        Command(title: "Print…", name: "print", key: "p", mods: .command),
        Command(title: "Downloads", name: "downloads", key: "j", mods: [.command, .shift]),
        Command(title: "Import Zen Cookies", name: "importCookies", key: "", mods: []),
    ] + (1...9).map { n in Command(title: n == 9 ? "Last Tab" : "Tab \(n)", name: "tab\(n)", key: "\(n)", mods: .command, hidden: true) }

    private let configuration = WKWebViewConfiguration()
    /// Pinned tabs and folders, in the sidebar's order.
    private(set) var pinned: [NSObject] = []
    /// The other tabs, under New Tab.
    private(set) var tabs: [BrowserTab] = []
    private(set) var current: BrowserTab?
    private let newTabRow = NewTabRow()
    /// Closed tabs, newest last, for Reopen Closed Tab (⇧⌘T).
    private var closed: [(url: URL, title: String)] = []
    private let history: ConquerHistory
    let downloads = ConquerDownloads()
    private lazy var downloadsList = DownloadsController(downloads)
    private let popover = NSPopover()
    private let suggestions = SuggestionList()
    private let split = NSSplitView()
    private let sidebar = NSView()
    private let outline = SidebarOutline()
    private let findBar = FindBar()
    private var findHeight: NSLayoutConstraint!
    private let body = NSView()
    private let back = NSButton()
    private let forward = NSButton()
    private let reloadButton = NSButton()
    private let folderButton = NSButton()
    private let downloadsButton = NSButton()
    private let address = NSTextField()
    /// The last cookie import, for the menu and checks.
    private(set) var imported = "not yet"
    private var restored = false
    /// Tabs, zoom and history come back on the next launch (checks keep theirs to themselves).
    private let remember: Bool
    private var dragged: NSObject?
    private var rendering = false
    private var placedSidebar = false
    private var saving: DispatchWorkItem?
    private var icons: [URL: NSImage] = [:]
    /// Each site's zoom, by host (check runs keep it in memory).
    private var zooms: [String: Double] = [:]
    private static let zoomSteps: [Double] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
    private static let dragType = NSPasteboard.PasteboardType("com.paseo.command.conquer-tab")

    init(frame: NSRect, persistent: Bool) {
        remember = persistent
        history = ConquerHistory(persistent: persistent)
        // A store of its own, kept on disk: Command's page keeps its own.
        configuration.websiteDataStore = persistent ? WKWebsiteDataStore(forIdentifier: Self.store) : .nonPersistent()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        // As Safari names itself, so sites treat it as a browser rather than an embedded view.
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        configuration.applicationNameForUserAgent = "Version/\(major >= 26 ? major : 18).0 Safari/605.1.15"
        if persistent { zooms = UserDefaults.standard.dictionary(forKey: "conquerZoom") as? [String: Double] ?? [:] }
        super.init(frame: frame)
        // Its chrome and its pages' prefers-color-scheme follow the system.
        wantsLayer = true
        layer?.backgroundColor = background.cgColor

        split.isVertical = true
        split.dividerStyle = .thin
        split.delegate = self
        split.frame = bounds
        split.autoresizingMask = [.width, .height]
        addSubview(split)
        let page = NSView()
        split.addArrangedSubview(sidebar)
        split.addArrangedSubview(page)
        split.setHoldingPriority(.defaultHigh, forSubviewAt: 0)
        split.setHoldingPriority(.defaultLow, forSubviewAt: 1)

        // The sidebar: back, forward and reload; the address; the tabs; New Folder and Downloads.
        for (button, symbol, help, action) in [(back, "chevron.left", "Back (⌘[)", #selector(goBack)),
                                               (forward, "chevron.right", "Forward (⌘])", #selector(goForward)),
                                               (reloadButton, "arrow.clockwise", "Reload (⌘R)", #selector(reloadPage)),
                                               (folderButton, "folder.badge.plus", "New folder for pinned tabs", #selector(newFolder)),
                                               (downloadsButton, "arrow.down.circle", "Downloads (⇧⌘J)", #selector(toggleDownloads))] {
            button.bezelStyle = .accessoryBarAction
            button.controlSize = .small
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: help)
            button.toolTip = help
            button.target = self
            button.action = action
        }
        let nav = NSStackView(views: [back, forward, reloadButton, NSView()])
        nav.orientation = .horizontal
        nav.spacing = 2
        address.placeholderString = "Search or enter address"
        address.font = .systemFont(ofSize: 12)
        address.bezelStyle = .roundedBezel
        address.focusRingType = .none
        address.lineBreakMode = .byTruncatingTail
        address.cell?.isScrollable = true
        address.cell?.wraps = false
        address.delegate = self
        address.target = self
        address.action = #selector(submitAddress)
        suggestions.onChoose = { [weak self] url in self?.go(to: url) }

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("tab"))
        column.resizingMask = .autoresizingMask
        outline.addTableColumn(column)
        outline.outlineTableColumn = column
        outline.headerView = nil
        outline.style = .plain
        outline.rowHeight = 30
        outline.indentationPerLevel = 14
        outline.intercellSpacing = NSSize(width: 0, height: 2)
        outline.backgroundColor = .clear
        outline.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
        outline.dataSource = self
        outline.delegate = self
        outline.target = self
        outline.action = #selector(rowClicked)
        outline.registerForDraggedTypes([Self.dragType])
        outline.setDraggingSourceOperationMask(.move, forLocal: true)
        outline.draggingDestinationFeedbackStyle = .regular
        let menu = NSMenu()
        menu.delegate = self
        outline.menu = menu
        let scroll = NSScrollView()
        scroll.documentView = outline
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        let footer = NSStackView(views: [folderButton, NSView(), downloadsButton])
        footer.orientation = .horizontal
        for v in [nav, address, scroll, footer] {
            v.translatesAutoresizingMaskIntoConstraints = false
            sidebar.addSubview(v)
        }

        // The page, under the find bar while it shows.
        findBar.isHidden = true
        findBar.onFind = { [weak self] text, backwards in self?.find(text, backwards: backwards) }
        findBar.onClose = { [weak self] in self?.closeFind() }
        for v in [findBar, body] {
            v.translatesAutoresizingMaskIntoConstraints = false
            page.addSubview(v)
        }
        findHeight = findBar.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            nav.topAnchor.constraint(equalTo: sidebar.topAnchor, constant: 6),
            nav.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 6),
            nav.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -6),
            address.topAnchor.constraint(equalTo: nav.bottomAnchor, constant: 6),
            address.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 8),
            address.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -8),
            scroll.topAnchor.constraint(equalTo: address.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -4),
            footer.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 6),
            footer.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -6),
            footer.bottomAnchor.constraint(equalTo: sidebar.bottomAnchor, constant: -6),
            findBar.topAnchor.constraint(equalTo: page.topAnchor),
            findBar.leadingAnchor.constraint(equalTo: page.leadingAnchor),
            findBar.trailingAnchor.constraint(equalTo: page.trailingAnchor),
            findHeight,
            body.topAnchor.constraint(equalTo: findBar.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: page.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: page.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: page.bottomAnchor),
        ])

        popover.behavior = .transient
        popover.contentViewController = downloadsList
        downloads.onChange = { [weak self] in self?.downloadsChanged() }
        renderBar()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var background: NSColor { Ink.color(Ink.base, effectiveAppearance) }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        layer?.backgroundColor = background.cgColor
        renderSidebar()
    }

    /// The sidebar at the width it was left (once the split has its size).
    private func placeSidebar() {
        guard !placedSidebar, split.bounds.width > 0 else { return }
        placedSidebar = true
        let saved = UserDefaults.standard.double(forKey: "conquerSidebar")
        split.adjustSubviews()
        split.setPosition(saved > 0 ? saved : 240, ofDividerAt: 0)
    }

    /// Conquer's cookie store's identity, the same every launch.
    private static let store = UUID(uuidString: "C0A9B6E2-5F1D-4C3E-9A71-2D8E4B6F0C15")!

    /// The first time Conquer shows: Zen's cookies first, then the tabs from last time.
    func start() {
        guard !restored else { return }
        restored = true
        placeSidebar()
        importZenCookies { [weak self] in
            guard let self else { return }
            let chosen = self.restore()
            if let chosen { self.select(chosen) } else if self.current == nil { self.newTab() }
            self.renderSidebar()
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

    /// The page takes the keyboard, or the address bar on a blank tab.
    func focusPage() {
        if let web = current?.web, web.url != nil { window?.makeFirstResponder(web) } else { focusAddress() }
    }

    // MARK: Commands

    /// Run a browser command by name (the menu, its keys, and checks).
    func perform(_ name: String) {
        switch name {
        case "newTab": newTab()
        case "reopen": reopen()
        case "closeTab": closeTab()
        case "openLocation": focusAddress()
        case "back": goBack()
        case "forward": goForward()
        case "nextTab": cycle(1)
        case "previousTab": cycle(-1)
        case "togglePin": if let current { togglePin(current) }
        case "newFolder": newFolder()
        case "find": showFind()
        case "findNext": findAgain(backwards: false)
        case "findPrevious": findAgain(backwards: true)
        case "zoomIn": zoom(1)
        case "zoomOut": zoom(-1)
        case "zoomReset": zoom(0)
        case "print": printPage()
        case "downloads": toggleDownloads()
        case "importCookies": importFromMenu()
        default:
            if name.hasPrefix("tab"), let n = Int(name.dropFirst(3)) { selectTab(n) }
        }
    }

    /// Conquer's keys come before the page's, as a browser's do.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard !isHiddenOrHasHiddenAncestor, event.type == .keyDown, let key = event.charactersIgnoringModifiers else {
            return super.performKeyEquivalent(with: event)
        }
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        for case let c? in Self.commands where !c.key.isEmpty {
            let hit = c.key == "+" || c.key == "="
                ? (key == "+" || key == "=") && flags.subtracting(.shift) == .command
                : key.lowercased() == c.key && flags == c.mods
            if hit { perform(c.name); return true }
        }
        return super.performKeyEquivalent(with: event)
    }

    // MARK: Tabs

    /// Every tab in the sidebar's order: pinned (with their folders'), then the others.
    var allTabs: [BrowserTab] {
        pinned.flatMap { item -> [BrowserTab] in (item as? TabFolder)?.tabs ?? [item as! BrowserTab] } + tabs
    }

    private enum Spot {
        case pinned(Int)
        case folder(TabFolder, Int)
        case tabs(Int)
    }

    private func spot(of tab: BrowserTab) -> Spot? {
        if let i = tabs.firstIndex(of: tab) { return .tabs(i) }
        for (i, item) in pinned.enumerated() {
            if item === tab { return .pinned(i) }
            if let f = item as? TabFolder, let j = f.tabs.firstIndex(of: tab) { return .folder(f, j) }
        }
        return nil
    }

    private func remove(_ tab: BrowserTab) {
        switch spot(of: tab) {
        case .pinned(let i): pinned.remove(at: i)
        case .folder(let f, let i): f.tabs.remove(at: i)
        case .tabs(let i): tabs.remove(at: i)
        case nil: break
        }
    }

    private func adopt(_ tab: BrowserTab) {
        tab.onChange = { [weak self, weak tab] in
            guard let self, let tab else { return }
            let row = self.outline.row(forItem: tab)
            if row >= 0 { self.outline.reloadData(forRowIndexes: [row], columnIndexes: [0]) }
            if tab === self.current { self.renderBar() }
            if let url = tab.web?.url, let title = tab.web?.title { self.history.retitle(url, title) }
            self.scheduleSave()
        }
    }

    private func prepare(_ web: WKWebView) {
        web.navigationDelegate = self
        web.uiDelegate = self
    }

    @discardableResult
    func open(_ url: URL, select chosen: Bool = true, afterCurrent: Bool = false) -> BrowserTab {
        let tab = BrowserTab(url: url, title: nil)
        adopt(tab)
        if afterCurrent, let current, let i = tabs.firstIndex(of: current) { tabs.insert(tab, at: i + 1) } else { tabs.append(tab) }
        if chosen || current == nil { select(tab) } else { _ = tab.load(configuration) { prepare($0) }; renderSidebar() }
        scheduleSave()
        return tab
    }

    /// A blank tab, with the address bar ready (⌘T).
    @objc func newTab() {
        let tab = BrowserTab(url: nil, title: nil)
        adopt(tab)
        tabs.append(tab)
        select(tab)
        focusAddress()
    }

    /// Close the current tab (⌘W). A pinned tab only lets its page go.
    @objc func closeTab() {
        guard let current else { return }
        close(current)
    }

    private func close(_ tab: BrowserTab) {
        if tab === current { selectNeighbour(of: tab) }
        if tab.isPinned {
            tab.unload()
        } else {
            if let url = tab.url, url.scheme?.hasPrefix("http") == true {
                closed.append((url, tab.title))
                if closed.count > 30 { closed.removeFirst() }
            }
            tab.web?.stopLoading()
            tab.web?.removeFromSuperview()
            remove(tab)
        }
        if allTabs.isEmpty || current == nil || current === tab { newTab() }
        renderSidebar()
        scheduleSave()
    }

    /// After closing `tab`: the next tab below it among the others, else above;
    /// for a pinned tab, the nearest open one (rather than loading another pinned page).
    private func selectNeighbour(of tab: BrowserTab) {
        if !tab.isPinned, let i = tabs.firstIndex(of: tab) {
            let rest = tabs.enumerated().filter { $0.offset != i }.map(\.element)
            if !rest.isEmpty { return select(rest[min(i, rest.count - 1)]) }
        }
        let all = allTabs
        guard let i = all.firstIndex(of: tab) else { return }
        let near = all.indices.filter { $0 != i }.sorted { abs($0 - i) < abs($1 - i) }.map { all[$0] }
        if let open = near.first(where: { $0.web != nil }) { select(open) } else if let other = tabs.last(where: { $0 !== tab }) { select(other) }
    }

    /// Reopen the last closed tab (⇧⌘T).
    func reopen() {
        guard let last = closed.popLast() else { return NSSound.beep() }
        open(last.url)
    }

    func select(_ tab: BrowserTab) {
        if current !== tab { current?.web?.removeFromSuperview() }
        current = tab
        let web = tab.load(configuration) { prepare($0) }
        if web.superview !== body {
            web.frame = body.bounds
            web.autoresizingMask = [.width, .height]
            body.addSubview(web)
        }
        if case .folder(let f, _) = spot(of: tab), !f.open { f.open = true }
        if !findBar.isHidden { closeFind() }
        renderSidebar()
        renderBar()
        scheduleSave()
        if web.url != nil { window?.makeFirstResponder(web) }
    }

    /// Step through the tabs in the sidebar's order (⌘E, ⌃Tab, ⌃⇧Tab).
    func cycle(_ step: Int) {
        let all = allTabs
        guard let current, let i = all.firstIndex(of: current), all.count > 1 else { return }
        select(all[(i + step + all.count) % all.count])
    }

    /// Go to the `number`th tab (⌘1…⌘8); 9 is the last, as in other browsers.
    func selectTab(_ number: Int) {
        let all = allTabs
        guard !all.isEmpty else { return }
        let i = number == 9 ? all.count - 1 : number - 1
        if all.indices.contains(i), all[i] !== current { select(all[i]) }
    }

    // MARK: Pinned tabs and folders

    /// Pin a tab at its page, or unpin it to the top of the others (⌘D).
    func togglePin(_ tab: BrowserTab) {
        if tab.isPinned {
            remove(tab)
            tab.home = nil
            tabs.insert(tab, at: 0)
        } else {
            guard let url = tab.url, url.scheme?.hasPrefix("http") == true else { return NSSound.beep() }
            remove(tab)
            tab.home = url
            pinned.append(tab)
        }
        renderSidebar()
        scheduleSave()
    }

    /// A new folder at the end of the pinned tabs, named at once.
    @objc func newFolder() {
        let folder = TabFolder(name: "New Folder")
        pinned.append(folder)
        renderSidebar()
        scheduleSave()
        rename(folder)
    }

    private func rename(_ folder: TabFolder) {
        guard let window else { return }
        let alert = NSAlert()
        alert.messageText = "Folder name"
        let field = NSTextField(frame: CGRect(x: 0, y: 0, width: 240, height: 24))
        field.stringValue = folder.name
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { [weak self] response in
            let name = field.stringValue.trimmingCharacters(in: .whitespaces)
            guard response == .alertFirstButtonReturn, !name.isEmpty else { return }
            folder.name = name
            self?.renderSidebar()
            self?.scheduleSave()
        }
    }

    /// Remove a folder; its tabs stay pinned where it was.
    private func deleteFolder(_ folder: TabFolder) {
        guard let i = pinned.firstIndex(of: folder) else { return }
        pinned.replaceSubrange(i...i, with: folder.tabs as [NSObject])
        renderSidebar()
        scheduleSave()
    }

    private func move(_ tab: BrowserTab, into folder: TabFolder) {
        guard tab.url?.scheme?.hasPrefix("http") == true else { return NSSound.beep() }
        remove(tab)
        tab.home = tab.home ?? tab.url
        folder.tabs.append(tab)
        folder.open = true
        renderSidebar()
        scheduleSave()
    }

    // MARK: Sidebar

    func renderSidebar() {
        rendering = true
        defer { rendering = false }
        outline.reloadData()
        for case let f as TabFolder in pinned {
            if f.open { outline.expandItem(f) } else { outline.collapseItem(f) }
        }
        let row = current.map { outline.row(forItem: $0) } ?? -1
        if row >= 0 { outline.selectRowIndexes([row], byExtendingSelection: false) } else { outline.deselectAll(nil) }
    }

    func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int {
        if let f = item as? TabFolder { return f.tabs.count }
        return item == nil ? pinned.count + 1 + tabs.count : 0
    }

    func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any {
        if let f = item as? TabFolder { return f.tabs[index] }
        if index < pinned.count { return pinned[index] }
        if index == pinned.count { return newTabRow }
        return tabs[index - pinned.count - 1]
    }

    func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool { item is TabFolder }

    func outlineView(_ outlineView: NSOutlineView, viewFor tableColumn: NSTableColumn?, item: Any) -> NSView? {
        let id = NSUserInterfaceItemIdentifier("cell")
        let cell = outlineView.makeView(withIdentifier: id, owner: self) as? SidebarCell ?? SidebarCell(frame: .zero)
        cell.identifier = id
        cell.onClose = nil
        switch item {
        case let tab as BrowserTab:
            cell.show(tab: tab, current: tab === current)
            cell.onClose = { [weak self, weak tab] in if let tab { self?.close(tab) } }
        case let folder as TabFolder: cell.show(folder: folder)
        default: cell.showNewTab()
        }
        return cell
    }

    func outlineView(_ outlineView: NSOutlineView, rowViewForItem item: Any) -> NSTableRowView? {
        let row = SidebarRowView()
        row.divider = item is NewTabRow && !pinned.isEmpty
        return row
    }

    func outlineView(_ outlineView: NSOutlineView, heightOfRowByItem item: Any) -> CGFloat {
        item is NewTabRow && !pinned.isEmpty ? 40 : 30
    }

    func outlineView(_ outlineView: NSOutlineView, shouldSelectItem item: Any) -> Bool { item is BrowserTab }

    func outlineViewSelectionDidChange(_ notification: Notification) {
        guard !rendering, let tab = outline.item(atRow: outline.selectedRow) as? BrowserTab, tab !== current else { return }
        select(tab)
    }

    func outlineViewItemDidExpand(_ notification: Notification) { folderToggled(notification, open: true) }
    func outlineViewItemDidCollapse(_ notification: Notification) { folderToggled(notification, open: false) }

    private func folderToggled(_ notification: Notification, open: Bool) {
        guard !rendering, let folder = notification.userInfo?["NSObject"] as? TabFolder else { return }
        folder.open = open
        let row = outline.row(forItem: folder)
        if row >= 0 { outline.reloadData(forRowIndexes: [row], columnIndexes: [0]) }
        scheduleSave()
    }

    /// A click: New Tab opens one, a folder opens or closes.
    @objc private func rowClicked() {
        let item = outline.item(atRow: outline.clickedRow)
        if item is NewTabRow { newTab() }
        if let folder = item as? TabFolder {
            if outline.isItemExpanded(folder) { outline.animator().collapseItem(folder) } else { outline.animator().expandItem(folder) }
        }
    }

    // Dragging: tabs reorder, pin (above New Tab), unpin (below it) and go in and out of folders; folders reorder among the pinned.

    func outlineView(_ outlineView: NSOutlineView, pasteboardWriterForItem item: Any) -> NSPasteboardWriting? {
        guard item is BrowserTab || item is TabFolder else { return nil }
        let p = NSPasteboardItem()
        p.setString("tab", forType: Self.dragType)
        return p
    }

    func outlineView(_ outlineView: NSOutlineView, draggingSession session: NSDraggingSession, willBeginAt screenPoint: NSPoint, forItems draggedItems: [Any]) {
        dragged = draggedItems.first as? NSObject
    }

    func outlineView(_ outlineView: NSOutlineView, draggingSession session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        dragged = nil
    }

    func outlineView(_ outlineView: NSOutlineView, validateDrop info: NSDraggingInfo, proposedItem item: Any?, proposedChildIndex index: Int) -> NSDragOperation {
        guard let dragged else { return [] }
        let pinnable = (dragged as? BrowserTab)?.url?.scheme?.hasPrefix("http") == true
        if item is TabFolder { return pinnable ? .move : [] }
        guard item == nil, index != NSOutlineViewDropOnItemIndex else { return [] }
        if dragged is TabFolder { return index <= pinned.count ? .move : [] }
        return index <= pinned.count && !pinnable ? [] : .move
    }

    func outlineView(_ outlineView: NSOutlineView, acceptDrop info: NSDraggingInfo, item: Any?, childIndex index: Int) -> Bool {
        guard let dragged else { return false }
        return drop(dragged, on: item, at: index)
    }

    /// Put a dragged tab or folder at `index` among `item`'s children (nil: the top level,
    /// where New Tab divides the pinned from the others; -1 on a folder: its end).
    private func drop(_ dragged: NSObject, on item: Any?, at index: Int) -> Bool {
        if let folder = dragged as? TabFolder {
            guard let from = pinned.firstIndex(of: folder) else { return false }
            pinned.remove(at: from)
            pinned.insert(folder, at: min(from < index ? index - 1 : index, pinned.count))
        } else if let tab = dragged as? BrowserTab {
            var to: Spot
            if let folder = item as? TabFolder { to = .folder(folder, index < 0 ? folder.tabs.count : index) }
            else if index <= pinned.count { to = .pinned(index) }
            else { to = .tabs(index - pinned.count - 1) }
            // Moving down within the same list: it leaves a gap above where it lands.
            switch (spot(of: tab), to) {
            case (.pinned(let a)?, .pinned(let b)) where a < b: to = .pinned(b - 1)
            case (.folder(let f, let a)?, .folder(let g, let b)) where f === g && a < b: to = .folder(g, b - 1)
            case (.tabs(let a)?, .tabs(let b)) where a < b: to = .tabs(b - 1)
            default: break
            }
            remove(tab)
            switch to {
            case .pinned(let i):
                tab.home = tab.home ?? tab.url
                pinned.insert(tab, at: min(i, pinned.count))
            case .folder(let f, let i):
                tab.home = tab.home ?? tab.url
                f.tabs.insert(tab, at: min(i, f.tabs.count))
                f.open = true
            case .tabs(let i):
                tab.home = nil
                tabs.insert(tab, at: min(i, tabs.count))
            }
        }
        renderSidebar()
        scheduleSave()
        return true
    }

    // The right-click menu of the row clicked.

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        func add(_ title: String, _ action: Selector, _ object: Any? = nil) {
            let item = menu.addItem(withTitle: title, action: action, keyEquivalent: "")
            item.target = self
            item.representedObject = object
        }
        let item = outline.clickedRow >= 0 ? outline.item(atRow: outline.clickedRow) : nil
        if let tab = item as? BrowserTab {
            add(tab.isPinned ? "Unpin Tab" : "Pin Tab", #selector(menuTogglePin(_:)), tab)
            if tab.isPinned, let home = tab.home, home != tab.url { add("Back to Pinned Page", #selector(menuGoHome(_:)), tab) }
            let folders = pinned.compactMap { $0 as? TabFolder }
            let into = NSMenu()
            for f in folders {
                let i = into.addItem(withTitle: f.name, action: #selector(menuMoveToFolder(_:)), keyEquivalent: "")
                i.target = self
                i.representedObject = [tab, f]
            }
            if !folders.isEmpty { into.addItem(.separator()) }
            let fresh = into.addItem(withTitle: "New Folder…", action: #selector(menuMoveToNewFolder(_:)), keyEquivalent: "")
            fresh.target = self
            fresh.representedObject = tab
            menu.addItem(withTitle: "Move to Folder", action: nil, keyEquivalent: "").submenu = into
            menu.addItem(.separator())
            add("Duplicate Tab", #selector(menuDuplicate(_:)), tab)
            add("Copy Link", #selector(menuCopyLink(_:)), tab)
            menu.addItem(.separator())
            add(tab.isPinned ? "Close Pinned Page" : "Close Tab", #selector(menuClose(_:)), tab)
        } else if let folder = item as? TabFolder {
            add("Rename Folder…", #selector(menuRename(_:)), folder)
            add("Delete Folder", #selector(menuDeleteFolder(_:)), folder)
        }
        if menu.numberOfItems > 0 { menu.addItem(.separator()) }
        add("New Folder", #selector(newFolder))
    }

    @objc private func menuTogglePin(_ sender: NSMenuItem) { if let tab = sender.representedObject as? BrowserTab { togglePin(tab) } }
    @objc private func menuGoHome(_ sender: NSMenuItem) {
        guard let tab = sender.representedObject as? BrowserTab, let home = tab.home else { return }
        if tab !== current { select(tab) }
        tab.web?.load(URLRequest(url: home))
    }
    @objc private func menuMoveToFolder(_ sender: NSMenuItem) {
        guard let pair = sender.representedObject as? [NSObject], let tab = pair.first as? BrowserTab, let folder = pair.last as? TabFolder else { return }
        move(tab, into: folder)
    }
    @objc private func menuMoveToNewFolder(_ sender: NSMenuItem) {
        guard let tab = sender.representedObject as? BrowserTab else { return }
        let folder = TabFolder(name: "New Folder")
        pinned.append(folder)
        move(tab, into: folder)
        rename(folder)
    }
    @objc private func menuDuplicate(_ sender: NSMenuItem) {
        if let url = (sender.representedObject as? BrowserTab)?.url { open(url, afterCurrent: true) }
    }
    @objc private func menuCopyLink(_ sender: NSMenuItem) {
        guard let url = (sender.representedObject as? BrowserTab)?.url else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
    }
    @objc private func menuClose(_ sender: NSMenuItem) { if let tab = sender.representedObject as? BrowserTab { close(tab) } }
    @objc private func menuRename(_ sender: NSMenuItem) { if let f = sender.representedObject as? TabFolder { rename(f) } }
    @objc private func menuDeleteFolder(_ sender: NSMenuItem) { if let f = sender.representedObject as? TabFolder { deleteFolder(f) } }

    // The sidebar's width, kept between launches.

    func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat { 180 }
    func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposedMaximumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
        min(420, splitView.bounds.width - 320)
    }
    func splitViewDidResizeSubviews(_ notification: Notification) {
        guard placedSidebar, remember, sidebar.frame.width > 0 else { return }
        UserDefaults.standard.set(Double(sidebar.frame.width), forKey: "conquerSidebar")
    }

    // MARK: Bar

    private func renderBar() {
        let web = current?.web
        back.isEnabled = web?.canGoBack ?? false
        forward.isEnabled = web?.canGoForward ?? false
        reloadButton.image = NSImage(systemSymbolName: web?.isLoading == true ? "xmark" : "arrow.clockwise",
                                     accessibilityDescription: web?.isLoading == true ? "Stop" : "Reload")
        // Leave what's being typed alone.
        if address.currentEditor() == nil { address.stringValue = current?.url?.absoluteString ?? "" }
    }

    // MARK: Saved between launches

    private func scheduleSave() {
        guard remember, restored else { return }
        saving?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.save() }
        saving = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    private func save() {
        if let data = try? JSONSerialization.data(withJSONObject: encodedState()) { UserDefaults.standard.set(data, forKey: "conquerState") }
    }

    private func encodedState() -> [String: Any] {
        let kept = tabs.filter { $0.url?.scheme?.hasPrefix("http") == true }
        let order = pinned.flatMap { ($0 as? TabFolder)?.tabs ?? [$0 as! BrowserTab] } + kept
        let state: [String: Any] = [
            "pinned": pinned.map { item -> [String: Any] in
                if let f = item as? TabFolder { return ["folder": f.name, "open": f.open, "tabs": f.tabs.map { $0.saved() }] }
                return (item as! BrowserTab).saved()
            },
            "tabs": kept.map { $0.saved() },
            "current": current.flatMap { c in order.firstIndex(of: c) } ?? -1,
        ]
        return state
    }

    /// The tabs from last time (unloaded until shown); returns the one that was current.
    private func restore() -> BrowserTab? {
        guard remember else { return nil }
        if let data = UserDefaults.standard.data(forKey: "conquerState"),
           let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return restore(from: state)
        }
        // Before pinned tabs: a plain list of addresses.
        tabs = (UserDefaults.standard.stringArray(forKey: "conquerTabs") ?? []).compactMap(URL.init(string:)).map { BrowserTab(url: $0, title: nil) }
        tabs.forEach(adopt)
        let i = UserDefaults.standard.integer(forKey: "conquerTab")
        return tabs.indices.contains(i) ? tabs[i] : tabs.first
    }

    private func restore(from state: [String: Any]) -> BrowserTab? {
        for item in state["pinned"] as? [[String: Any]] ?? [] {
            if let name = item["folder"] as? String {
                let tabs = (item["tabs"] as? [[String: Any]] ?? []).map(BrowserTab.restored)
                pinned.append(TabFolder(name: name, tabs: tabs, open: item["open"] as? Bool ?? true))
            } else {
                pinned.append(BrowserTab.restored(item))
            }
        }
        tabs = (state["tabs"] as? [[String: Any]] ?? []).map(BrowserTab.restored)
        allTabs.forEach(adopt)
        allTabs.forEach(fetchSavedIcon)
        let all = allTabs
        let i = state["current"] as? Int ?? -1
        return all.indices.contains(i) ? all[i] : all.first
    }

    // MARK: Navigation

    @objc private func goBack() { current?.web?.goBack() }
    @objc private func goForward() { current?.web?.goForward() }
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

    @objc private func submitAddress() {
        if let chosen = suggestions.chosen { return go(to: chosen) }
        guard let url = Self.destination(address.stringValue) else { return }
        go(to: url)
    }

    private func go(to url: URL) {
        suggestions.hide()
        guard let tab = current else { open(url); return }
        let web = tab.load(configuration) { prepare($0) }
        web.load(URLRequest(url: url))
        window?.makeFirstResponder(web)
        renderBar()
    }

    func controlTextDidChange(_ obj: Notification) {
        guard obj.object as? NSTextField === address else { return }
        suggestions.show(history.suggestions(for: address.stringValue), under: address)
    }

    func controlTextDidEndEditing(_ obj: Notification) {
        guard obj.object as? NSTextField === address else { return }
        suggestions.hide()
        renderBar()
    }

    // ↑ and ↓ move through the suggestions; Esc closes them, then puts the address back.
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard control === address else { return false }
        switch selector {
        case #selector(NSResponder.moveDown(_:)) where suggestions.showing:
            suggestions.move(1)
            return true
        case #selector(NSResponder.moveUp(_:)) where suggestions.showing:
            suggestions.move(-1)
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            if suggestions.showing { suggestions.hide() } else {
                address.stringValue = current?.url?.absoluteString ?? ""
                focusPage()
            }
            return true
        default: return false
        }
    }

    // MARK: Find, zoom, print, downloads

    func showFind() {
        guard current?.web != nil else { return NSSound.beep() }
        findBar.isHidden = false
        findHeight.constant = 36
        window?.makeFirstResponder(findBar.field)
        findBar.field.currentEditor()?.selectAll(nil)
    }

    func closeFind() {
        findBar.isHidden = true
        findHeight.constant = 0
        findBar.say(found: nil)
        if let web = current?.web, window?.firstResponder === findBar.field.currentEditor() { window?.makeFirstResponder(web) }
    }

    /// ⌘G, ⇧⌘G: the next or previous match, opening the find bar if nothing is being looked for.
    private func findAgain(backwards: Bool) {
        if findBar.isHidden || findBar.field.stringValue.isEmpty { return showFind() }
        find(findBar.field.stringValue, backwards: backwards)
    }

    private func find(_ text: String, backwards: Bool) {
        guard !text.isEmpty, let web = current?.web else { return findBar.say(found: nil) }
        let options = WKFindConfiguration()
        options.backwards = backwards
        options.wraps = true
        options.caseSensitive = false
        web.find(text, configuration: options) { [weak self] result in self?.findBar.say(found: result.matchFound) }
    }

    /// Zoom the page a step in (1) or out (-1), or back to actual size (0); each site keeps its own.
    func zoom(_ step: Int) {
        guard let web = current?.web else { return }
        let now = Double(web.pageZoom)
        let next = step == 0 ? 1 : step > 0
            ? Self.zoomSteps.first { $0 > now + 0.001 } ?? Self.zoomSteps.last!
            : Self.zoomSteps.last { $0 < now - 0.001 } ?? Self.zoomSteps.first!
        web.pageZoom = CGFloat(next)
        if let host = web.url?.host {
            zooms[host] = next == 1 ? nil : next
            if remember { UserDefaults.standard.set(zooms, forKey: "conquerZoom") }
        }
    }

    func printPage() {
        guard let web = current?.web, let window else { return NSSound.beep() }
        let operation = web.printOperation(with: NSPrintInfo.shared)
        operation.view?.frame = web.bounds
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    @objc func toggleDownloads() {
        if popover.isShown { popover.performClose(nil) } else { showDownloads() }
    }

    private func showDownloads() {
        guard window != nil else { return }
        downloadsList.render()
        popover.show(relativeTo: downloadsButton.bounds, of: downloadsButton, preferredEdge: .maxY)
    }

    private func downloadsChanged() {
        downloadsList.render()
        downloadsButton.contentTintColor = downloads.running > 0 ? Ink.color(Ink.accent, effectiveAppearance) : nil
        downloadsButton.image = NSImage(systemSymbolName: downloads.running > 0 ? "arrow.down.circle.fill" : "arrow.down.circle",
                                        accessibilityDescription: "Downloads")
    }

    private func importFromMenu() {
        importZenCookies { [weak self] in
            guard let self, let window = self.window else { return }
            let alert = NSAlert()
            alert.messageText = "Imported from Zen Browser"
            alert.informativeText = "\(self.imported). Reload a page to use them."
            alert.beginSheetModal(for: window)
        }
    }

    // MARK: Favicons

    private static let iconScript = """
    (() => {
      const links = [...document.querySelectorAll('link[rel]')].filter(l => /(^|\\s)icon(\\s|$)/i.test(l.rel) || /apple-touch-icon/i.test(l.rel));
      const pick = links.find(l => !/apple/i.test(l.rel)) || links[0];
      return pick ? pick.href : null;
    })()
    """

    private func fetchIcon(for tab: BrowserTab) {
        guard let web = tab.web, let page = web.url, page.scheme?.hasPrefix("http") == true else { return }
        web.evaluateJavaScript(Self.iconScript) { [weak self, weak tab] result, _ in
            guard let self, let tab else { return }
            var fallback = URLComponents()
            fallback.scheme = page.scheme
            fallback.host = page.host
            fallback.port = page.port
            fallback.path = "/favicon.ico"
            guard let url = (result as? String).flatMap(URL.init(string:)) ?? fallback.url else { return }
            self.loadIcon(url, for: tab)
        }
    }

    private func fetchSavedIcon(for tab: BrowserTab) {
        if let url = tab.faviconURL { loadIcon(url, for: tab) }
    }

    private func loadIcon(_ url: URL, for tab: BrowserTab) {
        tab.faviconURL = url
        if let image = icons[url] {
            tab.favicon = image
            return refresh(tab)
        }
        URLSession.shared.dataTask(with: url) { [weak self, weak tab] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, let tab else { return }
                self.icons[url] = image
                tab.favicon = image
                self.refresh(tab)
            }
        }.resume()
    }

    private func refresh(_ tab: BrowserTab) {
        let row = outline.row(forItem: tab)
        if row >= 0 { outline.reloadData(forRowIndexes: [row], columnIndexes: [0]) }
        scheduleSave()
    }

    private func tab(for web: WKWebView) -> BrowserTab? { allTabs.first { $0.web === web } }

    // MARK: WKNavigationDelegate, WKUIDelegate

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // Each site at the zoom it was left at.
        webView.pageZoom = CGFloat(webView.url?.host.flatMap { zooms[$0] } ?? 1)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let tab = tab(for: webView) else { return }
        if let url = webView.url { history.record(url, title: webView.title ?? "") }
        fetchIcon(for: tab)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        // ⌘-click opens a link in a tab behind this one.
        if navigationAction.navigationType == .linkActivated, navigationAction.modifierFlags.contains(.command),
           let url = navigationAction.request.url {
            open(url, select: false, afterCurrent: true)
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

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { began(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { began(download) }

    private func began(_ download: WKDownload) {
        download.delegate = self
        downloads.began(download)
        showDownloads()
    }

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
        downloads.named(download, file: url)
        completionHandler(url)
    }
    func downloadDidFinish(_ download: WKDownload) { downloads.ended(download, error: nil) }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.ended(download, error: error)
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
        let web = WKWebView(frame: body.bounds, configuration: configuration)
        prepare(web)
        let tab = BrowserTab(web: web)
        adopt(tab)
        if let current, let i = tabs.firstIndex(of: current) { tabs.insert(tab, at: i + 1) } else { tabs.append(tab) }
        select(tab)
        return web
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let tab = tab(for: webView) { close(tab) }
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

    // MARK: Checks

    /// A scripted step (checks): a command's name, or `folder <name>`, `into <n>`
    /// (the current tab into the nth folder), `type <text>` (into the address bar),
    /// `find <text>`.
    func check(_ line: String) {
        let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
        let arg = parts.count > 1 ? parts[1] : ""
        switch parts.first ?? "" {
        case "folder":
            pinned.append(TabFolder(name: arg))
            renderSidebar()
        case "into":
            let folders = pinned.compactMap { $0 as? TabFolder }
            if let current, let n = Int(arg), folders.indices.contains(n) { move(current, into: folders[n]) }
        case "type":
            focusAddress()
            address.stringValue = arg
            suggestions.show(history.suggestions(for: arg), under: address)
        case "drag":
            // `drag <tab> <folder|-> <index>`: the nth tab (sidebar order) into a folder, or the top level.
            let a = arg.split(separator: " ").map(String.init)
            let all = allTabs
            guard a.count == 3, let n = Int(a[0]), all.indices.contains(n), let at = Int(a[2]) else { return }
            let folders = pinned.compactMap { $0 as? TabFolder }
            let target: Any? = Int(a[1]).flatMap { folders.indices.contains($0) ? folders[$0] : nil }
            _ = drop(all[n], on: target, at: at)
        case "roundtrip":
            // Save and restore in memory, as across a launch: every tab comes back unloaded.
            let state = encodedState()
            allTabs.forEach { $0.web?.removeFromSuperview() }
            pinned = []
            tabs = []
            current = nil
            if let chosen = restore(from: state) { select(chosen) } else { newTab() }
        case "find":
            showFind()
            findBar.field.stringValue = arg
            find(arg, backwards: false)
        default: perform(line)
        }
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
        func describe(_ t: BrowserTab) -> [String: Any] {
            ["title": t.title, "url": t.url?.absoluteString ?? "", "loaded": t.web != nil, "pinned": t.isPinned, "icon": t.favicon != nil]
        }
        return [
            "pinned": pinned.map { item -> [String: Any] in
                if let f = item as? TabFolder { return ["folder": f.name, "open": f.open, "tabs": f.tabs.map(describe)] }
                return describe(item as! BrowserTab)
            },
            "tabs": tabs.map(describe),
            "current": current.flatMap { c in allTabs.firstIndex(of: c) } ?? -1,
            "imported": imported,
            "zoom": Double(current?.web?.pageZoom ?? 1),
            "find": findBar.isHidden ? "hidden" : "shown",
            "downloads": downloads.items.count,
            "closed": closed.count,
            "sidebar": Double(sidebar.frame.width),
            "suggestions": suggestions.showing ? suggestions.items.map(\.url) : [],
        ]
    }
}
