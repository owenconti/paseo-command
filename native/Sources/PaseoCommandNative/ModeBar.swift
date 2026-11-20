import AppKit

/// What stands in the map's place: the map (Crew), the open conversation (Command, with its editor, terminal and
/// browser beside it), or what the page draws itself: GitHub (pull requests),
/// Activity (GitHub and Linear notifications together) and Settings (the bar's gear, not a tab). (The Linear, Files,
/// Terminal and Conquer tabs were removed at the user's request: an agent's files and terminal are its workspace's
/// editor beside its conversation, and its browser is beside it too. A saved `linear`, `files`, `terminal` or
/// `conquer` mode is no mode, so the map shows.)
enum Mode: String, CaseIterable {
    case crew, command, github, activity, settings

    var title: String {
        switch self {
        case .crew: "Crew"
        case .command: "Command"
        case .github: "GitHub"
        case .activity: "Activity"
        case .settings: "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .crew: "map"
        case .command: "bubble.left.and.bubble.right"
        case .github: "arrow.triangle.pull"
        case .activity: "bell"
        case .settings: "gearshape"
        }
    }
    /// The page draws it over the map (the mode bar shows GitHub's and Activity's
    /// tabs only while their integration is on; Settings' always).
    var drawnByPage: Bool { self == .github || self == .activity || self == .settings }
    /// The page's tabs that always show (no integration of their own).
    static let alwaysShown: Set<Mode> = [.settings]
    /// The tabs, in the bar's order (⌘1…⌘4 count those shown); Settings is the tools' gear instead.
    static let tabs = allCases.filter { $0 != .settings }
    /// What it shows; the bar's tooltip adds its keys (`keys(at:)`).
    var tip: String {
        switch self {
        case .crew: "The crew: every host, project, workspace and agent"
        case .command: "The open conversation, with its editor, terminal and browser"
        case .github: "Pull requests, in the map's place"
        case .activity: "GitHub and Linear notifications together, in the map's place"
        case .settings: "Settings: sounds, notifications, integrations, New agent, in the map's place"
        }
    }
    /// Its keys, as the `index`th tab shown (from 0): ⌘1…⌘4, and ⌘` steps (Settings' gear only ⌘,).
    func keys(at index: Int?) -> String {
        let number = index.map { "⌘\($0 + 1), " } ?? ""
        switch self {
        case .settings: return "⌘,"
        default: return "\(number)⌘`"
        }
    }
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

/// One of the top bar's icon buttons: an SF Symbol that lights on hover, with a pointing hand.
final class BarButton: NSButton {
    var onHover: ((Bool) -> Void)?
    private(set) var hovered = false
    /// Shown as on (the gear while Settings shows).
    var on = false { didSet { if on != oldValue { restyle() } } }
    /// A small accent dot at its corner (What's new has unseen notes).
    var dot = false { didSet { dotLayer.isHidden = !dot } }
    private let dotLayer = CALayer()

    init(symbol: String, label: String, tip: String) {
        super.init(frame: .zero)
        isBordered = false
        wantsLayer = true
        layer?.cornerRadius = 6
        imagePosition = .imageOnly
        setSymbol(symbol, label: label)
        toolTip = tip
        dotLayer.isHidden = true
        dotLayer.cornerRadius = 3
        layer?.addSublayer(dotLayer)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 28),
            heightAnchor.constraint(equalToConstant: 26),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setSymbol(_ symbol: String, label: String) {
        image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)?
            .withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
        setAccessibilityLabel(label)
    }

    override func layout() {
        super.layout()
        dotLayer.frame = CGRect(x: bounds.width - 9, y: bounds.height - 9, width: 6, height: 6)
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; restyle(); onHover?(true) }
    override func mouseExited(with event: NSEvent) { hovered = false; restyle(); onHover?(false) }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }
    override var isEnabled: Bool { didSet { restyle() } }

    func restyle() {
        let look = effectiveAppearance
        // Lit as the tabs' track is, which shows on the bar where a tab's raised pane wouldn't.
        layer?.backgroundColor = on ? Ink.color(Ink.tabShown, look).cgColor
            : hovered && isEnabled ? Ink.color(Ink.tabFocused, look, 0.6).cgColor : nil
        contentTintColor = Ink.color(!isEnabled ? Ink.off : on || hovered ? Ink.strong : Ink.mid, look)
        dotLayer.backgroundColor = Ink.color(Ink.accent, look).cgColor
    }
}

/// The top bar's usage meters (up to four providers' limits, as bars filling with use);
/// hovering shows the page's breakdown beneath it.
final class UsageMeters: NSButton {
    var meters: [(pct: Double, tone: String)] = [] { didSet { needsDisplay = true } }
    var onHover: ((Bool) -> Void)?
    var onClick: (() -> Void)?

    // A button, so the title bar passes its clicks through as it does the other tools'.
    override init(frame: NSRect) {
        super.init(frame: frame)
        isBordered = false
        title = ""
        target = self
        action = #selector(clicked)
        toolTip = "Usage limits by provider and account"
        setAccessibilityLabel("Usage breakdown")
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([widthAnchor.constraint(equalToConstant: 26), heightAnchor.constraint(equalToConstant: 26)])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func clicked() { onClick?() }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }

    override func draw(_ dirtyRect: NSRect) {
        let look = effectiveAppearance
        let shown = meters.isEmpty ? [(pct: 0.0, tone: "")] : meters
        let bar: CGFloat = 3, gap: CGFloat = 2
        let width: CGFloat = 20
        let total = CGFloat(shown.count) * bar + CGFloat(shown.count - 1) * gap
        var y = (bounds.height + total) / 2 - bar
        for meter in shown {
            let track = NSRect(x: (bounds.width - width) / 2, y: y, width: width, height: bar)
            Ink.color(Ink.tabShown, look).setFill()
            NSBezierPath(roundedRect: track, xRadius: bar / 2, yRadius: bar / 2).fill()
            let used = NSRect(x: track.minX, y: y, width: width * CGFloat(max(0, min(100, meter.pct))) / 100, height: bar)
            (meter.tone == "red" ? Ink.color("red-text", look) : meter.tone == "amber" ? NSColor.systemOrange : Ink.color(Ink.mid, look)).setFill()
            NSBezierPath(roundedRect: used, xRadius: bar / 2, yRadius: bar / 2).fill()
            y -= bar + gap
        }
    }
}

/// The strip across the top of the window: the traffic lights, the product's name, the tabs that
/// switch the map's place between the map (Crew), the open conversation (Command), GitHub and Activity (⌘` steps
/// through them, ⌘1…⌘4
/// pick the one in that place), "Update ready" when a newer build
/// is in, and the app's tools at the right: who needs you, usage, the glance (`GlanceBar`), the Settings gear, What's new, mini games,
/// keyboard shortcuts and the session panel's side, layout and visibility. All of it is native;
/// the page says what the tools show (`apply`) and opens what they ask for (`onAction`, with the
/// button, so its popovers open beneath it). It stands in for the hidden title bar: it drags the
/// window, and it is the same surface as the chrome under it, with no line between them.
final class ModeBar: NSView {
    var onSelect: ((Mode) -> Void)?
    /// A tool was used: its action's name and its button.
    var onAction: ((String, NSView) -> Void)?
    /// The page's tabs whose integration is on (Crew and Command always show).
    var enabled: Set<Mode> = [] {
        didSet {
            for (mode, button) in buttons { button.isHidden = mode.drawnByPage && !enabled.contains(mode) }
            restyle()
        }
    }
    /// Activity's unread notifications, shown on its tab.
    var activityUnread = 0 { didSet { if activityUnread != oldValue { restyle() } } }
    var mode: Mode = .crew { didSet { settings.on = mode == .settings; restyle() } }
    /// Where the bar's content starts: past the traffic lights.
    var leading: CGFloat = 0 { didSet { titleLeading?.constant = leading } }
    var updateReady = false { didSet { if updateReady != oldValue { update.isHidden = !updateReady } } }
    private var titleLeading: NSLayoutConstraint?
    private let title = NSTextField(labelWithString: "")
    private let update = NSTextField(labelWithString: "Update ready · Restart app")
    private let buttons: [(Mode, ModeButton)]
    /// The control's track, behind the tabs.
    private let track = NSStackView()
    private let tools = NSStackView()
    private let attention = NSButton()
    private let usage = UsageMeters()
    /// The glance (Linear, GitHub, Diagonal), left of the gear.
    private let glance = GlanceBar()
    /// Settings, in the map's place: lit while it shows; again goes back to the side before.
    private let settings = BarButton(symbol: "gearshape", label: "Settings", tip: "\(Mode.settings.tip) (⌘,)")
    private let releases = BarButton(symbol: "sparkles", label: "What's new", tip: "What's new")
    private let games = BarButton(symbol: "gamecontroller", label: "Mini games", tip: "Mini games (B)")
    private let shortcuts = BarButton(symbol: "keyboard", label: "Keyboard shortcuts", tip: "Keyboard shortcuts (?)")
    private let panelSide = BarButton(symbol: "sidebar.right", label: "Move panel to the right", tip: "Move panel to the right")
    private let panelLayout = BarButton(symbol: "rectangle.split.2x1", label: "Show list and details together", tip: "Show list and details together")
    private let panelToggle = BarButton(symbol: "minus", label: "Hide session panel", tip: "Hide session panel (⌘B)")
    private var attentionCount = 0

    /// The product's name is the page's header font, bundled beside the icon (see native/scripts/bundle.sh).
    private static let registerFont: Void = {
        if let url = Bundle.main.url(forResource: "paseo-barlow-600", withExtension: "woff2") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    override init(frame: NSRect) {
        buttons = Mode.tabs.map { ($0, ModeButton()) }
        super.init(frame: frame)
        wantsLayer = true
        ModeBar.registerFont
        title.setAccessibilityLabel("Paseo Command")
        title.translatesAutoresizingMaskIntoConstraints = false
        addSubview(title)
        track.orientation = .horizontal
        track.spacing = 2
        track.edgeInsets = NSEdgeInsets(top: 2, left: 2, bottom: 2, right: 2)
        track.wantsLayer = true
        track.layer?.cornerRadius = 8
        track.translatesAutoresizingMaskIntoConstraints = false
        for (index, (mode, button)) in buttons.enumerated() {
            button.isBordered = false
            button.wantsLayer = true
            button.layer?.cornerRadius = 6
            button.target = self
            button.action = #selector(pick(_:))
            button.tag = index
            button.toolTip = mode.tip
            let symbol = NSImage(systemSymbolName: mode.symbol, accessibilityDescription: nil)
            button.image = symbol?.withSymbolConfiguration(.init(pointSize: 11, weight: .medium))
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
            button.onHover = { [weak self] _ in self?.restyle() }
            button.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                button.heightAnchor.constraint(equalToConstant: 20),
                button.widthAnchor.constraint(greaterThanOrEqualToConstant: 92),
            ])
            button.isHidden = mode.drawnByPage
            track.addArrangedSubview(button)
        }
        addSubview(track)
        update.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        update.toolTip = "An update is ready: choose Restart app in the command palette (⌘K)"
        update.isHidden = true
        update.translatesAutoresizingMaskIntoConstraints = false
        update.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        // The tools, right to left as the page had them: need you, usage, settings, What's new,
        // games, shortcuts, then the panel's side, layout and visibility.
        attention.isBordered = false
        attention.wantsLayer = true
        attention.layer?.cornerRadius = 11
        attention.isHidden = true
        attention.target = self
        attention.action = #selector(tool(_:))
        attention.identifier = NSUserInterfaceItemIdentifier("attention")
        attention.translatesAutoresizingMaskIntoConstraints = false
        attention.heightAnchor.constraint(equalToConstant: 22).isActive = true
        usage.isHidden = true
        usage.onClick = { [weak self] in
            guard let self else { return }
            self.onAction?("usage", self.usage)
        }
        usage.onHover = { [weak self] inside in
            guard let self else { return }
            self.onAction?(inside ? "usage-enter" : "usage-leave", self.usage)
        }
        glance.onClick = { [weak self] name, view in self?.onAction?(name, view) }
        for (button, name) in [(settings, "settings"), (releases, "releases"), (games, "games"), (shortcuts, "shortcuts"),
                               (panelSide, "panel-side"), (panelLayout, "panel-layout"), (panelToggle, "panel-toggle")] {
            button.target = self
            button.action = #selector(tool(_:))
            button.identifier = NSUserInterfaceItemIdentifier(name)
        }
        tools.orientation = .horizontal
        tools.spacing = 2
        tools.translatesAutoresizingMaskIntoConstraints = false
        for view in [update, attention, usage, glance, settings, releases, games, shortcuts, panelSide, panelLayout, panelToggle] as [NSView] {
            tools.addArrangedSubview(view)
        }
        tools.setCustomSpacing(10, after: update)
        tools.setCustomSpacing(6, after: attention)
        tools.setCustomSpacing(8, after: usage)
        tools.setCustomSpacing(8, after: glance)
        addSubview(tools)
        let titleLeading = title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: leading)
        self.titleLeading = titleLeading
        NSLayoutConstraint.activate([
            titleLeading,
            title.centerYAnchor.constraint(equalTo: centerYAnchor),
            track.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 16),
            track.centerYAnchor.constraint(equalTo: centerYAnchor),
            tools.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            tools.centerYAnchor.constraint(equalTo: centerYAnchor),
            tools.leadingAnchor.constraint(greaterThanOrEqualTo: track.trailingAnchor, constant: 12),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func pick(_ sender: NSButton) { onSelect?(buttons[sender.tag].0) }

    /// The tabs shown, in order, and whether the Settings gear is lit (checks).
    func state() -> [String: Any] {
        ["tabs": buttons.filter { !$0.1.isHidden }.map(\.0.rawValue), "settingsOn": settings.on, "panelButtons": !panelToggle.isHidden,
         "glance": glance.state()]
    }
    /// One of the glance's counts, as a click on it (⌘K opens its menu beneath it).
    func clickGlance(_ id: String) { glance.click(id) }
    /// The gear, as a click on it (checks).
    func clickSettings() { settings.performClick(nil) }
    @objc private func tool(_ sender: NSView) {
        if let name = sender.identifier?.rawValue { onAction?(name, sender) }
    }

    /// What the page says the tools show (its `barState` message).
    func apply(_ state: [String: Any]) {
        attentionCount = state["attention"] as? Int ?? 0
        attention.isHidden = attentionCount <= 0
        attention.toolTip = "\(attentionCount) approvals need attention"
        attention.setAccessibilityLabel(attention.toolTip)
        let meters = (state["usage"] as? [[String: Any]] ?? []).map { (pct: $0["pct"] as? Double ?? 0, tone: $0["tone"] as? String ?? "") }
        usage.meters = meters
        usage.isHidden = meters.isEmpty
        glance.apply(state["glance"] as? [[String: Any]] ?? [])
        releases.dot = state["releasesUnread"] as? Bool ?? false
        releases.setAccessibilityLabel(releases.dot ? "What's new, unseen notes" : "What's new")
        setMusicConnecting(state["musicConnecting"] as? Bool ?? false)
        let left = (state["panelSide"] as? String ?? "left") == "left"
        let compact = state["panelCompact"] as? Bool ?? true
        let collapsed = state["panelCollapsed"] as? Bool ?? false
        let move = left ? "Move panel to the right" : "Move panel to the left"
        panelSide.setSymbol(left ? "sidebar.right" : "sidebar.left", label: move)
        panelSide.toolTip = move
        let layout = compact ? "Show list and details together" : "Use compact panel"
        panelLayout.setSymbol(compact ? "rectangle.split.2x1" : "sidebar.squares.right", label: layout)
        panelLayout.toolTip = layout
        panelLayout.isEnabled = state["layoutEnabled"] as? Bool ?? true
        let toggle = collapsed ? "Show session panel" : "Hide session panel"
        panelToggle.setSymbol(collapsed ? (left ? "sidebar.left" : "sidebar.right") : "minus", label: toggle)
        panelToggle.toolTip = "\(toggle) (⌘B)"
        // The Dungeon Board has no session panel: its buttons go while it shows.
        let absent = state["panelAbsent"] as? Bool ?? false
        for button in [panelSide, panelLayout, panelToggle] where button.isHidden != absent { button.isHidden = absent }
        restyle()
    }

    /// The Settings gear pulses while the lofi radio connects, as the page's gear does.
    private func setMusicConnecting(_ on: Bool) {
        guard let layer = settings.layer else { return }
        if on, layer.animation(forKey: "connecting") == nil {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.35
            pulse.duration = 0.6
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { layer.add(pulse, forKey: "connecting") }
        } else if !on {
            layer.removeAnimation(forKey: "connecting")
        }
    }

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
        // The product's name, as the page's header had it: Barlow semibold, upper case, 0.08em apart.
        let size: CGFloat = 17
        title.attributedStringValue = NSAttributedString(string: "PASEO COMMAND", attributes: [
            .font: NSFont(name: "BarlowSemiCondensed-SemiBold", size: size) ?? .systemFont(ofSize: size - 3, weight: .semibold),
            .foregroundColor: Ink.color(Ink.strong, look),
            .kern: size * 0.08,
        ])
        attention.layer?.backgroundColor = Ink.color(Ink.accent, look).cgColor
        attention.attributedTitle = NSAttributedString(string: "  \(attentionCount) need you  ", attributes: [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: Ink.color(Ink.onAccent, look),
        ])
        for button in [settings, releases, games, shortcuts, panelSide, panelLayout, panelToggle] { button.restyle() }
        let shown = buttons.filter { !$0.1.isHidden }.map(\.0)
        for (mode, button) in buttons {
            let on = mode == self.mode
            button.layer?.backgroundColor = on ? Ink.color(Ink.pane, look).cgColor
                : button.hovered ? Ink.color(Ink.tabFocused, look, 0.6).cgColor : nil
            button.layer?.shadowOpacity = on ? 0.12 : 0
            button.layer?.shadowRadius = 1.5
            button.layer?.shadowOffset = CGSize(width: 0, height: -0.5)
            let ink = Ink.color(on ? Ink.strong : button.hovered ? Ink.mid : Ink.off, look)
            button.contentTintColor = ink
            let title = NSMutableAttributedString(string: " \(mode.title)", attributes: [
                .font: NSFont.systemFont(ofSize: 12, weight: on ? .semibold : .medium),
                .foregroundColor: ink,
            ])
            if mode == .activity && activityUnread > 0 {
                title.append(NSAttributedString(string: "  \(activityUnread > 99 ? "99+" : String(activityUnread))", attributes: [
                    .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold),
                    .foregroundColor: Ink.color(Ink.accent, look),
                ]))
            }
            button.attributedTitle = title
            let tip = "\(mode.tip) (\(mode.keys(at: shown.firstIndex(of: mode))))"
            button.toolTip = mode == .activity && activityUnread > 0 ? "\(activityUnread) unread · \(tip)" : tip
        }
    }
}
