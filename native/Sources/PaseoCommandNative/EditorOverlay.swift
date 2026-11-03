import AppKit
import SwiftTerm

/// The Files page's editor terminals (Settings → Files → Open files in an editor command): each file tab
/// that opened in the editor has a daemon terminal running the user's editor on it (`POST
/// /api/terminals/editor`), and the shown tab's is drawn here, by SwiftTerm as the terminal panel's are
/// (`TerminalSession`), laid exactly over the page's viewer (`EditorStage`). The page owns the tabs: it says
/// which terminal shows where (`editor`), asks for the keyboard (`editorFocus`) and asks to close tabs
/// (`editorClose`, confirmed here while their editors run). Each terminal keeps its session while its tab
/// exists, shown or not, so the app hears when an editor quits on its own and tells the page (`paseo:editor`).
final class EditorOverlay: EditorStage {
    /// The app server the page comes from; the relay and routes are on it.
    var server: () -> URL = { URL(string: "http://127.0.0.1:4310/")! }
    /// Tell the page (`paseo:editor`).
    var tell: (([String: Any]) -> Void)?
    /// Run in the page (the palette's ⌘K).
    var runInPage: ((String) -> Void)?
    private var sessions: [String: TerminalSession] = [:]
    private(set) var shown: String?
    private var fontSize: CGFloat
    /// ⌘K came from the editor: once the page's dialog closes, the editor has the keyboard again.
    private var refocus = false
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    /// The close question, while it shows (checks answer it).
    private(set) var closeAlert: NSAlert?
    private var clicks: Any?

    init(fontSize: CGFloat) {
        self.fontSize = fontSize
        super.init(frame: .zero)
        wantsLayer = true
        isHidden = true
        autoresizingMask = []
        onAppearance = { [weak self] in self?.restyle($0) }
        restyle(NSApp.effectiveAppearance)
        // A click in the editor gives it the keyboard (SwiftTerm takes it), and is the page's `use`.
        clicks = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            if let self, !self.isHiddenOrHasHiddenAncestor, event.window === self.window,
               self.bounds.contains(self.convert(event.locationInWindow, from: nil)) {
                self.refocus = false
                if let id = self.shown { self.tell?(["type": "focus", "terminal": id]) }
            }
            return event
        }
    }

    /// Dark or light with the app (the terminal panel's tones).
    func restyle(_ appearance: NSAppearance) {
        layer?.backgroundColor = Ink.color(Ink.pane, appearance).cgColor
        for s in sessions.values { s.restyle(appearance) }
    }

    /// The terminal panel's text size, which ⌘+ / ⌘− / ⌘0 set for both.
    func setFont(_ size: CGFloat) {
        fontSize = size
        for s in sessions.values { s.view.font = TerminalSession.font(size) }
    }

    var hasKeyFocus: Bool {
        guard let responder = window?.firstResponder as? NSView else { return false }
        return responder.isDescendant(of: self)
    }

    /// The page's placement (or the mode, or the page side's layout, changed): show the named terminal over the viewer.
    func place(_ asked: EditorPlacement?, filesShows: Bool, web: NSView) {
        let wasCovered = placement.covered
        let hadKeys = hasKeyFocus
        let shows = follow(asked, filesShows: filesShows, web: web)
        let next = shows ? placement.terminal : nil
        if next != shown {
            if let old = shown { sessions[old]?.view.removeFromSuperview() }
            shown = next
            if let id = next {
                let s = session(id, host: placement.host)
                s.view.removeFromSuperview()
                s.view.frame = bounds.insetBy(dx: 6, dy: 4)
                s.view.autoresizingMask = [.width, .height]
                addSubview(s.view)
                if hadKeys { window?.makeFirstResponder(s.view) }
            }
        }
        if !shows && hadKeys { window?.makeFirstResponder(web) }
        // Back from the page's dialog that ⌘K opened in the editor: the keyboard comes back.
        if shows, wasCovered, !placement.covered, refocus {
            refocus = false
            focus()
            // The page puts its own focus back as its dialog closes, which can take the web view first responder again.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                guard let self, !self.isHidden, !self.placement.covered else { return }
                self.focus()
            }
        }
    }

    /// The shown editor takes the keyboard (its tab was shown, or opened in the editor).
    func focus() {
        guard let id = shown, let s = sessions[id], s.view.window != nil else { return }
        window?.makeFirstResponder(s.view)
    }

    /// ⌘K while the editor has the keyboard: the page's palette, the keyboard coming back once it closes.
    func openPalette(web: NSView) {
        refocus = hasKeyFocus
        window?.makeFirstResponder(web)
        runInPage?(EditorKeys.paletteScript)
    }

    private func session(_ id: String, host: String) -> TerminalSession {
        if let s = sessions[id], !s.ended { return s }
        sessions[id]?.close()
        let s = TerminalSession(id: id, name: "Editor", server: server(), host: host, fontSize: fontSize)
        s.restyle(effectiveAppearance)
        s.onEnd = { [weak self, weak s] why in
            guard let self, let s, self.sessions[id] === s else { return }
            // Its program ended (the editor quit): the tab shows the viewer. Else the relay went (the
            // server restarted): the page checks whether the terminal is still there.
            let exited = why == "The terminal ended" || why.localizedCaseInsensitiveContains("not found")
            self.tell?(["type": exited ? "exited" : "lost", "terminal": id])
            if !exited { self.drop(id) }
        }
        sessions[id] = s
        return s
    }

    private func drop(_ id: String) {
        guard let s = sessions.removeValue(forKey: id) else { return }
        s.onEnd = nil
        s.close()
        s.view.removeFromSuperview()
        if shown == id { shown = nil }
    }

    /// The page closed tabs whose editors are gone, or forgets one: their sessions go.
    func forget(_ ids: [String]) { ids.forEach(drop) }

    /// Close file tabs' editors: at once when none still runs, else after asking. The page closes the
    /// tabs when told `closed`; `cancelled` leaves them.
    func close(_ request: EditorCloseRequest, window: NSWindow?) {
        let running = request.running { self.sessions[$0].map(\.ended) }
        let end = { [weak self] in
            guard let self else { return }
            let group = DispatchGroup()
            for item in request.items {
                group.enter()
                var body: [String: Any] = ["id": item.terminal]
                if !item.host.isEmpty { body["host"] = item.host }
                self.drop(item.terminal)
                self.post("terminals/kill", body) { _ in group.leave() }
            }
            group.notify(queue: .main) {
                self.tell?(["type": "closed", "token": request.token, "terminals": request.items.map(\.terminal)])
            }
        }
        guard let question = EditorCloseRequest.question(running), let window else { return end() }
        let alert = NSAlert()
        alert.messageText = question.message
        alert.informativeText = question.detail
        alert.addButton(withTitle: question.button)
        alert.addButton(withTitle: "Cancel")
        closeAlert = alert
        alert.beginSheetModal(for: window) { [weak self] response in
            self?.closeAlert = nil
            if response == .alertFirstButtonReturn { end() }
            else { self?.tell?(["type": "cancelled", "token": request.token]) }
        }
    }

    /// Answer the close question as a click would: its first button (Close) or Cancel (checks).
    func answerClose(_ accept: Bool) {
        closeAlert?.buttons[accept ? 0 : 1].performClick(nil)
    }

    private func post(_ path: String, _ body: [String: Any], done: @escaping ([String: Any]?) -> Void) {
        var c = URLComponents(url: server(), resolvingAgainstBaseURL: false)!
        c.path = "/api/\(path)"
        var request = URLRequest(url: c.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async { done(json) }
        }.resume()
    }

    /// Type into the shown editor as keys would (checks).
    func type(_ text: String) {
        if let id = shown, let s = sessions[id] { s.view.send(txt: text) }
    }

    /// What the overlay shows, for checks.
    func state() -> [String: Any] {
        let raw = shown.flatMap { sessions[$0]?.recent } ?? ""
        let text = raw.replacingOccurrences(of: "\u{1b}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
        let f = frame
        return [
            "shown": shown as Any? ?? NSNull(),
            "visible": !isHiddenOrHasHiddenAncestor,
            "frame": [f.minX, f.minY, f.width, f.height],
            "page": [placement.rect.minX, placement.rect.minY, placement.rect.width, placement.rect.height],
            "covered": placement.covered,
            "keyFocus": hasKeyFocus,
            "sessions": sessions.mapValues { ["ended": $0.ended, "reason": $0.endReason as Any? ?? NSNull()] },
            "asking": closeAlert.map { [$0.messageText, $0.informativeText] } as Any? ?? NSNull(),
            "text": text,
            "screen": shown.flatMap { sessions[$0] }.map { String(decoding: $0.view.getBufferAsData(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) } ?? "",
            "fontSize": fontSize,
        ]
    }

    func closeAll() {
        for s in sessions.values { s.onEnd = nil; s.close() }
        sessions = [:]
    }
}
