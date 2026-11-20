import AppKit
import SwiftTerm

/// One of the daemon's terminals (your editor's, beside a conversation), attached through the app server's relay
/// (`web/server/api/terminals.ts`): its bytes in, keys and size out.
final class TerminalSession: NSObject, TerminalViewDelegate, URLSessionWebSocketDelegate {
    let id: String
    var name: String
    let view: TerminalView
    private var socket: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var size: (cols: Int, rows: Int)?
    private(set) var ended = false
    /// Why it ended: "The terminal ended" when its program did, else the socket's reason.
    private(set) var endReason: String?
    /// Told once, as it ends, why.
    var onEnd: ((String) -> Void)?
    /// The last few kilobytes received, as text (for checks).
    private(set) var recent = ""
    /// The terminal's queries and SwiftTerm's answers: none to a replay's, none
    /// the daemon gives itself, none for a program that has finished (`TerminalQueries.swift`).
    private(set) var answers = TerminalAnswers()

    init(id: String, name: String, server: URL, host: String, font: TerminalFontSettings) {
        self.id = id
        self.name = name
        view = TerminalView(frame: CGRect(x: 0, y: 0, width: 800, height: 240))
        super.init()
        view.terminalDelegate = self
        restyle(NSApp.effectiveAppearance)
        view.glyphFallbackProvider = NerdSymbols.shared
        apply(font)
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

    /// Dark or light with the app.
    func restyle(_ appearance: NSAppearance) {
        view.nativeBackgroundColor = Ink.color(Ink.pane, appearance)
        view.nativeForegroundColor = Ink.color(Ink.text, appearance)
    }

    /// The terminals' font, line height and letter spacing (Settings → Terminal, ⌘+ / ⌘− / ⌘0).
    func apply(_ font: TerminalFontSettings) {
        view.lineSpacing = font.lineHeight
        view.font = TerminalFonts.font(font)
    }

    private func receive() {
        socket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.data(let data)):
                let bytes = self.answers.received([UInt8](data))
                self.view.feed(byteArray: bytes[...])
                self.recent = String((self.recent + String(decoding: bytes, as: UTF8.self)).suffix(4096))
                self.receive()
            case .success(.string(let text)):
                // The relay marks its replay of the screen: `replay` before it, `live` after.
                switch (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])?["type"] as? String {
                case "replay": self.answers.beginReplay()
                case "live":
                    self.answers.replaying = false
                    // Its size again once the screen is in, as the view has it now: a program the daemon kept running
                    // (your editor, reattached) then redraws to fill it.
                    self.sendSize()
                default: break
                }
                self.receive()
            case .success:
                self.receive()
            case .failure:
                self.finish("disconnected")
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        sendSize()
    }

    /// The view's size (its rows and columns, as SwiftTerm last said them), to the daemon.
    private func sendSize() {
        guard let size, size.cols > 0, size.rows > 0 else { return }
        sizeSent = Date()
        send(["type": "resize", "rows": size.rows, "cols": size.cols])
    }
    private var sizeSent = Date.distantPast

    /// The daemon sizes a terminal as whichever client last asked (the Paseo app showing the same terminal can make it
    /// its own pane's size): this view's size again, as it shows, takes the keyboard, and as you type (a second apart).
    func reclaimSize() { sendSize() }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        finish(reason.flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 } ?? "closed")
    }

    private func finish(_ why: String) {
        guard !ended else { return }
        ended = true
        endReason = why
        view.feed(text: "\r\n\u{1b}[2m[\(why)]\u{1b}[0m\r\n")
        onEnd?(why)
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
        let text = String(decoding: data, as: UTF8.self)
        switch answers.sent(data) {
        case .key:
            if Date().timeIntervalSince(sizeSent) > 1 { sendSize() }
            send(["type": "input", "data": text])
        case .reply(let frame): send(["type": "input", "data": text, "reply": frame])
        case .drop: break
        }
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
