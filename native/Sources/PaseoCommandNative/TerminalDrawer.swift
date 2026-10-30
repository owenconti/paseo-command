import AppKit
import SwiftTerm

/// The workspace a terminal drawer shows: the one selected in the page (or
/// the selected agent's), as `NativeWorld` reports it.
struct TerminalWorkspace: Equatable {
    let id: String
    /// The host's serverId, or "" for this machine's daemon.
    let host: String
    let name: String
}

/// One of the daemon's terminals, attached through the app server's relay
/// (`web/server/api/terminals.ts`): its bytes in, keys and size out.
final class TerminalSession: NSObject, TerminalViewDelegate, URLSessionWebSocketDelegate {
    let id: String
    var name: String
    let view: TerminalView
    private var socket: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var size: (cols: Int, rows: Int)?
    private(set) var ended = false
    /// The last few kilobytes received, as text (for checks).
    private(set) var recent = ""

    init(id: String, name: String, server: URL, host: String, fontSize: CGFloat) {
        self.id = id
        self.name = name
        view = TerminalView(frame: CGRect(x: 0, y: 0, width: 800, height: 240))
        super.init()
        view.terminalDelegate = self
        view.nativeBackgroundColor = Textures.color(0x101614)
        view.nativeForegroundColor = Textures.color(0xe8e2d0)
        view.font = Self.font(fontSize)
        view.optionAsMetaKey = true
        var components = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        components.scheme = server.scheme == "https" ? "wss" : "ws"
        components.path = "/api/terminal"
        components.queryItems = [URLQueryItem(name: "id", value: id)] + (host.isEmpty ? [] : [URLQueryItem(name: "host", value: host)])
        var request = URLRequest(url: components.url!)
        // The server takes the socket from its own page's origin only.
        request.setValue("\(server.scheme ?? "http")://\(server.host ?? "127.0.0.1")\(server.port.map { ":\($0)" } ?? "")", forHTTPHeaderField: "Origin")
        socket = session.webSocketTask(with: request)
        socket?.resume()
        receive()
    }

    static func font(_ size: CGFloat) -> NSFont { NSFont.monospacedSystemFont(ofSize: size, weight: .regular) }

    private func receive() {
        socket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.data(let data)):
                self.view.feed(byteArray: ArraySlice([UInt8](data)))
                self.recent = String((self.recent + String(decoding: data, as: UTF8.self)).suffix(4096))
                self.receive()
            case .success:
                self.receive()
            case .failure:
                self.finish("disconnected")
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        if let size { send(["type": "resize", "rows": size.rows, "cols": size.cols]) }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        finish(reason.flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 } ?? "closed")
    }

    private func finish(_ why: String) {
        guard !ended else { return }
        ended = true
        view.feed(text: "\r\n\u{1b}[2m[\(why)]\u{1b}[0m\r\n")
    }

    private func send(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) else { return }
        socket?.send(.string(text)) { _ in }
    }

    func close() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session.invalidateAndCancel()
    }

    // MARK: TerminalViewDelegate

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        send(["type": "input", "data": String(decoding: data, as: UTF8.self)])
    }
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        size = (newCols, newRows)
        send(["type": "resize", "rows": newRows, "cols": newCols])
    }
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }
    func bell(source: TerminalView) { NSSound.beep() }
    func clipboardCopy(source: TerminalView, content: Data) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(String(decoding: content, as: UTF8.self), forType: .string)
    }
    func clipboardRead(source: TerminalView) -> Data? { nil }
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}


/// Where the terminal panel sits: beside the map and panels, or under them.
enum TerminalDock: String {
    case right, bottom
}

/// How the panel's body shares out its terminals: one pane, or a split of two
/// (side by side when `vertical`, as NSSplitView names its divider; else
/// stacked), each of which may split again. A tab dropped on a pane's edge splits it.
indirect enum PaneLayout: Equatable {
    case pane(String)
    /// `id` keeps the split's divider where it was left across rebuilds.
    case split(id: String, vertical: Bool, PaneLayout, PaneLayout)

    /// The terminals shown, in reading order.
    var terminals: [String] {
        switch self {
        case .pane(let id): return [id]
        case .split(_, _, let a, let b): return a.terminals + b.terminals
        }
    }

    /// Without the pane showing `terminal`: its sibling takes the split's place.
    func removing(_ terminal: String) -> PaneLayout? {
        switch self {
        case .pane(let id): return id == terminal ? nil : self
        case .split(let id, let vertical, let a, let b):
            switch (a.removing(terminal), b.removing(terminal)) {
            case (let a?, let b?): return .split(id: id, vertical: vertical, a, b)
            case (let rest, nil), (nil, let rest): return rest
            }
        }
    }

    /// With the pane showing `terminal` replaced by `node`.
    func replacing(_ terminal: String, with node: PaneLayout) -> PaneLayout {
        switch self {
        case .pane(let id): return id == terminal ? node : self
        case .split(let id, let vertical, let a, let b):
            return .split(id: id, vertical: vertical, a.replacing(terminal, with: node), b.replacing(terminal, with: node))
        }
    }

    /// For checks: `a`, `(a | b)` side by side, `(a / b)` stacked.
    var text: String {
        switch self {
        case .pane(let id): return id
        case .split(_, let vertical, let a, let b): return "(\(a.text) \(vertical ? "|" : "/") \(b.text))"
        }
    }
}

/// Where on a pane a dragged tab lands: in its place, or beside it on that side.
enum PaneDrop: String {
    case center, left, right, top, bottom
}

/// Two panes and the divider between them, which keeps its proportion as the panel resizes.
final class PaneSplit: NSSplitView, NSSplitViewDelegate {
    private(set) var ratio: CGFloat
    var onRatio: ((CGFloat) -> Void)?
    private static let minPane: CGFloat = 60

    init(ratio: CGFloat, vertical: Bool) {
        self.ratio = ratio
        super.init(frame: CGRect(x: 0, y: 0, width: 400, height: 300))
        isVertical = vertical
        dividerStyle = .thin
        delegate = self
        wantsLayer = true
        layer?.backgroundColor = Textures.color(0x101614).cgColor
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var dividerColor: NSColor { Textures.color(0x2a3330) }
    private var length: CGFloat { (isVertical ? bounds.width : bounds.height) - dividerThickness }

    func splitView(_ splitView: NSSplitView, resizeSubviewsWithOldSize oldSize: NSSize) {
        guard subviews.count == 2 else { return splitView.adjustSubviews() }
        let first = max(0, (length * ratio).rounded())
        let second = max(0, length - first)
        if isVertical {
            subviews[0].frame = CGRect(x: 0, y: 0, width: first, height: bounds.height)
            subviews[1].frame = CGRect(x: first + dividerThickness, y: 0, width: second, height: bounds.height)
        } else {
            subviews[0].frame = CGRect(x: 0, y: 0, width: bounds.width, height: first)
            subviews[1].frame = CGRect(x: 0, y: first + dividerThickness, width: bounds.width, height: second)
        }
    }
    func splitViewDidResizeSubviews(_ notification: Notification) {
        guard subviews.count == 2, length > 0 else { return }
        ratio = (isVertical ? subviews[0].frame.width : subviews[0].frame.height) / length
        onRatio?(ratio)
    }
    func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
        max(proposedMinimumPosition, Self.minPane)
    }
    func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposedMaximumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
        min(proposedMaximumPosition, length - Self.minPane)
    }
}

/// A tab in the panel's bar: its terminal's name and a × that closes it. A
/// click shows it; a drag carries a picture of it to a pane (`PaneDropCatcher`),
/// while the tab itself waits faded in the bar.
final class TerminalTab: NSView, NSDraggingSource {
    /// What a dragged tab carries: its terminal's id.
    static let pasteboardType = NSPasteboard.PasteboardType("com.paseo.command.terminal-tab")
    let id: String
    enum Look { case plain, shown, focused }
    var look: Look = .plain { didSet { restyle() } }
    var onSelect: (() -> Void)?
    var onClose: (() -> Void)?
    /// A drag of the tab began (true) or ended (false).
    var onDrag: ((_ began: Bool) -> Void)?
    /// Conquer's page tabs share the look but stay where they are.
    var draggable = true
    private let label = NSTextField(labelWithString: "")
    private let close = NSButton()
    private var start: NSPoint?
    private var dragging = false

    init(id: String, closeHelp: String = "Close this terminal") {
        self.id = id
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 5
        label.font = .systemFont(ofSize: 11)
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close terminal")?
            .withSymbolConfiguration(.init(pointSize: 8, weight: .semibold))
        close.isBordered = false
        close.toolTip = closeHelp
        close.target = self
        close.action = #selector(closeTab)
        for v in [label, close] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        translatesAutoresizingMaskIntoConstraints = false
        let width = widthAnchor.constraint(equalToConstant: 160)
        width.priority = .defaultLow
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 22),
            widthAnchor.constraint(lessThanOrEqualToConstant: 160),
            widthAnchor.constraint(greaterThanOrEqualToConstant: 56),
            width,
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            close.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 4),
            close.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -5),
            close.centerYAnchor.constraint(equalTo: centerYAnchor),
            close.widthAnchor.constraint(equalToConstant: 14),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func set(name: String) {
        label.stringValue = TerminalDrawer.short(name)
        toolTip = "\(name)\nDrag to a pane's edge to split it"
    }

    func set(label text: String, help: String) {
        label.stringValue = text.count > 22 ? text.prefix(21) + "…" : text
        toolTip = help
    }

    /// Dark in the terminal panel (always dark); Conquer's tabs follow the system.
    private func restyle() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        layer?.backgroundColor = Textures.color(dark ? (look == .focused ? 0x2c3834 : look == .shown ? 0x1e2724 : 0x101614)
                                                     : (look == .focused ? 0xddd8c6 : look == .shown ? 0xe9e5d7 : 0xf7f3e7)).cgColor
        label.textColor = Textures.color(dark ? (look == .focused ? 0xf2e1b2 : look == .shown ? 0xd8d0b8 : 0xa8a08a)
                                              : (look == .focused ? 0x243c32 : look == .shown ? 0x4d5b50 : 0x656b5e))
        close.contentTintColor = label.textColor
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }

    @objc private func closeTab() { onClose?() }

    // The tab takes its own clicks and drags (not its label); the × keeps its own.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let p = convert(point, from: superview)
        guard bounds.contains(p) else { return nil }
        return close.frame.contains(p) ? close : self
    }

    override func mouseDown(with event: NSEvent) {
        start = event.locationInWindow
        dragging = false
    }
    override func mouseDragged(with event: NSEvent) {
        guard draggable, let start, !dragging else { return }
        let p = event.locationInWindow
        guard hypot(p.x - start.x, p.y - start.y) > 4 else { return }
        dragging = true
        let item = NSPasteboardItem()
        item.setString(id, forType: Self.pasteboardType)
        let dragged = NSDraggingItem(pasteboardWriter: item)
        dragged.setDraggingFrame(bounds, contents: picture())
        let session = beginDraggingSession(with: [dragged], event: event, source: self)
        session.animatesToStartingPositionsOnCancelOrFail = true
        alphaValue = 0.35
        onDrag?(true)
    }
    override func mouseUp(with event: NSEvent) {
        if !dragging && start != nil { onSelect?() }
        start = nil
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .withinApplication ? .move : []
    }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        alphaValue = 1
        dragging = false
        start = nil
        onDrag?(false)
    }

    /// The tab as it is carried: lifted, rimmed in gold, its name in full colour.
    private func picture() -> NSImage {
        let size = bounds.size
        let name = label.stringValue
        return NSImage(size: size, flipped: false) { rect in
            let shape = NSBezierPath(roundedRect: rect.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
            Textures.color(0x2c3834).withAlphaComponent(0.95).setFill()
            shape.fill()
            Textures.color(0xf2c14e).withAlphaComponent(0.9).setStroke()
            shape.lineWidth = 1.5
            shape.stroke()
            let text = NSAttributedString(string: name, attributes: [
                .font: NSFont.systemFont(ofSize: 11, weight: .medium),
                .foregroundColor: Textures.color(0xf2e1b2),
            ])
            let height = text.size().height
            text.draw(with: CGRect(x: 8, y: (rect.height - height) / 2 + 2, width: rect.width - 16, height: height),
                      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
            return true
        }
    }
}

/// Over the panes while a tab is dragged, so the terminals under it (which
/// take drops of their own) never see it: reports where it would land and the drop.
final class PaneDropCatcher: NSView {
    /// The tab's terminal and the pointer in window coordinates; whether it can land there.
    var onHover: ((_ id: String, _ point: NSPoint) -> Bool)?
    var onDrop: ((_ id: String, _ point: NSPoint) -> Bool)?
    var onLeave: (() -> Void)?

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([TerminalTab.pasteboardType])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func hover(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard let id = sender.draggingPasteboard.string(forType: TerminalTab.pasteboardType) else { return [] }
        return onHover?(id, sender.draggingLocation) == true ? .move : []
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { hover(sender) }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { hover(sender) }
    override func draggingExited(_ sender: NSDraggingInfo?) { onLeave?() }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let id = sender.draggingPasteboard.string(forType: TerminalTab.pasteboardType) else { return false }
        return onDrop?(id, sender.draggingLocation) ?? false
    }
}

/// The terminal panel: tabs for the selected workspace's daemon terminals, a
/// + for a new one there, and the native terminals (SwiftTerm) in panes: a tab
/// dragged to a pane's edge splits it, to its middle takes its place. A tab's ×
/// ends its terminal; terminals keep running on the daemon when the panel closes.
final class TerminalDrawer: NSView {
    /// The app server the page comes from; the relay and routes are on it.
    var server: () -> URL = { URL(string: "http://127.0.0.1:4310/")! }
    private(set) var workspace: TerminalWorkspace?
    private var sessions: [String: TerminalSession] = [:]
    /// The listed terminals, in the daemon's order.
    private var listed: [(id: String, name: String)] = []
    /// The panes and the one with the keyboard (its tab is the current one).
    private var layout: PaneLayout?
    private var current: String?
    /// Other workspaces' panes, as they were left.
    private var away: [String: (layout: PaneLayout?, current: String?)] = [:]
    /// Each split's proportion, by its id.
    private var ratios: [String: CGFloat] = [:]
    /// The layout the body was last built for, and its panes by terminal.
    private var built: PaneLayout?
    private var panes: [String: NSView] = [:]
    private var poll: Timer?
    private var clicks: Any?

    private let title = NSTextField(labelWithString: "Terminal")
    private let tabBar = NSStackView()
    private var tabViews: [String: TerminalTab] = [:]
    private let add = NSButton(title: "+", target: nil, action: nil)
    private let move = NSButton(title: "", target: nil, action: nil)
    private let grow = NSButton(title: "", target: nil, action: nil)
    private let join = NSButton(title: "", target: nil, action: nil)
    /// Over the tab bar while a tab is carried: dropped there, a pane's tab goes back to being only a tab.
    private let barCatcher = PaneDropCatcher()
    private let barText = NSTextField(labelWithString: "Back to tabs")
    /// Asked to move the panel to the other side (the window owns the split).
    var onMove: (() -> Void)?
    /// Asked to cover the map, or return beside it.
    var onMaximize: (() -> Void)?
    /// The separator along the edge that faces the map: left when docked right, top when at the bottom.
    private let line = NSBox()
    private var lineConstraints: [NSLayoutConstraint] = []
    var dock: TerminalDock = .right { didSet { placeLine() } }
    /// Over the map (the page's panels stay beside it) rather than in the split.
    var maximized = false { didSet { placeGrow() } }

    private func placeGrow() {
        line.isHidden = maximized
        grow.image = NSImage(systemSymbolName: maximized ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                             accessibilityDescription: maximized ? "Restore terminal" : "Maximize terminal")
        grow.toolTip = maximized ? "Restore the terminal beside the map (⇧⌘↩)" : "Maximize the terminal over the map (⇧⌘↩)"
    }

    /// The terminals' text size, kept across launches (⌘+, ⌘−, ⌘0).
    static let defaultFontSize: CGFloat = 12.5
    private(set) var fontSize: CGFloat = {
        let saved = UserDefaults.standard.double(forKey: "terminalFontSize")
        return saved > 0 ? saved : TerminalDrawer.defaultFontSize
    }()
    private let body = NSView()
    /// Where a dragged tab would land.
    private let marker = NSView()
    private let markerText = NSTextField(labelWithString: "")
    private let catcher = PaneDropCatcher()
    private let empty = NSTextField(wrappingLabelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        // Dark like the page's panels, whatever the system's appearance.
        appearance = NSAppearance(named: .darkAqua)
        wantsLayer = true
        layer?.backgroundColor = Textures.color(0x101614).cgColor
        let bar = NSStackView()
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 4, left: 10, bottom: 4, right: 8)
        title.font = .systemFont(ofSize: 11, weight: .semibold)
        title.textColor = Textures.color(0xf2e1b2)
        title.lineBreakMode = .byTruncatingTail
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tabBar.orientation = .horizontal
        tabBar.spacing = 2
        tabBar.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        for (button, help, action) in [(add, "New terminal in this workspace", #selector(newTerminal)),
                                       (move, "", #selector(moveDock)),
                                       (grow, "", #selector(maximize)),
                                       (join, "Unsplit: one terminal at a time, the others as tabs", #selector(unsplit))] {
            button.bezelStyle = .accessoryBarAction
            button.controlSize = .small
            button.toolTip = help
            button.target = self
            button.action = action
        }
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        join.image = NSImage(systemSymbolName: "rectangle.split.2x1.slash", accessibilityDescription: "Unsplit terminals")
        for v in [title, tabBar, add, spacer, join, move, grow] { bar.addArrangedSubview(v) }
        empty.textColor = Textures.color(0xa8a08a)
        empty.font = .systemFont(ofSize: 12)
        empty.alignment = .center
        marker.wantsLayer = true
        marker.layer?.backgroundColor = Textures.color(0xf2c14e).withAlphaComponent(0.16).cgColor
        marker.layer?.borderColor = Textures.color(0xf2c14e).withAlphaComponent(0.8).cgColor
        marker.layer?.borderWidth = 2
        marker.layer?.cornerRadius = 4
        marker.isHidden = true
        markerText.font = .systemFont(ofSize: 11, weight: .semibold)
        markerText.textColor = Textures.color(0x101614)
        markerText.alignment = .center
        markerText.wantsLayer = true
        markerText.drawsBackground = true
        markerText.backgroundColor = Textures.color(0xf2c14e)
        markerText.layer?.cornerRadius = 4
        markerText.layer?.masksToBounds = true
        markerText.translatesAutoresizingMaskIntoConstraints = false
        marker.addSubview(markerText)
        NSLayoutConstraint.activate([
            markerText.centerXAnchor.constraint(equalTo: marker.centerXAnchor),
            markerText.centerYAnchor.constraint(equalTo: marker.centerYAnchor),
        ])
        body.addSubview(marker)
        catcher.frame = body.bounds
        catcher.autoresizingMask = [.width, .height]
        catcher.isHidden = true
        catcher.onHover = { [weak self] id, point in self?.hover(id, at: point) ?? false }
        catcher.onDrop = { [weak self] id, point in self?.drop(id, at: point) ?? false }
        catcher.onLeave = { [weak self] in self?.marker.isHidden = true }
        body.addSubview(catcher)
        barCatcher.wantsLayer = true
        barCatcher.layer?.cornerRadius = 5
        barCatcher.layer?.borderWidth = 2
        barCatcher.isHidden = true
        barText.font = .systemFont(ofSize: 11, weight: .semibold)
        barText.textColor = Textures.color(0xf2e1b2)
        barText.translatesAutoresizingMaskIntoConstraints = false
        barCatcher.addSubview(barText)
        barCatcher.onHover = { [weak self] id, _ in self?.hoverBar(id) ?? false }
        barCatcher.onDrop = { [weak self] id, _ in self?.dropOnBar(id) ?? false }
        barCatcher.onLeave = { [weak self] in self?.hoverBar(nil) }
        for v in [bar, body, empty, barCatcher] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        placeLine()
        placeGrow()
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: topAnchor, constant: 1),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 30),
            barCatcher.topAnchor.constraint(equalTo: bar.topAnchor, constant: 2),
            barCatcher.bottomAnchor.constraint(equalTo: bar.bottomAnchor, constant: -2),
            barCatcher.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 4),
            barCatcher.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -4),
            barText.centerXAnchor.constraint(equalTo: barCatcher.centerXAnchor),
            barText.centerYAnchor.constraint(equalTo: barCatcher.centerYAnchor),
            body.topAnchor.constraint(equalTo: bar.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            body.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            body.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
            empty.centerYAnchor.constraint(equalTo: body.centerYAnchor),
            empty.leadingAnchor.constraint(equalTo: body.leadingAnchor, constant: 20),
            empty.trailingAnchor.constraint(equalTo: body.trailingAnchor, constant: -20),
        ])
        // A click in a pane gives it the keyboard; its tab becomes the current one.
        clicks = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            if let self, event.window === self.window, !self.isHiddenOrHasHiddenAncestor,
               let id = self.pane(at: event.locationInWindow), id != self.current {
                self.current = id
                self.render()
            }
            return event
        }
        render()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func placeLine() {
        NSLayoutConstraint.deactivate(lineConstraints)
        lineConstraints = dock == .right ? [
            line.topAnchor.constraint(equalTo: topAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
        ] : [
            line.topAnchor.constraint(equalTo: topAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
        ]
        NSLayoutConstraint.activate(lineConstraints)
        let other = dock == .right ? "bottom" : "right"
        move.image = NSImage(systemSymbolName: dock == .right ? "rectangle.bottomhalf.inset.filled" : "rectangle.righthalf.inset.filled",
                             accessibilityDescription: "Move terminal to the \(other)")
        move.toolTip = "Move the terminal to the \(other)"
    }

    @objc private func moveDock() { onMove?() }
    @objc private func maximize() { onMaximize?() }

    /// Whether the body shows more than one pane.
    var isSplit: Bool { (layout?.terminals.count ?? 0) > 1 }

    /// Back to one pane, the current terminal's; the others stay as tabs (View → Unsplit Terminals).
    @objc func unsplit() {
        guard isSplit, let keep = current ?? layout?.terminals.first else { return }
        layout = .pane(keep)
        render()
        focusTerminal()
    }

    /// Change the terminals' text size by `step` points (0 restores the default).
    func zoom(_ step: CGFloat) {
        fontSize = step == 0 ? Self.defaultFontSize : max(8, min(32, fontSize + step))
        UserDefaults.standard.set(fontSize, forKey: "terminalFontSize")
        for s in sessions.values { s.view.font = TerminalSession.font(fontSize) }
    }

    /// The page selected another workspace (or none). Each keeps its panes for when it comes back.
    func show(_ next: TerminalWorkspace?) {
        guard next != workspace else { return }
        if let ws = workspace { away[ws.id] = (layout, current) }
        workspace = next
        listed = []
        let kept = next.flatMap { away[$0.id] }
        layout = kept?.layout
        current = kept?.current
        empty.stringValue = ""
        render()
        refresh()
    }

    /// Shown: keep the tabs in step with the daemon; hidden: stop asking.
    func setActive(_ active: Bool) {
        poll?.invalidate()
        poll = nil
        guard active else { return }
        refresh()
        poll = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
    }

    /// The current tab's terminal takes the keyboard.
    func focusTerminal() {
        if let id = current, let s = sessions[id], s.view.window != nil { window?.makeFirstResponder(s.view) }
    }

    private func api(_ path: String, _ query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: server(), resolvingAgainstBaseURL: false)!
        c.path = "/api/\(path)"
        c.queryItems = query.isEmpty ? nil : query
        return c.url!
    }

    /// The panel opened: show the workspace's terminals, starting one if it has none.
    func opened() {
        guard workspace != nil else { return }
        refresh { [weak self] listedOK in
            guard let self else { return }
            if listedOK && self.listed.isEmpty { self.newTerminal() } else { self.focusTerminal() }
        }
    }

    private func refresh(then done: ((_ listedOK: Bool) -> Void)? = nil) {
        guard let ws = workspace else { return }
        let url = api("terminals", [URLQueryItem(name: "workspace", value: ws.id)] + (ws.host.isEmpty ? [] : [URLQueryItem(name: "host", value: ws.host)]))
        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async {
                guard let self, self.workspace == ws else { return }
                if let terminals = json?["terminals"] as? [[String: Any]] {
                    self.listed = terminals.compactMap { t in (t["id"] as? String).map { ($0, (t["title"] as? String) ?? (t["name"] as? String) ?? "Terminal") } }
                    self.empty.stringValue = ""
                } else {
                    self.listed = []
                    self.empty.stringValue = (json?["error"] as? String) ?? error?.localizedDescription ?? "The terminals couldn't be listed."
                }
                // Sessions for terminals that are gone end here too.
                for (id, s) in self.sessions where !self.listed.contains(where: { $0.id == id }) && s.ended {
                    s.close()
                    s.view.removeFromSuperview()
                    self.sessions[id] = nil
                }
                self.render()
                done?(json?["terminals"] != nil)
            }
        }.resume()
    }

    /// Keep the panes to listed terminals, with one showing whenever any is
    /// listed, and the current tab one of those shown.
    private func settle() {
        let ids = Set(listed.map(\.id))
        for id in layout?.terminals ?? [] where !ids.contains(id) { layout = layout?.removing(id) }
        if layout == nil, let first = listed.first { layout = .pane(first.id) }
        if !(layout?.terminals.contains { $0 == current } ?? false) { current = layout?.terminals.first }
    }

    private func render() {
        settle()
        let ws = workspace
        title.stringValue = ws.map { "Terminal · \($0.name)" } ?? "Terminal"
        add.isEnabled = ws != nil
        renderTabs()
        if ws == nil {
            empty.stringValue = "Select a workspace or agent to open its terminals."
        } else if layout == nil && empty.stringValue.isEmpty {
            empty.stringValue = "No terminals in \(ws!.name). Press + to open one."
        }
        empty.isHidden = ws != nil && layout != nil
        join.isHidden = !isSplit
        buildPanes()
        // With more than one pane, the current one is rimmed.
        let several = panes.count > 1
        for (id, pane) in panes {
            pane.layer?.borderColor = (several && id == current ? Textures.color(0xf2c14e).withAlphaComponent(0.55) : .clear).cgColor
        }
    }

    private func renderTabs() {
        for (id, tab) in tabViews where !listed.contains(where: { $0.id == id }) {
            tab.removeFromSuperview()
            tabViews[id] = nil
        }
        let shown = Set(layout?.terminals ?? [])
        for (i, t) in listed.enumerated() {
            let tab = tabViews[t.id] ?? {
                let tab = TerminalTab(id: t.id)
                tab.onSelect = { [weak self] in self?.choose(t.id) }
                tab.onClose = { [weak self] in self?.closeTab(t.id) }
                tab.onDrag = { [weak self] began in self?.dragging(began) }
                tabViews[t.id] = tab
                return tab
            }()
            tab.set(name: t.name)
            tab.look = t.id == current ? .focused : shown.contains(t.id) ? .shown : .plain
            if let at = tabBar.arrangedSubviews.firstIndex(of: tab), at != i { tabBar.removeArrangedSubview(tab) }
            if tabBar.arrangedSubviews.firstIndex(of: tab) != i {
                tabBar.insertArrangedSubview(tab, at: min(i, tabBar.arrangedSubviews.count))
            }
        }
        tabBar.isHidden = listed.isEmpty
    }

    /// Lay the panes out again when the layout changed (not on every poll:
    /// moving a terminal's view between parents is not free).
    private func buildPanes() {
        let next = workspace == nil ? nil : layout
        guard next != built else { return }
        built = next
        for v in body.subviews where v !== marker && v !== catcher { v.removeFromSuperview() }
        panes = [:]
        guard let next, let ws = workspace else { return }
        let root = build(next, ws)
        root.frame = body.bounds
        root.autoresizingMask = [.width, .height]
        body.addSubview(root, positioned: .below, relativeTo: marker)
    }

    private func build(_ node: PaneLayout, _ ws: TerminalWorkspace) -> NSView {
        switch node {
        case .pane(let id):
            let s = session(id, ws)
            let pane = NSView(frame: CGRect(x: 0, y: 0, width: 400, height: 300))
            pane.wantsLayer = true
            pane.layer?.cornerRadius = 4
            pane.layer?.backgroundColor = Textures.color(0x101614).cgColor
            pane.layer?.borderWidth = 1
            s.view.removeFromSuperview()
            s.view.translatesAutoresizingMaskIntoConstraints = true
            s.view.frame = pane.bounds.insetBy(dx: 2, dy: 2)
            s.view.autoresizingMask = [.width, .height]
            pane.addSubview(s.view)
            panes[id] = pane
            return pane
        case .split(let key, let vertical, let a, let b):
            let split = PaneSplit(ratio: ratios[key] ?? 0.5, vertical: vertical)
            split.onRatio = { [weak self] in self?.ratios[key] = $0 }
            split.addSubview(build(a, ws))
            split.addSubview(build(b, ws))
            return split
        }
    }

    private func session(_ id: String, _ ws: TerminalWorkspace) -> TerminalSession {
        if let s = sessions[id] { return s }
        let name = listed.first { $0.id == id }?.name ?? "Terminal"
        let s = TerminalSession(id: id, name: name, server: server(), host: ws.host, fontSize: fontSize)
        sessions[id] = s
        return s
    }

    /// The pane under a point in the window, by its terminal.
    private func pane(at point: NSPoint) -> String? {
        panes.first { _, view in view.bounds.contains(view.convert(point, from: nil)) }?.key
    }

    /// A tab's terminal name that fits a tab: a shell's `user@host:~/a/b`
    /// title shows its folder.
    static func short(_ name: String) -> String {
        var text = name
        if let colon = text.lastIndex(of: ":"), text[..<colon].contains("@") {
            text = String(text[text.index(after: colon)...]).split(separator: "/").last.map(String.init) ?? text
        }
        return text.count > 22 ? text.prefix(21) + "…" : text
    }

    /// A tab clicked: its pane takes the keyboard, or, if it isn't showing, it
    /// takes the current pane's place.
    private func choose(_ id: String) {
        if !(layout?.terminals.contains(id) ?? false) {
            layout = layout.flatMap { l in current.map { l.replacing($0, with: .pane(id)) } } ?? .pane(id)
        }
        current = id
        render()
        focusTerminal()
    }

    // MARK: Dragging tabs into panes

    /// Where a tab dragged to `point` (window coordinates) would land: a pane
    /// other than its own, its middle or the side nearest the pointer, and that
    /// part of the pane in the body's coordinates.
    private func dropTarget(_ id: String, _ point: NSPoint) -> (pane: String, side: PaneDrop, rect: CGRect)? {
        guard let target = pane(at: point), target != id, let view = panes[target] else { return nil }
        let b = view.bounds
        let p = view.convert(point, from: nil)
        // Panes aren't flipped: y runs up.
        let fx = p.x / max(1, b.width), fy = p.y / max(1, b.height)
        let edges: [(PaneDrop, CGFloat)] = [(.left, fx), (.right, 1 - fx), (.bottom, fy), (.top, 1 - fy)]
        let nearest = edges.min { $0.1 < $1.1 }!
        let side = nearest.1 < 0.28 ? nearest.0 : .center
        let rect: CGRect
        switch side {
        case .center: rect = b
        case .left: rect = CGRect(x: 0, y: 0, width: b.width / 2, height: b.height)
        case .right: rect = CGRect(x: b.width / 2, y: 0, width: b.width / 2, height: b.height)
        case .bottom: rect = CGRect(x: 0, y: 0, width: b.width, height: b.height / 2)
        case .top: rect = CGRect(x: 0, y: b.height / 2, width: b.width, height: b.height / 2)
        }
        return (target, side, body.convert(rect, from: view).insetBy(dx: 2, dy: 2))
    }

    /// While a tab is carried, the catcher covers the panes (and the marker shows where it would land).
    private func dragging(_ began: Bool) {
        catcher.isHidden = !began
        // The bar takes a drop only when there are panes to leave.
        barCatcher.isHidden = !began || !isSplit
        if !began { marker.isHidden = true; hoverBar(nil) }
    }

    /// The tab bar under a carried tab (nil when it left): lit while dropping
    /// there would take that terminal out of the panes.
    @discardableResult
    private func hoverBar(_ id: String?) -> Bool {
        let can = id.map { id in isSplit && layout?.terminals.contains(id) == true } ?? false
        barCatcher.layer?.backgroundColor = can ? Textures.color(0x101614).withAlphaComponent(0.92).cgColor : NSColor.clear.cgColor
        barCatcher.layer?.borderColor = can ? Textures.color(0xf2c14e).withAlphaComponent(0.8).cgColor : NSColor.clear.cgColor
        barText.isHidden = !can
        return can
    }

    private func dropOnBar(_ id: String) -> Bool {
        hoverBar(nil)
        guard isSplit, let next = layout?.removing(id) else { return false }
        layout = next
        if current == id { current = next.terminals.first }
        render()
        focusTerminal()
        return true
    }

    private func hover(_ id: String, at point: NSPoint) -> Bool {
        guard let target = dropTarget(id, point) else { marker.isHidden = true; return false }
        marker.frame = target.rect
        markerText.stringValue = "  " + (target.side == .center ? "Show here" : "Split \(target.side.rawValue)") + "  "
        marker.isHidden = false
        return true
    }

    private func drop(_ id: String, at point: NSPoint) -> Bool {
        marker.isHidden = true
        guard let target = dropTarget(id, point) else { return false }
        place(id, at: target.pane, target.side)
        return true
    }

    /// Show terminal `id` at `side` of the pane showing `target` (in its place
    /// for `.center`), leaving the pane it was in, if any.
    func place(_ id: String, at target: String, _ side: PaneDrop) {
        guard var next = layout, id != target, next.terminals.contains(target) else { return }
        if next.terminals.contains(id) { next = next.removing(id) ?? next }
        let moved = PaneLayout.pane(id), there = PaneLayout.pane(target), key = UUID().uuidString
        switch side {
        case .center: next = next.replacing(target, with: moved)
        case .left: next = next.replacing(target, with: .split(id: key, vertical: true, moved, there))
        case .right: next = next.replacing(target, with: .split(id: key, vertical: true, there, moved))
        case .top: next = next.replacing(target, with: .split(id: key, vertical: false, moved, there))
        case .bottom: next = next.replacing(target, with: .split(id: key, vertical: false, there, moved))
        }
        layout = next
        current = id
        render()
        focusTerminal()
    }

    // MARK: Creating and closing terminals

    private func post(_ path: String, _ body: [String: Any], done: @escaping ([String: Any]?) -> Void) {
        var request = URLRequest(url: api(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async { done(json) }
        }.resume()
    }

    /// A new terminal in the workspace, as a new tab in the current pane.
    @objc func newTerminal() {
        guard let ws = workspace else { return }
        var body: [String: Any] = ["workspace": ws.id]
        if !ws.host.isEmpty { body["host"] = ws.host }
        post("terminals/create", body) { [weak self] json in
            guard let self, self.workspace == ws else { return }
            if let terminal = json?["terminal"] as? [String: Any], let id = terminal["id"] as? String {
                if !self.listed.contains(where: { $0.id == id }) {
                    self.listed.append((id, (terminal["title"] as? String) ?? (terminal["name"] as? String) ?? "Terminal"))
                }
                self.layout = self.layout.flatMap { l in self.current.map { l.replacing($0, with: .pane(id)) } } ?? .pane(id)
                self.current = id
                self.render()
                self.refresh()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.focusTerminal() }
            } else {
                self.empty.stringValue = (json?["error"] as? String) ?? "The terminal didn't start."
                self.render()
            }
        }
    }

    /// A tab's ×: end its terminal, after asking (unless told not to ask again).
    private func closeTab(_ id: String) {
        guard let ws = workspace, let window else { return }
        let end = { [weak self] in
            guard let self else { return }
            var body: [String: Any] = ["id": id]
            if !ws.host.isEmpty { body["host"] = ws.host }
            self.post("terminals/kill", body) { _ in
                self.sessions[id]?.close()
                self.sessions[id]?.view.removeFromSuperview()
                self.sessions[id] = nil
                guard self.workspace == ws else { return }
                self.listed.removeAll { $0.id == id }
                self.layout = self.layout?.removing(id)
                self.render()
                self.refresh()
                self.focusTerminal()
            }
        }
        if UserDefaults.standard.bool(forKey: "terminalCloseWithoutAsking") { return end() }
        let alert = NSAlert()
        alert.messageText = "Close “\(listed.first { $0.id == id }?.name ?? "this terminal")”?"
        alert.informativeText = "Its shell and anything running in it stop, on the daemon too."
        alert.addButton(withTitle: "Close Terminal")
        alert.addButton(withTitle: "Cancel")
        alert.showsSuppressionButton = true
        alert.suppressionButton?.title = "Don’t ask again"
        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn else { return }
            if alert.suppressionButton?.state == .on { UserDefaults.standard.set(true, forKey: "terminalCloseWithoutAsking") }
            end()
        }
    }

    /// What the drawer shows, for checks: the workspace, its tabs and panes,
    /// and the text the current terminal received.
    func state() -> [String: Any] {
        // What the current terminal has received, escape codes aside.
        let raw = current.flatMap { sessions[$0]?.recent } ?? ""
        let text = raw.replacingOccurrences(of: "\u{1b}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
        return [
            "workspace": workspace.map { ["id": $0.id, "host": $0.host, "name": $0.name] } as Any? ?? NSNull(),
            "tabs": listed.map(\.name),
            "ids": listed.map(\.id),
            "current": current as Any? ?? NSNull(),
            "panes": layout?.text ?? "",
            "text": text,
            "open": !isHidden,
            "dock": dock.rawValue,
            "maximized": maximized,
            "frame": [frame.minX, frame.minY, frame.width, frame.height],
            "fontSize": fontSize,
        ]
    }

    /// Type into the current terminal as keys would (checks).
    func type(_ text: String) {
        if let id = current, let s = sessions[id] { s.view.send(txt: text) }
    }

    /// Split the current pane with the last tab not showing, on its right (checks).
    func splitForCheck() {
        guard let current, let other = listed.last(where: { !(layout?.terminals.contains($0.id) ?? false) }) ?? listed.first(where: { $0.id != current }) else { return }
        place(other.id, at: current, .right)
    }

    func closeAll() {
        for s in sessions.values { s.close() }
        sessions = [:]
    }
}
