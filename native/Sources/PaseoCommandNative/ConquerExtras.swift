import AppKit
import WebKit

/// The pages Conquer has shown, for the address bar's suggestions. Kept in
/// the app's support folder (check runs keep theirs in memory).
final class ConquerHistory {
    struct Visit: Codable {
        var url: String
        var title: String
        var visits: Int
        var last: Date
    }
    private var visits: [String: Visit] = [:]
    private let file: URL?
    private var saving: DispatchWorkItem?
    private static let limit = 5000

    init(persistent: Bool) {
        // The flavour's own folder, so a dev copy never shares the released app's history.
        if persistent {
            let folder = AppFlavor.dataFolder
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            file = folder.appendingPathComponent("conquer-history.json")
        } else { file = nil }
        if let file, let data = try? Data(contentsOf: file), let list = try? JSONDecoder().decode([Visit].self, from: data) {
            for v in list { visits[v.url] = v }
        }
    }

    /// A page was shown (its title may come later: `retitle`).
    func record(_ url: URL, title: String) {
        guard url.scheme?.hasPrefix("http") == true else { return }
        let key = url.absoluteString
        var v = visits[key] ?? Visit(url: key, title: title, visits: 0, last: Date())
        v.visits += 1
        v.last = Date()
        if !title.isEmpty { v.title = title }
        visits[key] = v
        save()
    }

    func retitle(_ url: URL, _ title: String) {
        guard !title.isEmpty, visits[url.absoluteString] != nil, visits[url.absoluteString]?.title != title else { return }
        visits[url.absoluteString]?.title = title
        save()
    }

    /// The best pages for what's typed: every word in the address or title,
    /// those whose host starts with it first, then by how often and how lately.
    func suggestions(for text: String, limit: Int = 8) -> [Visit] {
        let words = text.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [] }
        let first = words[0]
        let now = Date()
        func score(_ v: Visit) -> Double {
            let host = (URL(string: v.url)?.host ?? "").lowercased().replacingOccurrences(of: "www.", with: "")
            let days = now.timeIntervalSince(v.last) / 86400
            return (host.hasPrefix(first) ? 1000 : 0) + Double(v.visits) * 10 / (1 + days)
        }
        return visits.values
            .filter { v in words.allSatisfy { v.url.lowercased().contains($0) || v.title.lowercased().contains($0) } }
            .sorted { score($0) > score($1) }
            .prefix(limit).map { $0 }
    }

    private func save() {
        guard let file else { return }
        saving?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let list = self.visits.values.sorted { $0.last > $1.last }.prefix(Self.limit)
            self.visits = Dictionary(uniqueKeysWithValues: list.map { ($0.url, $0) })
            if let data = try? JSONEncoder().encode(Array(list)) { try? data.write(to: file, options: .atomic) }
        }
        saving = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }
}

/// The address bar's suggestions: a list under it, in a borderless child window.
final class SuggestionList {
    var onChoose: ((URL) -> Void)?
    private(set) var items: [ConquerHistory.Visit] = []
    private(set) var highlighted: Int?
    private var panel: NSPanel?
    private var rows: [SuggestionRow] = []

    var showing: Bool { panel?.isVisible ?? false }

    func show(_ items: [ConquerHistory.Visit], under field: NSView) {
        self.items = items
        highlighted = nil
        guard !items.isEmpty, let window = field.window else { return hide() }
        let rowHeight: CGFloat = 40
        let width = max(field.bounds.width, 320)
        let height = CGFloat(items.count) * rowHeight + 8
        let below = window.convertToScreen(field.convert(field.bounds, to: nil))
        let frame = CGRect(x: below.minX, y: below.minY - height - 4, width: width, height: height)
        let panel = self.panel ?? {
            let p = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false
            p.backgroundColor = .clear
            p.hasShadow = true
            p.level = .popUpMenu
            let box = ChromeSurface()
            box.raised = true
            box.wantsLayer = true
            box.layer?.cornerRadius = Chrome.metric("radius-lg", window.effectiveAppearance)
            box.layer?.masksToBounds = true
            p.contentView = box
            self.panel = p
            return p
        }()
        panel.appearance = window.effectiveAppearance
        panel.setFrame(frame, display: false)
        let box = panel.contentView!
        rows.forEach { $0.removeFromSuperview() }
        rows = items.enumerated().map { i, v in
            let row = SuggestionRow(visit: v)
            row.frame = CGRect(x: 4, y: height - 4 - CGFloat(i + 1) * rowHeight, width: width - 8, height: rowHeight)
            row.onClick = { [weak self] in if let url = URL(string: v.url) { self?.onChoose?(url) } }
            box.addSubview(row)
            return row
        }
        if panel.parent == nil { window.addChildWindow(panel, ordered: .above) }
        panel.orderFront(nil)
    }

    func hide() {
        if let panel, let parent = panel.parent { parent.removeChildWindow(panel) }
        panel?.orderOut(nil)
        highlighted = nil
    }

    /// Arrow keys move the highlight; it goes off the top back to what was typed.
    func move(_ step: Int) {
        guard showing, !items.isEmpty else { return }
        let next = (highlighted ?? -1) + step
        highlighted = next < 0 ? nil : min(next, items.count - 1)
        for (i, row) in rows.enumerated() { row.lit = i == highlighted }
    }

    var chosen: URL? { highlighted.flatMap { URL(string: items[$0].url) } }
}

final class SuggestionRow: NSView {
    var onClick: (() -> Void)?
    var lit = false { didSet { needsDisplay = true } }
    private var hovered = false { didSet { needsDisplay = true } }

    init(visit: ConquerHistory.Visit) {
        super.init(frame: .zero)
        let title = ChromeLabel(visit.title.isEmpty ? visit.url : visit.title, weight: .medium)
        title.lineBreakMode = .byTruncatingTail
        let link = ChromeLabel(visit.url, token: "text-3", small: true)
        link.lineBreakMode = .byTruncatingMiddle
        for v in [title, link] {
            v.translatesAutoresizingMaskIntoConstraints = false
            v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            title.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -10),
            title.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            link.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            link.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -10),
            link.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 1),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }
    override func mouseDown(with event: NSEvent) { onClick?() }

    override func draw(_ dirtyRect: NSRect) {
        guard lit || hovered else { return }
        Chrome.color(lit ? "row-selected" : "row-hover", effectiveAppearance).setFill()
        let radius = Chrome.metric("radius-md", effectiveAppearance)
        NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }
}

/// Conquer's downloads, newest first, for the sidebar's downloads list.
final class ConquerDownloads: NSObject {
    final class Item: NSObject {
        var name: String
        var file: URL?
        var progress: Progress?
        enum State { case running, done, failed(String) }
        var state: State = .running
        fileprivate var watch: NSKeyValueObservation?
        init(name: String) { self.name = name }
    }
    private(set) var items: [Item] = []
    var onChange: (() -> Void)?
    private var byDownload: [ObjectIdentifier: Item] = [:]

    var running: Int { items.filter { if case .running = $0.state { return true } else { return false } }.count }

    func began(_ download: WKDownload) {
        let item = Item(name: download.originalRequest?.url?.lastPathComponent ?? "Download")
        item.progress = download.progress
        // Progress reports often; the list redraws at most a few times a second.
        var last = Date.distantPast
        item.watch = download.progress.observe(\.fractionCompleted) { [weak self] _, _ in
            DispatchQueue.main.async {
                guard Date().timeIntervalSince(last) > 0.25 else { return }
                last = Date()
                self?.onChange?()
            }
        }
        byDownload[ObjectIdentifier(download)] = item
        items.insert(item, at: 0)
        onChange?()
    }

    func named(_ download: WKDownload, file: URL) {
        guard let item = byDownload[ObjectIdentifier(download)] else { return }
        item.name = file.lastPathComponent
        item.file = file
        onChange?()
    }

    func ended(_ download: WKDownload, error: Error?) {
        guard let item = byDownload.removeValue(forKey: ObjectIdentifier(download)) else { return }
        item.watch = nil
        item.state = error.map { .failed($0.localizedDescription) } ?? .done
        onChange?()
    }

    /// Forget the finished ones.
    func clear() {
        items.removeAll { if case .running = $0.state { return false } else { return true } }
        onChange?()
    }
}

/// The downloads list, in a popover from the sidebar's downloads button.
final class DownloadsController: NSViewController {
    private let downloads: ConquerDownloads
    private let stack = NSStackView()

    init(_ downloads: ConquerDownloads) {
        self.downloads = downloads
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let root = ChromeSurface(frame: CGRect(x: 0, y: 0, width: 340, height: 80))
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: root.topAnchor),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            root.widthAnchor.constraint(equalToConstant: 340),
        ])
        view = root
        render()
    }

    func render() {
        guard isViewLoaded else { return }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let header = NSStackView()
        header.orientation = .horizontal
        let title = ChromeLabel("Downloads", token: "text-strong", weight: .semibold)
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        let clear = ChromeButton()
        clear.configure(symbol: nil, title: "Clear", help: "Clear finished downloads")
        clear.secondary = true
        clear.target = self
        clear.action = #selector(clearDone)
        clear.isEnabled = downloads.items.count > downloads.running
        for v in [title, spacer, clear] { header.addArrangedSubview(v) }
        stack.addArrangedSubview(header)
        header.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -24).isActive = true
        if downloads.items.isEmpty {
            let none = ChromeLabel("No downloads yet.", token: "text-3")
            stack.addArrangedSubview(none)
        }
        for item in downloads.items.prefix(12) {
            let row = NSStackView()
            row.orientation = .horizontal
            row.spacing = 8
            let icon = NSImageView(image: item.file.map { NSWorkspace.shared.icon(forFile: $0.path) }
                                   ?? NSImage(systemSymbolName: "doc", accessibilityDescription: nil)!)
            icon.widthAnchor.constraint(equalToConstant: 28).isActive = true
            icon.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let text = NSStackView()
            text.orientation = .vertical
            text.alignment = .leading
            text.spacing = 2
            let name = ChromeLabel(item.name)
            name.lineBreakMode = .byTruncatingMiddle
            name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            text.addArrangedSubview(name)
            switch item.state {
            case .running:
                let bar = NSProgressIndicator()
                bar.isIndeterminate = item.progress == nil || (item.progress?.totalUnitCount ?? 0) <= 0
                bar.minValue = 0
                bar.maxValue = 1
                bar.doubleValue = item.progress?.fractionCompleted ?? 0
                bar.controlSize = .small
                if bar.isIndeterminate { bar.startAnimation(nil) }
                bar.widthAnchor.constraint(equalToConstant: 220).isActive = true
                text.addArrangedSubview(bar)
            case .done:
                text.addArrangedSubview(status("Done"))
            case .failed(let why):
                text.addArrangedSubview(status("Failed: \(why)"))
            }
            let spacer = NSView()
            spacer.setContentHuggingPriority(.init(1), for: .horizontal)
            let reveal = ChromeButton()
            reveal.configure(symbol: "magnifyingglass", help: "Show in Finder")
            reveal.target = self
            reveal.action = #selector(reveal(_:))
            reveal.identifier = NSUserInterfaceItemIdentifier(item.file?.path ?? "")
            reveal.isHidden = item.file == nil
            for v in [icon, text, spacer, reveal] { row.addArrangedSubview(v) }
            stack.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -24).isActive = true
        }
    }

    private func status(_ text: String) -> NSTextField {
        let label = ChromeLabel(text, token: "text-3", small: true)
        label.lineBreakMode = .byTruncatingTail
        return label
    }

    @objc private func clearDone() { downloads.clear() }
    @objc private func reveal(_ sender: NSButton) {
        guard let path = sender.identifier?.rawValue, !path.isEmpty else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }
}

/// Find in page (⌘F): a strip over the page with the search, previous and
/// next, and whether there is a match.
final class FindBar: NSView, NSTextFieldDelegate {
    let field = ChromeTextField()
    var onFind: ((_ text: String, _ backwards: Bool) -> Void)?
    var onClose: (() -> Void)?
    private let status = NSTextField(labelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        field.placeholderString = "Find in page"
        field.setAccessibilityLabel("Find in page")
        field.translatesAutoresizingMaskIntoConstraints = false
        field.heightAnchor.constraint(equalToConstant: Chrome.metric("control-sm", effectiveAppearance)).isActive = true
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.delegate = self
        field.target = self
        field.action = #selector(search)
        status.font = Chrome.font(effectiveAppearance, small: true)
        let previous = ChromeButton()
        let next = ChromeButton()
        let done = ChromeButton()
        previous.configure(symbol: "chevron.up", help: "Previous match (⇧⌘G)")
        next.configure(symbol: "chevron.down", help: "Next match (⌘G)")
        done.configure(symbol: nil, title: "Done", help: "Close find bar (Esc)")
        done.secondary = true
        for (button, action) in [(previous, #selector(findPrevious)), (next, #selector(findNext)), (done, #selector(closeBar))] {
            button.target = self
            button.action = action
        }
        let row = NSStackView(views: [field, previous, next, status, NSView(), done])
        row.orientation = .horizontal
        row.spacing = 6
        row.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        let line = ChromeSurface()
        line.divider = true
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            field.widthAnchor.constraint(lessThanOrEqualToConstant: 240),
            field.widthAnchor.constraint(greaterThanOrEqualToConstant: 60),
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
        status.font = Chrome.font(effectiveAppearance, small: true)
        status.textColor = Chrome.color(status.stringValue.isEmpty ? "text-3" : "red-text", effectiveAppearance)
    }

    func say(found: Bool?) {
        status.stringValue = found == false ? "Not found" : ""
        restyle()
    }

    func controlTextDidChange(_ notification: Notification) { onFind?(field.stringValue, false) }
    @objc private func search() { onFind?(field.stringValue, false) }
    @objc func findNext() { onFind?(field.stringValue, false) }
    @objc func findPrevious() { onFind?(field.stringValue, true) }
    @objc private func closeBar() { onClose?() }

    // Return finds the next match, ⇧Return the previous, Esc closes.
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            onFind?(field.stringValue, NSApp.currentEvent?.modifierFlags.contains(.shift) == true)
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            onClose?()
            return true
        default: return false
        }
    }
}
