import AppKit
import SwiftTerm

/// The workspace a terminal drawer shows: the one selected in the page (or
/// the selected agent's), as `NativeWorld` reports it.
struct TerminalWorkspace: Equatable {
    let id: String
    /// The host's serverId, or "" for this machine's daemon.
    let host: String
    let name: String
}

/// One of the daemon's terminals, attached through the app server's relay
/// (`web/server/api/terminals.ts`): its bytes in, keys and size out.
final class TerminalSession: NSObject, TerminalViewDelegate, URLSessionWebSocketDelegate {
    let id: String
    var name: String
    let view: TerminalView
    private var socket: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var size: (cols: Int, rows: Int)?
    private(set) var ended = false
    /// The last few kilobytes received, as text (for checks).
    private(set) var recent = ""

    init(id: String, name: String, server: URL, host: String) {
        self.id = id
        self.name = name
        view = TerminalView(frame: CGRect(x: 0, y: 0, width: 800, height: 240))
        super.init()
        view.terminalDelegate = self
        view.nativeBackgroundColor = Textures.color(0x101614)
        view.nativeForegroundColor = Textures.color(0xe8e2d0)
        view.font = NSFont.monospacedSystemFont(ofSize: 12.5, weight: .regular)
        view.optionAsMetaKey = true
        var components = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        components.scheme = server.scheme == "https" ? "wss" : "ws"
        components.path = "/api/terminal"
        components.queryItems = [URLQueryItem(name: "id", value: id)] + (host.isEmpty ? [] : [URLQueryItem(name: "host", value: host)])
        var request = URLRequest(url: components.url!)
        // The server takes the socket from its own page's origin only.
        request.setValue("\(server.scheme ?? "http")://\(server.host ?? "127.0.0.1")\(server.port.map { ":\($0)" } ?? "")", forHTTPHeaderField: "Origin")
        socket = session.webSocketTask(with: request)
        socket?.resume()
        receive()
    }

    private func receive() {
        socket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.data(let data)):
                self.view.feed(byteArray: ArraySlice([UInt8](data)))
                self.recent = String((self.recent + String(decoding: data, as: UTF8.self)).suffix(4096))
                self.receive()
            case .success:
                self.receive()
            case .failure:
                self.finish("disconnected")
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        if let size { send(["type": "resize", "rows": size.rows, "cols": size.cols]) }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        finish(reason.flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 } ?? "closed")
    }

    private func finish(_ why: String) {
        guard !ended else { return }
        ended = true
        view.feed(text: "\r\n\u{1b}[2m[\(why)]\u{1b}[0m\r\n")
    }

    private func send(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) else { return }
        socket?.send(.string(text)) { _ in }
    }

    func close() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session.invalidateAndCancel()
    }

    // MARK: TerminalViewDelegate

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        send(["type": "input", "data": String(decoding: data, as: UTF8.self)])
    }
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        size = (newCols, newRows)
        send(["type": "resize", "rows": newRows, "cols": newCols])
    }
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }
    func bell(source: TerminalView) { NSSound.beep() }
    func clipboardCopy(source: TerminalView, content: Data) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(String(decoding: content, as: UTF8.self), forType: .string)
    }
    func clipboardRead(source: TerminalView) -> Data? { nil }
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

/// The right-hand panel: tabs for the selected workspace's daemon terminals, a
/// + for a new one there, and the native terminal (SwiftTerm) for the tab.
/// Terminals keep running on the daemon when tabs close; × ends one.
final class TerminalDrawer: NSView {
    /// The app server the page comes from; the relay and routes are on it.
    var server: () -> URL = { URL(string: "http://127.0.0.1:4310/")! }
    private(set) var workspace: TerminalWorkspace?
    private var sessions: [String: TerminalSession] = [:]
    /// The listed terminals, in the daemon's order.
    private var listed: [(id: String, name: String)] = []
    private var current: String?
    private var poll: Timer?

    private let title = NSTextField(labelWithString: "Terminal")
    private let tabs = NSSegmentedControl()
    private let add = NSButton(title: "+", target: nil, action: nil)
    private let end = NSButton(title: "×", target: nil, action: nil)
    private let body = NSView()
    private let empty = NSTextField(wrappingLabelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        // Dark like the page's panels, whatever the system's appearance.
        appearance = NSAppearance(named: .darkAqua)
        wantsLayer = true
        layer?.backgroundColor = Textures.color(0x101614).cgColor
        let bar = NSStackView()
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 4, left: 10, bottom: 4, right: 8)
        title.font = .systemFont(ofSize: 11, weight: .semibold)
        title.textColor = Textures.color(0xf2e1b2)
        title.lineBreakMode = .byTruncatingTail
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tabs.segmentStyle = .roundRect
        tabs.controlSize = .small
        tabs.target = self
        tabs.action = #selector(chooseTab)
        for (button, help, action) in [(add, "New terminal in this workspace", #selector(newTerminal)),
                                       (end, "End this terminal", #selector(endTerminal))] {
            button.bezelStyle = .accessoryBarAction
            button.controlSize = .small
            button.toolTip = help
            button.target = self
            button.action = action
        }
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        for v in [title, tabs, add, spacer, end] { bar.addArrangedSubview(v) }
        empty.textColor = Textures.color(0xa8a08a)
        empty.font = .systemFont(ofSize: 12)
        empty.alignment = .center
        for v in [bar, body, empty] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        let line = NSBox()
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        NSLayoutConstraint.activate([
            line.topAnchor.constraint(equalTo: topAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.topAnchor.constraint(equalTo: topAnchor, constant: 1),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 30),
            body.topAnchor.constraint(equalTo: bar.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            body.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            body.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
            empty.centerYAnchor.constraint(equalTo: body.centerYAnchor),
            empty.leadingAnchor.constraint(equalTo: body.leadingAnchor, constant: 20),
            empty.trailingAnchor.constraint(equalTo: body.trailingAnchor, constant: -20),
        ])
        render()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The page selected another workspace (or none).
    func show(_ next: TerminalWorkspace?) {
        guard next != workspace else { return }
        workspace = next
        listed = []
        current = nil
        render()
        refresh()
    }

    /// Shown: keep the tabs in step with the daemon; hidden: stop asking.
    func setActive(_ active: Bool) {
        poll?.invalidate()
        poll = nil
        guard active else { return }
        refresh()
        poll = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
    }

    /// The tab's terminal takes the keyboard.
    func focusTerminal() {
        if let id = current, let s = sessions[id] { window?.makeFirstResponder(s.view) }
    }

    private func api(_ path: String, _ query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: server(), resolvingAgainstBaseURL: false)!
        c.path = "/api/\(path)"
        c.queryItems = query.isEmpty ? nil : query
        return c.url!
    }

    private func refresh() {
        guard let ws = workspace else { return }
        let url = api("terminals", [URLQueryItem(name: "workspace", value: ws.id)] + (ws.host.isEmpty ? [] : [URLQueryItem(name: "host", value: ws.host)]))
        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async {
                guard let self, self.workspace == ws else { return }
                if let terminals = json?["terminals"] as? [[String: Any]] {
                    self.listed = terminals.compactMap { t in (t["id"] as? String).map { ($0, (t["title"] as? String) ?? (t["name"] as? String) ?? "Terminal") } }
                    self.empty.stringValue = ""
                } else {
                    self.listed = []
                    self.empty.stringValue = (json?["error"] as? String) ?? error?.localizedDescription ?? "The terminals couldn't be listed."
                }
                if self.current.map({ id in !self.listed.contains { $0.id == id } }) ?? true { self.current = self.listed.first?.id }
                // Sessions for terminals that are gone end here too.
                for (id, s) in self.sessions where !self.listed.contains(where: { $0.id == id }) && s.ended {
                    s.close()
                    s.view.removeFromSuperview()
                    self.sessions[id] = nil
                }
                self.render()
            }
        }.resume()
    }

    private func render() {
        let ws = workspace
        title.stringValue = ws.map { "Terminal · \($0.name)" } ?? "Terminal"
        add.isEnabled = ws != nil
        end.isEnabled = current != nil
        tabs.segmentCount = listed.count
        for (i, t) in listed.enumerated() {
            tabs.setLabel(Self.short(t.name), forSegment: i)
            tabs.setToolTip(t.name, forSegment: i)
            tabs.setWidth(0, forSegment: i)
        }
        tabs.selectedSegment = listed.firstIndex { $0.id == current } ?? -1
        tabs.isHidden = listed.isEmpty
        if ws == nil {
            empty.stringValue = "Select a workspace or agent to open its terminals."
        } else if listed.isEmpty && empty.stringValue.isEmpty {
            empty.stringValue = "No terminals in \(ws!.name). Press + to open one."
        }
        for s in sessions.values where s.id != current { s.view.isHidden = true }
        guard let id = current, let ws else { empty.isHidden = false; return }
        empty.isHidden = true
        let name = listed.first { $0.id == id }?.name ?? "Terminal"
        let s = sessions[id] ?? {
            let s = TerminalSession(id: id, name: name, server: server(), host: ws.host)
            s.view.translatesAutoresizingMaskIntoConstraints = false
            body.addSubview(s.view)
            NSLayoutConstraint.activate([
                s.view.topAnchor.constraint(equalTo: body.topAnchor),
                s.view.bottomAnchor.constraint(equalTo: body.bottomAnchor),
                s.view.leadingAnchor.constraint(equalTo: body.leadingAnchor),
                s.view.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            ])
            sessions[id] = s
            return s
        }()
        s.view.isHidden = false
    }

    /// A tab's label that fits the panel: a shell's `user@host:~/a/b` title
    /// shows its folder.
    private static func short(_ name: String) -> String {
        var text = name
        if let colon = text.lastIndex(of: ":"), text[..<colon].contains("@") {
            text = String(text[text.index(after: colon)...]).split(separator: "/").last.map(String.init) ?? text
        }
        return text.count > 22 ? text.prefix(21) + "…" : text
    }

    @objc private func chooseTab() {
        guard tabs.selectedSegment >= 0, tabs.selectedSegment < listed.count else { return }
        current = listed[tabs.selectedSegment].id
        render()
        focusTerminal()
    }

    private func post(_ path: String, _ body: [String: Any], done: @escaping ([String: Any]?) -> Void) {
        var request = URLRequest(url: api(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async { done(json) }
        }.resume()
    }

    @objc func newTerminal() {
        guard let ws = workspace else { return }
        var body: [String: Any] = ["workspace": ws.id]
        if !ws.host.isEmpty { body["host"] = ws.host }
        post("terminals/create", body) { [weak self] json in
            guard let self else { return }
            if let id = (json?["terminal"] as? [String: Any])?["id"] as? String {
                self.current = id
                self.refresh()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.focusTerminal() }
            } else {
                self.empty.stringValue = (json?["error"] as? String) ?? "The terminal didn't start."
                self.render()
            }
        }
    }

    @objc private func endTerminal() {
        guard let id = current, let ws = workspace, let window else { return }
        let alert = NSAlert()
        alert.messageText = "End “\(listed.first { $0.id == id }?.name ?? "this terminal")”?"
        alert.informativeText = "Its shell and anything running in it stop, on the daemon too."
        alert.addButton(withTitle: "End Terminal")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn, let self else { return }
            var body: [String: Any] = ["id": id]
            if !ws.host.isEmpty { body["host"] = ws.host }
            self.post("terminals/kill", body) { _ in
                self.sessions[id]?.close()
                self.sessions[id]?.view.removeFromSuperview()
                self.sessions[id] = nil
                self.current = nil
                self.refresh()
            }
        }
    }

    /// What the drawer shows, for checks: the workspace, its tabs, and the
    /// text the current terminal received.
    func state() -> [String: Any] {
        // What the current terminal has received, escape codes aside.
        let raw = current.flatMap { sessions[$0]?.recent } ?? ""
        let text = raw.replacingOccurrences(of: "\u{1b}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
        return [
            "workspace": workspace.map { ["id": $0.id, "host": $0.host, "name": $0.name] } as Any? ?? NSNull(),
            "tabs": listed.map(\.name),
            "current": current as Any? ?? NSNull(),
            "text": text,
            "open": !isHidden,
        ]
    }

    /// Type into the current terminal as keys would (checks).
    func type(_ text: String) {
        if let id = current, let s = sessions[id] { s.view.send(txt: text) }
    }

    func closeAll() {
        for s in sessions.values { s.close() }
        sessions = [:]
    }
}
