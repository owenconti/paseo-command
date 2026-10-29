import AppKit
import CoreText

/// The window's cover while the app loads (at launch and on every ⌘R), in
/// the page's Galaxy theme: the app icon, the name as the panel header sets
/// it, and a line saying what it is waiting for. It takes every pointer
/// event while it shows, so the half-loaded page and map underneath are
/// never seen or touched.
final class SplashView: NSView {
    private let status = NSTextField(labelWithString: "")
    private let icon = NSImageView()
    private(set) var showing = true

    /// The Galaxy theme's tokens (web/src/themes.css).
    private static let bg = Textures.color(0x070c11)
    private static let textStrong = Textures.color(0xf0efea)
    private static let text3 = Textures.color(0x92a3b0)

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = Self.bg.cgColor
        Self.registerFonts()

        icon.image = NSApp.applicationIconImage
        icon.imageScaling = .scaleProportionallyUpOrDown
        // The header's title: Barlow semibold, upper case, 0.08em apart.
        let title = NSTextField(labelWithString: "")
        let size: CGFloat = 26
        title.attributedStringValue = NSAttributedString(string: "PASEO COMMAND", attributes: [
            .font: NSFont(name: "BarlowSemiCondensed-SemiBold", size: size) ?? .systemFont(ofSize: size, weight: .semibold),
            .foregroundColor: Self.textStrong,
            .kern: size * 0.08,
        ])
        status.font = NSFont(name: "SourceSans3-Roman_Regular", size: 14) ?? NSFont(name: "SourceSans3-Roman", size: 14) ?? .systemFont(ofSize: 13)
        status.textColor = Self.text3
        for view in [icon, title, status] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: centerXAnchor),
            icon.bottomAnchor.constraint(equalTo: centerYAnchor, constant: 10),
            icon.widthAnchor.constraint(equalToConstant: 128),
            icon.heightAnchor.constraint(equalToConstant: 128),
            title.centerXAnchor.constraint(equalTo: centerXAnchor),
            title.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 14),
            status.centerXAnchor.constraint(equalTo: centerXAnchor),
            status.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The page's fonts, bundled beside the icon (see native/scripts/bundle.sh).
    private static let registerFonts: () -> Void = {
        var done = false
        return {
            guard !done else { return }
            done = true
            for name in ["paseo-barlow-600", "paseo-source-sans-400"] {
                if let url = Bundle.main.url(forResource: name, withExtension: "woff2") {
                    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
                }
            }
        }
    }()

    func say(_ text: String) { status.stringValue = text }

    /// Cover the window again, at once.
    func show(_ text: String) {
        say(text)
        showing = true
        isHidden = false
        alphaValue = 1
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
        })
    }

    override func hitTest(_ point: NSPoint) -> NSView? { showing ? self : nil }
    override func resetCursorRects() { if showing { addCursorRect(bounds, cursor: .arrow) } }
}
