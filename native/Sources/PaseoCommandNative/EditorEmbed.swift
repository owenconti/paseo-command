import AppKit

/// Where the Files page shows a file tab's editor terminal (Settings → Files → Open files in an editor command):
/// the page reports its viewer's frame in its own coordinates (CSS pixels, top-left origin) with the tab's
/// terminal, as `editor` messages, and the app lays the terminal exactly over it (`EditorOverlay`). Nothing
/// here needs SwiftTerm, so the native checks run it.
struct EditorPlacement: Equatable {
    /// The shown tab's daemon terminal and its host ("" for this machine's daemon); nil: no editor shows.
    var terminal: String?
    var host: String
    /// The viewer's frame in the page.
    var rect: CGRect
    /// A dialog (⌘K, ⌘P, a confirmation) is open over it: the page's, so the terminal steps aside.
    var covered: Bool

    static let nothing = EditorPlacement(terminal: nil, host: "", rect: .zero, covered: false)

    init(terminal: String?, host: String, rect: CGRect, covered: Bool) {
        self.terminal = terminal
        self.host = host
        self.rect = rect
        self.covered = covered
    }

    /// From the page's message (`postEditorPlacement` in `web/src/files/editorBridge.ts`).
    init(_ body: [String: Any]) {
        let number = { (key: String) in CGFloat((body[key] as? NSNumber)?.doubleValue ?? 0) }
        let id = (body["terminal"] as? String).flatMap { $0.isEmpty || $0.count > 200 ? nil : $0 }
        self.init(terminal: id, host: body["host"] as? String ?? "",
                  rect: CGRect(x: number("x"), y: number("y"), width: max(0, number("width")), height: max(0, number("height"))),
                  covered: body["covered"] as? Bool ?? false)
    }

    /// Whether a terminal shows at all: one is named, the page shows Files, nothing covers it, it has room.
    func visible(filesShows: Bool) -> Bool {
        terminal != nil && filesShows && !covered && rect.width >= 40 && rect.height >= 40
    }
}

/// The view the editor terminals stand in, laid over the page's viewer in the window's page side
/// (the split's, where Conquer and the maximized terminal panel go, as views after the web view in its
/// own parent don't draw). It takes the page's frame as the page moves it: the sidebar resizing or hiding,
/// the terminal panel opening, the window resizing, another tab, another mode.
class EditorStage: NSView {
    private(set) var placement = EditorPlacement.nothing
    private(set) var filesShows = false
    /// The system went dark or light.
    var onAppearance: ((NSAppearance) -> Void)?

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onAppearance?(effectiveAppearance)
    }

    /// The page's rectangle in `superview`'s coordinates, through the web view (flipped or not).
    static func frame(of rect: CGRect, in web: NSView, to parent: NSView) -> CGRect {
        let inWeb = web.isFlipped ? rect : CGRect(x: rect.minX, y: web.bounds.height - rect.maxY, width: rect.width, height: rect.height)
        return parent.convert(web.convert(inWeb, to: nil), from: nil)
    }

    /// Follow the page: its last placement, and whether Files shows. Returns whether the stage shows.
    @discardableResult
    func follow(_ next: EditorPlacement? = nil, filesShows: Bool? = nil, web: NSView) -> Bool {
        if let next { placement = next }
        if let filesShows { self.filesShows = filesShows }
        let shows = placement.visible(filesShows: self.filesShows)
        if shows, let parent = superview {
            let frame = Self.frame(of: placement.rect, in: web, to: parent).integral
            if frame != self.frame { self.frame = frame }
        }
        if isHidden == shows { isHidden = !shows }
        return shows
    }
}

/// Keys while an editor (or the terminal panel's terminal) has the keyboard. As the terminal panel's, the
/// app keeps only the window's own keys there (`AppKeys.offeredToMenu`: ⌘1…⌘5, ⇧⌘E, ⇧⌘G, and ⌘W, which closes
/// the file's tab with its confirmation) and the menu's (⌘`, ⌃`, ⌘, ⌘Q, ⌘C/⌘V as the terminal does them, the
/// terminal text size); ⌘K, which no menu item has, opens the page's command palette. Everything else, Esc, ⌃
/// keys, arrows and ⌘ keys no menu item has, goes to the editor.
enum EditorKeys {
    /// ⌘K, which the window takes for the page's palette while a terminal has the keyboard.
    static func opensPalette(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
        return event.modifierFlags.intersection([.command, .shift, .control, .option]) == .command && key == "k"
    }

    /// The page's palette, as ⌘K in the page opens it (its listener is the window's, capture phase).
    static let paletteScript = "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))"
}

/// Closing file tabs whose editors still run asks first (×, ⌘W, Close other tabs): their programs stop on
/// the daemon, and anything unsaved in them is lost (the editor warns of its own only if you quit it inside).
struct EditorCloseRequest {
    struct Item {
        let terminal: String
        let host: String
        let name: String
        /// The page's word for whether it runs, used when this launch has no session to say.
        let running: Bool
    }
    let token: String
    let items: [Item]

    init(token: String, items: [Item]) {
        self.token = token
        self.items = items
    }

    init?(_ body: [String: Any]) {
        guard let token = body["token"] as? String else { return nil }
        let items = (body["items"] as? [[String: Any]] ?? []).compactMap { item -> Item? in
            guard let terminal = item["terminal"] as? String, !terminal.isEmpty else { return nil }
            return Item(terminal: terminal, host: item["host"] as? String ?? "", name: item["name"] as? String ?? "this file",
                        running: item["running"] as? Bool ?? true)
        }
        self.init(token: token, items: items)
    }

    /// The items still running, `ended` saying for those this launch has a session of.
    func running(ended: (String) -> Bool?) -> [Item] {
        items.filter { ended($0.terminal).map { !$0 } ?? $0.running }
    }

    /// The question for those still running, or nil when none is (they close at once).
    static func question(_ running: [Item]) -> (message: String, detail: String, button: String)? {
        guard let first = running.first else { return nil }
        if running.count == 1 {
            return ("Close “\(first.name)”?", "Its editor is still running. It stops on the daemon too, and anything unsaved in it is lost.", "Close")
        }
        return ("Close \(running.count) files?", "Their editors are still running. They stop on the daemon too, and anything unsaved in them is lost.", "Close \(running.count) Files")
    }
}

/// Keys as the keyboard sends them, for checks of where they go (a background copy is never the key app,
/// so AppKit wouldn't route them): "cmd+w", "cmd+shift+g", "ctrl+c", "esc", "up", "a".
enum CheckKeys {
    static func event(_ spec: String, window: NSWindow?) -> NSEvent? {
        var parts = spec.lowercased().split(separator: "+").map(String.init)
        guard let last = parts.popLast() else { return nil }
        var flags: NSEvent.ModifierFlags = []
        for p in parts {
            switch p {
            case "cmd": flags.insert(.command)
            case "shift": flags.insert(.shift)
            case "ctrl": flags.insert(.control)
            case "alt", "opt": flags.insert(.option)
            default: return nil
            }
        }
        let named: [String: (String, UInt16)] = ["esc": ("\u{1b}", 53), "up": ("\u{F700}", 126), "down": ("\u{F701}", 125),
                                                 "left": ("\u{F702}", 123), "right": ("\u{F703}", 124), "enter": ("\r", 36),
                                                 "tab": ("\t", 48), "`": ("`", 50)]
        let (base, code) = named[last] ?? (last, 0)
        guard base.count == 1 else { return nil }
        let chars = flags.contains(.control) && base.first!.isLetter
            ? String(UnicodeScalar(UInt8(base.unicodeScalars.first!.value & 0x1f)))
            : flags.contains(.shift) ? base.uppercased() : base
        return NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                windowNumber: window?.windowNumber ?? 0, context: nil, characters: chars,
                                charactersIgnoringModifiers: base, isARepeat: false, keyCode: code)
    }

    /// As AppKit routes a key down: the window's key equivalents (its views', `AppWindow`'s own first), then
    /// the main menu's, then the first responder's keyDown. Which took it.
    @discardableResult
    static func deliver(_ event: NSEvent, to window: NSWindow) -> String {
        if window.performKeyEquivalent(with: event) { return "window" }
        if NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return "menu" }
        window.firstResponder?.keyDown(with: event)
        return "responder"
    }
}
