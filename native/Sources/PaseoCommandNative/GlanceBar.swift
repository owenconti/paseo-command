import AppKit

/// One count of the glance (the page's `web/src/crew/Glance.tsx`, sent in its `barState` as `glance`): a Linear
/// state's issues, the pull requests asking your review or assigned to you, or Diagonal's health.
struct GlanceItem: Equatable {
    let id: String
    /// Linear, GitHub or Diagonal: a muted name heads each group.
    let group: String
    let text: String
    /// Dots before the text, as `#rrggbb` (a Linear state's colour, a database service's light).
    let dots: [String]
    /// An SF Symbol before the text, by the page's name for it.
    let icon: String
    /// How the text reads: "" (strong), "none" (nothing there), "ask" (waits on you), "slow", "bad".
    let tone: String
    let tip: String

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, !id.isEmpty, id.count <= 80 else { return nil }
        self.id = id
        group = String((raw["group"] as? String ?? "").prefix(20))
        text = String((raw["text"] as? String ?? "").prefix(24))
        dots = (raw["dots"] as? [String] ?? []).prefix(8).filter { $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }
        icon = raw["icon"] as? String ?? ""
        tone = raw["tone"] as? String ?? ""
        tip = String((raw["tip"] as? String ?? "").prefix(300))
    }

    static func symbol(_ icon: String) -> String? {
        switch icon {
        case "review": return "arrow.triangle.pull"
        case "assigned": return "person.crop.circle.badge.checkmark"
        case "warning": return "exclamationmark.triangle"
        default: return nil
        }
    }

    static func hex(_ text: String) -> NSColor? {
        guard let value = Int(text.dropFirst(), radix: 16) else { return nil }
        return Textures.color(value)
    }
}

/// A count on the bar: its dots, icon and text, lit on hover, with a pointing hand. A button, so the
/// title bar passes its clicks through as it does the other tools'.
final class GlanceChip: NSButton {
    var item: GlanceItem { didSet { if item != oldValue { refresh() } } }
    private(set) var hovered = false
    private let dot: CGFloat = 7, gap: CGFloat = 4, pad: CGFloat = 7

    init(_ item: GlanceItem) {
        self.item = item
        super.init(frame: .zero)
        isBordered = false
        title = ""
        wantsLayer = true
        layer?.cornerRadius = 6
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 22).isActive = true
        refresh()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func refresh() {
        toolTip = item.tip
        setAccessibilityLabel(item.tip)
        identifier = NSUserInterfaceItemIdentifier("glance:\(item.id)")
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private var icon: NSImage? {
        GlanceItem.symbol(item.icon).flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .regular))
    }
    private func label(_ look: NSAppearance) -> NSAttributedString {
        let color: NSColor = switch item.tone {
        case "none": Ink.color(Ink.off, look)
        case "ask", "slow": .systemOrange
        case "bad": Ink.color("red-text", look)
        default: Ink.color(Ink.strong, look)
        }
        return NSAttributedString(string: item.text, attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: item.tone == "none" ? .regular : .semibold),
            .foregroundColor: color,
        ])
    }

    override var intrinsicContentSize: NSSize {
        var width = pad * 2
        if !item.dots.isEmpty { width += CGFloat(item.dots.count) * dot + CGFloat(item.dots.count - 1) * 3 + gap }
        if let icon { width += icon.size.width + gap }
        width += ceil(label(effectiveAppearance).size().width)
        return NSSize(width: width, height: 22)
    }

    override func draw(_ dirtyRect: NSRect) {
        let look = effectiveAppearance
        var x = pad
        for hex in item.dots {
            let circle = NSBezierPath(ovalIn: NSRect(x: x, y: (bounds.height - dot) / 2, width: dot, height: dot))
            (GlanceItem.hex(hex) ?? Ink.color(Ink.faint, look)).setFill()
            circle.fill()
            // A hairline ring, so a pale state's dot (Linear's Todo) still shows on either bar.
            Ink.color(Ink.divider, look, 0.7).setStroke()
            circle.lineWidth = 0.5
            circle.stroke()
            x += dot + 3
        }
        if !item.dots.isEmpty { x += gap - 3 }
        if let icon {
            let tint = Ink.color(item.tone == "ask" ? Ink.mid : Ink.faint, look)
            let tinted = NSImage(size: icon.size, flipped: false) { rect in
                icon.draw(in: rect)
                tint.set()
                rect.fill(using: .sourceAtop)
                return true
            }
            tinted.draw(in: NSRect(x: x, y: (bounds.height - icon.size.height) / 2, width: icon.size.width, height: icon.size.height))
            x += icon.size.width + gap
        }
        let text = label(look)
        let size = text.size()
        text.draw(at: NSPoint(x: x, y: (bounds.height - size.height) / 2))
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; restyle() }
    override func mouseExited(with event: NSEvent) { hovered = false; restyle() }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); restyle(); invalidateIntrinsicContentSize() }
    func restyle() {
        layer?.backgroundColor = hovered ? Ink.color(Ink.tabFocused, effectiveAppearance, 0.6).cgColor : nil
        needsDisplay = true
    }
}

/// The glance on the top bar, left of the Settings gear: each group's name, then its counts.
/// A count's click is the bar's `glance:<id>` action, so the page opens its menu beneath it.
final class GlanceBar: NSStackView {
    var onClick: ((String, NSView) -> Void)?
    private(set) var items: [GlanceItem] = []

    override init(frame: NSRect) {
        super.init(frame: frame)
        orientation = .horizontal
        spacing = 0
        translatesAutoresizingMaskIntoConstraints = false
        isHidden = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func apply(_ raw: [[String: Any]]) {
        let next = raw.compactMap(GlanceItem.init)
        guard next != items else { return }
        items = next
        arrangedSubviews.forEach { $0.removeFromSuperview() }
        var group = ""
        for item in next {
            if item.group != group {
                group = item.group
                if let last = arrangedSubviews.last { setCustomSpacing(12, after: last) }
                let name = NSTextField(labelWithString: item.group)
                name.font = .systemFont(ofSize: 11, weight: .medium)
                name.textColor = Ink.color(Ink.faint, effectiveAppearance)
                addArrangedSubview(name)
                setCustomSpacing(2, after: name)
            }
            let chip = GlanceChip(item)
            chip.target = self
            chip.action = #selector(clicked(_:))
            addArrangedSubview(chip)
        }
        isHidden = next.isEmpty
    }

    /// A count by id, as a click on it (⌘K's entries, checks).
    func click(_ id: String) {
        guard let chip = arrangedSubviews.compactMap({ $0 as? GlanceChip }).first(where: { $0.item.id == id }) else { return }
        clicked(chip)
    }

    @objc private func clicked(_ sender: GlanceChip) { onClick?("glance:\(sender.item.id)", sender) }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        for case let name as NSTextField in arrangedSubviews { name.textColor = Ink.color(Ink.faint, effectiveAppearance) }
    }

    /// What it shows (checks).
    func state() -> [[String: Any]] {
        items.map { ["id": $0.id, "group": $0.group, "text": $0.text, "dots": $0.dots, "tone": $0.tone] }
    }
}
