import AppKit
import QuartzCore

/// The window's cover while the app loads (at launch and on every ⌘R): the
/// sea, a cluster of parchment hexes and the app's name, with a line saying
/// what it is waiting for. It takes every pointer event while it shows, so
/// the half-loaded page and map underneath are never seen or touched.
final class SplashView: NSView {
    private let status = NSTextField(labelWithString: "")
    private let emblem = CALayer()
    private var hexes: [CAShapeLayer] = []
    private(set) var showing = true

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        let sea = CAGradientLayer()
        sea.type = .radial
        sea.colors = [Textures.color(0x22789a).cgColor, Textures.color(0x0d3244).cgColor]
        sea.startPoint = CGPoint(x: 0.5, y: 0.5)
        sea.endPoint = CGPoint(x: 1.1, y: 1.1)
        layer = sea

        // Seven pointy-top hexes: a landmark ringed by its workspaces.
        let r: CGFloat = 17
        let w = sqrt(3) * r
        let centres = [CGPoint.zero] + (0..<6).map { i -> CGPoint in
            let a = CGFloat(i) * .pi / 3
            return CGPoint(x: cos(a) * w, y: sin(a) * w)
        }
        for (i, c) in centres.enumerated() {
            let path = CGMutablePath()
            for k in 0..<6 {
                let a = CGFloat(k) * .pi / 3 + .pi / 6
                let p = CGPoint(x: c.x + cos(a) * (r - 1.5), y: c.y + sin(a) * (r - 1.5))
                k == 0 ? path.move(to: p) : path.addLine(to: p)
            }
            path.closeSubpath()
            let hex = CAShapeLayer()
            hex.path = path
            // The middle one is a robot's orange; the ring is parchment.
            hex.fillColor = Textures.color(i == 0 ? 0xe07a3c : 0xf2e1b2).cgColor
            hex.strokeColor = Textures.color(i == 0 ? 0xa04f20 : 0xb89a5e).cgColor
            hex.lineWidth = 1.5
            emblem.addSublayer(hex)
            hexes.append(hex)
        }
        emblem.shadowColor = NSColor.black.cgColor
        emblem.shadowOpacity = 0.35
        emblem.shadowRadius = 8
        emblem.shadowOffset = CGSize(width: 0, height: -3)
        sea.addSublayer(emblem)

        let title = NSTextField(labelWithString: "Paseo Command")
        let serif = NSFont.systemFont(ofSize: 28, weight: .semibold).fontDescriptor.withDesign(.serif)
        title.font = serif.flatMap { NSFont(descriptor: $0, size: 28) } ?? .systemFont(ofSize: 28, weight: .semibold)
        title.textColor = Textures.color(0xf2e1b2)
        status.font = .systemFont(ofSize: 13)
        status.textColor = Textures.color(0xf2e1b2).withAlphaComponent(0.7)
        for label in [title, status] {
            label.alignment = .center
            label.translatesAutoresizingMaskIntoConstraints = false
            addSubview(label)
        }
        NSLayoutConstraint.activate([
            title.centerXAnchor.constraint(equalTo: centerXAnchor),
            title.topAnchor.constraint(equalTo: centerYAnchor, constant: 58),
            status.centerXAnchor.constraint(equalTo: centerXAnchor),
            status.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
        ])
        animate()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        emblem.position = CGPoint(x: bounds.midX, y: bounds.midY + 20)
        CATransaction.commit()
    }

    /// The ring lights up hex by hex, round and round (held still under reduced motion).
    private func animate() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        for (i, hex) in hexes.enumerated() where i > 0 {
            let pulse = CAKeyframeAnimation(keyPath: "opacity")
            pulse.values = [1, 0.35, 1]
            pulse.keyTimes = [0, 0.5, 1]
            pulse.duration = 1.8
            pulse.repeatCount = .infinity
            pulse.beginTime = CACurrentMediaTime() + Double(i - 1) * 0.3
            hex.add(pulse, forKey: "pulse")
        }
    }

    func say(_ text: String) { status.stringValue = text }

    /// Cover the window again, at once.
    func show(_ text: String) {
        say(text)
        showing = true
        isHidden = false
        alphaValue = 1
        if hexes.last?.animation(forKey: "pulse") == nil { animate() }
    }

    /// Fade away, revealing the app.
    func hide() {
        guard showing else { return }
        showing = false
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.35
            animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, !self.showing else { return }
            self.isHidden = true
            self.hexes.forEach { $0.removeAllAnimations() }
        })
    }

    override func hitTest(_ point: NSPoint) -> NSView? { showing ? self : nil }
    override func resetCursorRects() { if showing { addCursorRect(bounds, cursor: .arrow) } }
}
