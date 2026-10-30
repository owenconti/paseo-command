import AppKit
import CoreText

/// Native equivalents of React's icon-btn, secondary and input primitives.
/// All colors and control metrics come from the same CSS tokens at build time.
enum Chrome {
    static func dark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
    static func color(_ token: String, _ appearance: NSAppearance) -> NSColor {
        let pair = NativeTheme.colors[token]!
        let value = dark(appearance) ? pair.dark : pair.light
        let rgb = value >> 8
        return NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255,
                       green: CGFloat((rgb >> 8) & 255) / 255,
                       blue: CGFloat(rgb & 255) / 255,
                       alpha: CGFloat(value & 255) / 255)
    }
    static func metric(_ token: String, _ appearance: NSAppearance) -> CGFloat {
        let pair = NativeTheme.metrics[token]!
        return dark(appearance) ? pair.dark : pair.light
    }
    private static let registerFonts: Void = {
        for name in ["paseo-source-sans-400", "inter-latin-wght-normal"] {
            if let url = Bundle.main.url(forResource: name, withExtension: "woff2") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }()
    static func font(_ appearance: NSAppearance, small: Bool = false, weight: NSFont.Weight = .regular) -> NSFont {
        _ = registerFonts
        let size = metric(small ? "fs-xs" : "fs-sm", appearance)
        let suffix = weight >= .semibold ? "SemiBold" : weight >= .medium ? "Medium" : "Regular"
        let name = dark(appearance) ? "SourceSans3-Roman_\(suffix)"
            : suffix == "Regular" ? "Inter-Regular" : "Inter-Regular_\(suffix)"
        return NSFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight)
    }
}

/// A flat icon/secondary button with the chat panel's hover, pressed, disabled
/// and focus states. NSButton retains keyboard activation and accessibility.
final class ChromeButton: NSButton {
    var secondary = false
    var accented = false { didSet { needsDisplay = true } }
    private var hovered = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        isBordered = false
        focusRingType = .none
        setButtonType(.momentaryPushIn)
        title = ""
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(symbol: String?, title: String = "", help: String, compact: Bool = false) {
        self.title = title
        image = symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: help) }
        toolTip = help
        setAccessibilityLabel(help)
        translatesAutoresizingMaskIntoConstraints = false
        let height: CGFloat = compact ? 22 : Chrome.metric("control-sm", effectiveAppearance)
        heightAnchor.constraint(equalToConstant: height).isActive = true
        if title.isEmpty { widthAnchor.constraint(equalToConstant: height).isActive = true }
        else { widthAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true }
    }

    override var intrinsicContentSize: NSSize { NSSize(width: title.isEmpty ? Chrome.metric("control-sm", effectiveAppearance) : 60,
                                                         height: Chrome.metric("control-sm", effectiveAppearance)) }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func resetCursorRects() { if isEnabled { addCursorRect(bounds, cursor: .pointingHand) } }
    override func becomeFirstResponder() -> Bool { let result = super.becomeFirstResponder(); needsDisplay = true; return result }
    override func resignFirstResponder() -> Bool { let result = super.resignFirstResponder(); needsDisplay = true; return result }

    override func draw(_ dirtyRect: NSRect) {
        let look = effectiveAppearance
        let pressed = cell?.isHighlighted == true && isEnabled
        let active = (hovered || pressed) && isEnabled
        let radius = Chrome.metric("radius-md", look)
        let rect = bounds.insetBy(dx: 2, dy: 2)
        if secondary || active {
            Chrome.color(active ? "fill-strong" : "fill", look).setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
        }
        let ink = Chrome.color(accented ? "accent" : active ? "text" : secondary ? "text-2" : "text-3", look)
            .withAlphaComponent(isEnabled ? 1 : 0.45)
        let offset: CGFloat = pressed ? -0.5 : 0
        if let image {
            let configured = image.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))?
                .withSymbolConfiguration(.init(paletteColors: [ink])) ?? image
            configured.draw(in: CGRect(x: bounds.midX - 7, y: bounds.midY - 7 + offset, width: 14, height: 14),
                            from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        } else {
            let text = NSAttributedString(string: title, attributes: [.font: Chrome.font(look, weight: .medium), .foregroundColor: ink])
            let size = text.size()
            text.draw(at: CGPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2 + offset))
        }
        if window?.firstResponder === self {
            Chrome.color("focus", look).setStroke()
            let ring = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: radius + 1, yRadius: radius + 1)
            ring.lineWidth = 2
            ring.stroke()
        }
    }
}

/// Insets and vertically centres the editable text without the stock AppKit bezel.
private final class ChromeTextCell: NSTextFieldCell {
    override func drawingRect(forBounds rect: NSRect) -> NSRect {
        var r = rect.insetBy(dx: 10, dy: 0)
        let height = cellSize(forBounds: r).height
        r.origin.y += max(0, (r.height - height) / 2)
        r.size.height = min(r.height, height)
        return r
    }
    override func titleRect(forBounds rect: NSRect) -> NSRect { drawingRect(forBounds: rect) }
    override func edit(withFrame rect: NSRect, in view: NSView, editor: NSText, delegate: Any?, event: NSEvent?) {
        super.edit(withFrame: drawingRect(forBounds: rect), in: view, editor: editor, delegate: delegate, event: event)
    }
    override func select(withFrame rect: NSRect, in view: NSView, editor: NSText, delegate: Any?, start: Int, length: Int) {
        super.select(withFrame: drawingRect(forBounds: rect), in: view, editor: editor, delegate: delegate, start: start, length: length)
    }
}

final class ChromeTextField: NSTextField {
    private var hovered = false
    // Setting an attributed placeholder can clear AppKit's plain placeholder;
    // retain its copy so appearance changes can recolor it.
    private var prompt: String?
    override init(frame: NSRect) {
        super.init(frame: frame)
        cell = ChromeTextCell(textCell: "")
        isEditable = true
        isSelectable = true
        isBordered = false
        isBezeled = false
        drawsBackground = false
        focusRingType = .none
        lineBreakMode = .byTruncatingTail
        cell?.isScrollable = true
        cell?.wraps = false
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var intrinsicContentSize: NSSize { NSSize(width: 160, height: Chrome.metric("control-sm", effectiveAppearance)) }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); restyle() }
    private func restyle() {
        font = Chrome.font(effectiveAppearance)
        textColor = Chrome.color("text", effectiveAppearance)
        if let prompt {
            placeholderAttributedString = NSAttributedString(string: prompt, attributes: [
                .font: Chrome.font(effectiveAppearance), .foregroundColor: Chrome.color("text-4", effectiveAppearance),
            ])
        }
        styleEditor()
        needsDisplay = true
    }
    override var placeholderString: String? { didSet { prompt = placeholderString; restyle() } }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func textDidBeginEditing(_ notification: Notification) {
        styleEditor()
        super.textDidBeginEditing(notification)
    }
    override func becomeFirstResponder() -> Bool {
        let result = super.becomeFirstResponder()
        styleEditor()
        return result
    }
    private func styleEditor() {
        needsDisplay = true
        if let editor = currentEditor() as? NSTextView {
            editor.insertionPointColor = Chrome.color("accent", effectiveAppearance)
            editor.selectedTextAttributes = [.backgroundColor: Chrome.color("selection", effectiveAppearance),
                                             .foregroundColor: Chrome.color("text", effectiveAppearance)]
        }
    }
    override func textDidEndEditing(_ notification: Notification) {
        needsDisplay = true
        super.textDidEndEditing(notification)
    }
    override func draw(_ dirtyRect: NSRect) {
        let look = effectiveAppearance
        let editing = currentEditor() != nil
        let rect = bounds.insetBy(dx: 1, dy: 1)
        let radius = Chrome.metric("radius-md", look)
        let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        Chrome.color("input-bg", look).setFill()
        path.fill()
        Chrome.color(editing ? "focus" : hovered ? "line-hover" : "line-strong", look).setStroke()
        path.lineWidth = editing ? 2 : 1
        path.stroke()
        super.draw(dirtyRect)
    }
}

/// Panel surface and divider in the React theme (also used by suggestions and downloads).
final class ChromeSurface: NSView {
    var raised = false
    var divider = false
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        Chrome.color(raised ? "panel-raised" : "panel", effectiveAppearance).setFill()
        bounds.fill()
        if divider {
            Chrome.color("line", effectiveAppearance).setFill()
            CGRect(x: 0, y: isFlipped ? bounds.maxY - 1 : 0, width: bounds.width, height: 1).fill()
        }
    }
}

final class ChromeLabel: NSTextField {
    private let token: String
    private let small: Bool
    private let weight: NSFont.Weight
    init(_ text: String, token: String = "text", small: Bool = false, weight: NSFont.Weight = .regular) {
        self.token = token
        self.small = small
        self.weight = weight
        super.init(frame: .zero)
        stringValue = text
        isEditable = false
        isSelectable = false
        isBordered = false
        drawsBackground = false
        lineBreakMode = .byTruncatingTail
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); restyle() }
    private func restyle() {
        font = Chrome.font(effectiveAppearance, small: small, weight: weight)
        textColor = Chrome.color(token, effectiveAppearance)
    }
}
