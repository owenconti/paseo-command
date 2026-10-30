import AppKit
import WebKit

/// Back, forward, reload and the address, along the top of Conquer's page.
/// Whoever owns it sets the buttons' actions.
final class PageBar: NSView {
    let back = NSButton()
    let forward = NSButton()
    let reload = NSButton()
    let address = NSTextField()
    let row = NSStackView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        for (button, symbol, help) in [(back, "chevron.left", "Back (⌘[)"), (forward, "chevron.right", "Forward (⌘])"),
                                       (reload, "arrow.clockwise", "Reload page")] {
            button.bezelStyle = .accessoryBarAction
            button.controlSize = .small
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: help)
            button.toolTip = help
        }
        address.placeholderString = "Search or enter address"
        address.font = .systemFont(ofSize: 12)
        address.bezelStyle = .roundedBezel
        address.focusRingType = .none
        address.lineBreakMode = .byTruncatingTail
        address.cell?.isScrollable = true
        address.cell?.wraps = false
        address.setContentHuggingPriority(.init(1), for: .horizontal)
        for v in [back, forward, reload, address] { row.addArrangedSubview(v) }
        row.orientation = .horizontal
        row.spacing = 4
        row.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 10)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        let line = NSBox()
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 38),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
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
    private func restyle() { layer?.backgroundColor = Ink.color(Ink.base, effectiveAppearance).cgColor }

    /// Show `web`'s state: back and forward, reload or stop, and its address (unless it is being typed).
    func show(_ web: WKWebView?) {
        back.isEnabled = web?.canGoBack ?? false
        forward.isEnabled = web?.canGoForward ?? false
        let loading = web?.isLoading == true
        reload.image = NSImage(systemSymbolName: loading ? "xmark" : "arrow.clockwise", accessibilityDescription: loading ? "Stop" : "Reload")
        if address.currentEditor() == nil { address.stringValue = web?.url?.scheme?.hasPrefix("http") == true ? web?.url?.absoluteString ?? "" : "" }
    }
}
