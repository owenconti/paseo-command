import AppKit
import WebKit

/// Back, forward, reload and the address, along the top of Conquer's page.
/// Whoever owns it sets the buttons' actions.
final class PageBar: NSView {
    let back = ChromeButton()
    let forward = ChromeButton()
    let reload = ChromeButton()
    let address = ChromeTextField()
    let row = NSStackView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        for (button, symbol, help) in [(back, "chevron.left", "Back (⌘[)"), (forward, "chevron.right", "Forward (⌘])"),
                                       (reload, "arrow.clockwise", "Reload page")] {
            button.configure(symbol: symbol, help: help)
        }
        address.placeholderString = "Search or enter address"
        address.setAccessibilityLabel("Search or enter address")
        address.translatesAutoresizingMaskIntoConstraints = false
        address.heightAnchor.constraint(equalToConstant: Chrome.metric("control-sm", effectiveAppearance)).isActive = true
        address.setContentHuggingPriority(.init(1), for: .horizontal)
        for v in [back, forward, reload, address] { row.addArrangedSubview(v) }
        row.orientation = .horizontal
        row.spacing = 4
        row.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        let line = ChromeSurface()
        line.divider = true
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 44),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.heightAnchor.constraint(equalToConstant: 1),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        restyle()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        restyle()
    }
    private func restyle() {
        layer?.backgroundColor = Chrome.color("panel", effectiveAppearance).cgColor
    }

    /// Show `web`'s state: back and forward, reload or stop, and its address (unless it is being typed).
    func show(_ web: WKWebView?) {
        back.isEnabled = web?.canGoBack ?? false
        forward.isEnabled = web?.canGoForward ?? false
        let loading = web?.isLoading == true
        let help = loading ? "Stop loading" : "Reload page"
        reload.image = NSImage(systemSymbolName: loading ? "xmark" : "arrow.clockwise", accessibilityDescription: help)
        reload.toolTip = help
        reload.setAccessibilityLabel(help)
        if address.currentEditor() == nil { address.stringValue = web?.url?.scheme?.hasPrefix("http") == true ? web?.url?.absoluteString ?? "" : "" }
    }
}
