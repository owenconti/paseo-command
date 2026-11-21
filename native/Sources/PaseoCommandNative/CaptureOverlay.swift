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

/// The recording's controls, a capsule at the top of the display, left out of the recording: the time, how to
/// draw, Clear ink, Done (the hotkey too) and Cancel. A non-activating panel, so its buttons work without bringing
/// the app forward.
final class CaptureHUD {
    let panel: CapturePanel
    private let time = NSTextField(labelWithString: "0:00")
    private let hint = NSTextField(labelWithString: "")
    private var timer: Timer?
    private let started = Date()
    var onDone: (() -> Void)?
    var onCancel: (() -> Void)?
    var onClear: (() -> Void)?

    init(screen: NSScreen, hotkey: String) {
        let size = CGSize(width: 470, height: 40)
        // Below the menu bar (and the notch), centred.
        let top = screen.visibleFrame.maxY
        panel = CapturePanel(frame: CGRect(x: screen.frame.midX - size.width / 2, y: top - size.height - 8, width: size.width, height: size.height))
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
        panel.hasShadow = true
        // Never in a screenshot or recording of the screen, where the system honours it.
        panel.sharingType = .none
        let effect = NSVisualEffectView(frame: CGRect(origin: .zero, size: size))
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = size.height / 2
        effect.layer?.masksToBounds = true
        panel.contentView = effect

        let dot = NSView()
        dot.wantsLayer = true
        dot.layer?.backgroundColor = NSColor.systemRed.cgColor
        dot.layer?.cornerRadius = 5
        dot.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([dot.widthAnchor.constraint(equalToConstant: 10), dot.heightAnchor.constraint(equalToConstant: 10)])
        time.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        hint.stringValue = "Hold ⇧ and drag to draw"
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor
        func button(_ title: String, _ action: Selector, tip: String) -> NSButton {
            let b = NSButton(title: title, target: self, action: action)
            b.bezelStyle = .rounded
            b.controlSize = .small
            b.toolTip = tip
            return b
        }
        let clear = button("Clear ink", #selector(clearInk), tip: "Erase what you've drawn (it stays in the frames already recorded)")
        let done = button("Done", #selector(done), tip: "Finish and choose who gets it (\(hotkey))")
        done.keyEquivalent = "\r"
        let cancel = button("Cancel", #selector(cancel), tip: "Stop and keep nothing")
        let row = NSStackView(views: [dot, time, hint, NSView(), clear, cancel, done])
        row.orientation = .horizontal
        row.spacing = 8
        row.edgeInsets = NSEdgeInsets(top: 0, left: 16, bottom: 0, right: 8)
        row.alignment = .centerY
        row.frame = effect.bounds
        row.autoresizingMask = [.width, .height]
        effect.addSubview(row)
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

    func close() {
        timer?.invalidate()
        panel.orderOut(nil)
    }

    @objc private func done() { onDone?() }
    @objc private func cancel() { onCancel?() }
    @objc private func clearInk() { onClear?() }
}
