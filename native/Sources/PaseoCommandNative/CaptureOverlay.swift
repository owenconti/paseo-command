import AppKit

/// A panel that never activates the app: clicking or drawing on it leaves the app you're in in front (activating
/// would bring Paseo Command's window up over it).
class CapturePanel: NSPanel {
    init(frame: CGRect, key: Bool = false) {
        canKey = key
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isFloatingPanel = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
    }
    private let canKey: Bool
    override var canBecomeKey: Bool { canKey }
    override var canBecomeMain: Bool { false }
}

/// The ink you draw while recording, over the whole display, in the recording (it's on screen). It lets every
/// click through to the apps beneath, but while ⇧ is held, when a drag draws a red stroke. Strokes stay until
/// cleared, so later keyframes still show what was marked.
final class InkOverlay {
    let panel: CapturePanel
    private let view = InkView()
    private var poll: Timer?
    /// A stroke ended (host time, `CACurrentMediaTime`).
    var onStroke: ((Double) -> Void)? {
        get { view.onStroke }
        set { view.onStroke = newValue }
    }

    init(screen: NSScreen) {
        panel = CapturePanel(frame: screen.frame)
        panel.level = .screenSaver
        panel.ignoresMouseEvents = true
        view.frame = CGRect(origin: .zero, size: screen.frame.size)
        view.autoresizingMask = [.width, .height]
        panel.contentView = view
    }

    func show() {
        panel.orderFrontRegardless()
        // ⇧ is read from the modifier flags (no event tap, so no Accessibility permission).
        poll = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            let drawing = NSEvent.modifierFlags.intersection(.deviceIndependentFlagsMask) == .shift || self.view.drawing
            if self.panel.ignoresMouseEvents == drawing { self.panel.ignoresMouseEvents = !drawing }
        }
    }

    var strokes: Int { view.strokes.count }
    var isDrawing: Bool { !panel.ignoresMouseEvents }
    func clear() { view.clear() }

    func close() {
        poll?.invalidate()
        poll = nil
        panel.orderOut(nil)
    }
}

final class InkView: NSView {
    private(set) var strokes: [[CGPoint]] = []
    private var current: [CGPoint]?
    var drawing: Bool { current != nil }
    var onStroke: ((Double) -> Void)?

    override var isFlipped: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        current = [convert(event.locationInWindow, from: nil)]
        needsDisplay = true
    }
    override func mouseDragged(with event: NSEvent) {
        guard current != nil else { return }
        current?.append(convert(event.locationInWindow, from: nil))
        needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) {
        guard var stroke = current else { return }
        current = nil
        // A click without a drag is a dot.
        if stroke.count == 1 { stroke.append(CGPoint(x: stroke[0].x + 0.5, y: stroke[0].y + 0.5)) }
        strokes.append(stroke)
        needsDisplay = true
        onStroke?(CACurrentMediaTime())
    }

    func clear() {
        strokes = []
        current = nil
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        for stroke in strokes + (current.map { [$0] } ?? []) where stroke.count > 1 {
            let path = NSBezierPath()
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            path.move(to: stroke[0])
            for p in stroke.dropFirst() { path.line(to: p) }
            // A pale edge keeps the ink readable on red or dark things too.
            NSColor.white.withAlphaComponent(0.7).setStroke()
            path.lineWidth = 7
            path.stroke()
            CaptureImages.ink.setStroke()
            path.lineWidth = 4.5
            path.stroke()
        }
    }
}

/// The recording's controls, a capsule at the top of the display, left out of the recording: a pulsing red dot and the
/// time, how to draw, then Clear (once there's ink), Cancel and Done (the default button; the hotkey too). A
/// non-activating panel, so its buttons work without bringing the app forward. Always dark, as a recording HUD is; laid
/// out with constraints and sized to fit, so its row stays centred (`CaptureHUDTests`).
final class CaptureHUD {
    let panel: CapturePanel
    private let time = NSTextField(labelWithString: "0:00")
    private let hint = NSTextField(labelWithString: "")
    private let clear = PillButton()
    private var timer: Timer?
    private let started = Date()
    var onDone: (() -> Void)?
    var onCancel: (() -> Void)?
    var onClear: (() -> Void)?

    static let height: CGFloat = 44
    /// What the hint may say, so its width never changes as it does.
    static let hints = ["Starting…", "Hold ⇧ and drag to draw", "Saving…"]

    init(screen: NSScreen, hotkey: String) {
        panel = CapturePanel(frame: CGRect(x: 0, y: 0, width: 400, height: Self.height))
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
        panel.hasShadow = true
        // Never in a screenshot or recording of the screen, where the system honours it.
        panel.sharingType = .none
        panel.appearance = NSAppearance(named: .darkAqua)

        let effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = Self.height / 2
        effect.layer?.cornerCurve = .continuous
        effect.layer?.masksToBounds = true
        effect.layer?.borderWidth = 1
        effect.layer?.borderColor = NSColor(white: 1, alpha: 0.12).cgColor
        panel.contentView = effect

        // The dot pulses while it records (still under reduced motion).
        let dot = NSView()
        dot.wantsLayer = true
        dot.layer?.backgroundColor = NSColor.systemRed.cgColor
        dot.layer?.cornerRadius = 5
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.35
            pulse.duration = 0.8
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            dot.layer?.add(pulse, forKey: "pulse")
        }
        time.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        time.textColor = .labelColor
        let divider = NSView()
        divider.wantsLayer = true
        divider.layer?.backgroundColor = NSColor(white: 1, alpha: 0.18).cgColor
        hint.font = .systemFont(ofSize: 13)
        hint.textColor = .secondaryLabelColor
        hint.lineBreakMode = .byTruncatingTail
        let hintWidth = Self.hints.map { ($0 as NSString).size(withAttributes: [.font: hint.font!]).width }.max()! + 4

        func button(_ b: PillButton, _ title: String, _ action: Selector, tip: String) -> PillButton {
            b.title = title
            b.target = self
            b.action = action
            b.toolTip = tip
            return b
        }
        _ = button(clear, "Clear", #selector(clearInk), tip: "Erase what you've drawn (it stays in the frames already recorded)")
        clear.isEnabled = false
        let cancel = button(PillButton(), "Cancel", #selector(cancel), tip: "Stop and keep nothing")
        let done = button(PillButton(prominent: true), "Done", #selector(done), tip: "Finish and choose who gets it (\(hotkey))")
        done.keyEquivalent = "\r"

        let row = NSStackView(views: [dot, time, divider, hint, clear, cancel, done])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 8
        row.setCustomSpacing(12, after: time)
        row.setCustomSpacing(12, after: divider)
        row.setCustomSpacing(16, after: hint)
        row.setCustomSpacing(6, after: clear)
        row.setCustomSpacing(6, after: cancel)
        row.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(row)
        for v in [dot, divider, hint] { v.translatesAutoresizingMaskIntoConstraints = false }
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 10), dot.heightAnchor.constraint(equalToConstant: 10),
            divider.widthAnchor.constraint(equalToConstant: 1), divider.heightAnchor.constraint(equalToConstant: 18),
            hint.widthAnchor.constraint(equalToConstant: ceil(hintWidth)),
            // The time keeps its width as minutes go by.
            time.widthAnchor.constraint(greaterThanOrEqualToConstant: ceil(("00:00" as NSString).size(withAttributes: [.font: time.font!]).width) + 2),
            row.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 18),
            row.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -10),
            row.centerYAnchor.constraint(equalTo: effect.centerYAnchor),
        ])
        hint.stringValue = Self.hints[1]
        // As wide as the row, centred below the menu bar (and the notch).
        let width = ceil(row.fittingSize.width) + 28
        let top = screen.visibleFrame.maxY
        panel.setFrame(CGRect(x: round(screen.frame.midX - width / 2), y: top - Self.height - 10, width: width, height: Self.height), display: false)
    }

    func show() {
        panel.orderFrontRegardless()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            let s = Int(Date().timeIntervalSince(self.started))
            self.time.stringValue = "\(s / 60):" + String(format: "%02d", s % 60)
        }
    }

    func say(_ text: String) { hint.stringValue = text }
    /// Clear is offered once there's ink to clear.
    func canClear(_ yes: Bool) { clear.isEnabled = yes }

    func close() {
        timer?.invalidate()
        panel.orderOut(nil)
    }

    @objc private func done() { onDone?() }
    @objc private func cancel() { onCancel?() }
    @objc private func clearInk() { onClear?() }
}

/// The capsule's buttons, drawn the same whether or not their panel is key (it never is: a system button would draw
/// gray and flat): a rounded pill, the accent filled for the main one, a faint one otherwise, dimmer while disabled.
final class PillButton: NSButton {
    private let prominent: Bool
    init(prominent: Bool = false) {
        self.prominent = prominent
        super.init(frame: .zero)
        isBordered = false
        bezelStyle = .regularSquare
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.cornerCurve = .continuous
        font = .systemFont(ofSize: 13, weight: prominent ? .semibold : .medium)
        focusRingType = .none
        setButtonType(.momentaryChange)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var title: String { didSet { restyle() } }
    override var isEnabled: Bool { didSet { restyle() } }
    override var isHighlighted: Bool { didSet { restyle() } }
    override var intrinsicContentSize: NSSize {
        let text = (title as NSString).size(withAttributes: [.font: font ?? .systemFont(ofSize: 13)])
        return NSSize(width: ceil(text.width) + 26, height: 28)
    }
    override func updateLayer() { restyle() }
    override var wantsUpdateLayer: Bool { true }

    private func restyle() {
        let fill: NSColor = prominent ? .controlAccentColor : NSColor(white: 1, alpha: 0.14)
        let pressed = isHighlighted ? 0.75 : 1.0
        layer?.backgroundColor = fill.withAlphaComponent(fill.alphaComponent * (isEnabled ? pressed : 0.45)).cgColor
        attributedTitle = NSAttributedString(string: title, attributes: [
            .font: font ?? .systemFont(ofSize: 13),
            .foregroundColor: NSColor.white.withAlphaComponent(isEnabled ? 1 : 0.4),
        ])
        invalidateIntrinsicContentSize()
    }
}
