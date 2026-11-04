// The Files page's editor terminals: laid exactly over the page's viewer and following it, the keys the app keeps
// while one has the keyboard (the rest go to the editor), and the question before closing tabs whose editors run.
_ = NSApplication.shared
enum Log { static func line(_ message: String) {} }

// ── The placement the page sends ──
let sent = EditorPlacement(["type": "editor", "terminal": "term-7", "host": "srv_far", "x": 300, "y": 80.5, "width": 600, "height": 400, "covered": false])
assert(sent.terminal == "term-7" && sent.host == "srv_far" && sent.rect == CGRect(x: 300, y: 80.5, width: 600, height: 400) && !sent.covered)
assert(EditorPlacement(["terminal": "", "width": 600, "height": 400]).terminal == nil, "an empty terminal is none")
assert(EditorPlacement(["terminal": "t", "width": -5]).rect.width == 0)
assert(sent.visible(filesShows: true))
assert(!sent.visible(filesShows: false), "only while Files shows")
var covered = sent; covered.covered = true
assert(!covered.visible(filesShows: true), "a dialog over it: it steps aside")
var tiny = sent; tiny.rect.size = CGSize(width: 20, height: 400)
assert(!tiny.visible(filesShows: true))
assert(!EditorPlacement.nothing.visible(filesShows: true))

// ── Frame following, in a window laid out as the app's: the page (flipped, as WKWebView) under the bar, the stage in the page side ──
final class FlippedView: NSView { override var isFlipped: Bool { true } }
let window = AppWindow(contentRect: CGRect(x: 0, y: 0, width: 1200, height: 800), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
let root = NSView(frame: CGRect(x: 0, y: 0, width: 1200, height: 800))
window.contentView = root
// The mode bar takes the top 38 points; the page and the page side (`content`) lie below it.
let command = NSView(frame: CGRect(x: 0, y: 0, width: 1200, height: 762))
let web = FlippedView(frame: command.bounds)
command.addSubview(web)
let content = NSView(frame: CGRect(x: 0, y: 0, width: 1200, height: 762))
root.addSubview(command)
root.addSubview(content)
let stage = EditorStage(frame: .zero)
stage.isHidden = true
content.addSubview(stage)
// The viewer at (300, 80) in the page, 600 × 400: the same place in the window, y running up.
assert(stage.follow(sent, filesShows: true, web: web))
assert(!stage.isHidden)
assert(stage.frame == CGRect(x: 300, y: 762 - 80.5 - 400, width: 600, height: 400).integral, "\(stage.frame)")
// The sidebar hides: the viewer widens leftwards.
var wide = sent; wide.rect = CGRect(x: 0, y: 80, width: 900, height: 400)
stage.follow(wide, web: web)
assert(stage.frame == CGRect(x: 0, y: 282, width: 900, height: 400), "\(stage.frame)")
// The terminal panel opens at the bottom: the page side and the page shorten (the page reports its new frame).
command.frame.size.height = 500; web.frame.size.height = 500; content.frame.size.height = 500
var short = wide; short.rect = CGRect(x: 0, y: 80, width: 900, height: 300)
stage.follow(short, web: web)
assert(stage.frame == CGRect(x: 0, y: 120, width: 900, height: 300), "\(stage.frame)")
// The page side starts lower than the page (as when maximized panels move it): still over the page's rectangle.
content.frame.origin.y = 20
stage.follow(web: web)
assert(window.contentView!.convert(stage.frame, from: content) == CGRect(x: 0, y: 120, width: 900, height: 300))
content.frame.origin.y = 0
stage.follow(web: web)
// A web view that isn't flipped is read from its bottom.
let plain = NSView(frame: CGRect(x: 0, y: 0, width: 1200, height: 500))
command.addSubview(plain)
assert(EditorStage.frame(of: CGRect(x: 10, y: 0, width: 100, height: 50), in: plain, to: content) == CGRect(x: 10, y: 450, width: 100, height: 50))
// Another mode: hidden, where it was; back to Files: shown again.
assert(!stage.follow(filesShows: false, web: web) && stage.isHidden)
assert(stage.follow(filesShows: true, web: web) && !stage.isHidden)
// A dialog over it, then gone; no editor (the tab shows the viewer); then another tab's.
var over = short; over.covered = true
assert(!stage.follow(over, web: web) && stage.isHidden)
assert(stage.follow(short, web: web) && !stage.isHidden)
assert(!stage.follow(.nothing, web: web) && stage.isHidden)
var other = short; other.terminal = "term-8"
assert(stage.follow(other, web: web) && stage.placement.terminal == "term-8")

// ── Keys while the editor has the keyboard ──
// The app's menus, as main.swift builds them, with what each would do.
final class Menus: NSObject, NSMenuItemValidation {
    var ran: [String] = []
    @objc func mode(_ sender: NSMenuItem) { ran.append("mode \(sender.keyEquivalent)") }
    @objc func branchChanges() { ran.append("branchChanges") }
    @objc func showFiles() { ran.append("showFiles") }
    @objc func closeFileTab() { ran.append("closeFileTab") }
    @objc func refreshPage() { ran.append("refreshPage") }
    @objc func nextMode() { ran.append("nextMode") }
    @objc func terminal() { ran.append("terminal") }
    @objc func close() { ran.append("closeWindow") }
    var files = true
    var refreshes = { false }
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action == #selector(closeFileTab) ? files : item.action == #selector(refreshPage) ? refreshes() : true
    }
}
let menus = Menus()
let bar = NSMenu()
let viewMenu = NSMenu(title: "View")
for i in 1...6 { viewMenu.addItem(withTitle: "Mode \(i)", action: #selector(Menus.mode(_:)), keyEquivalent: "\(i)").target = menus }
AppKeys.addBranchChanges(to: viewMenu, target: menus, action: #selector(Menus.branchChanges))
AppKeys.addShowFiles(to: viewMenu, target: menus, action: #selector(Menus.showFiles))
AppKeys.addCloseFileTab(to: viewMenu, target: menus, action: #selector(Menus.closeFileTab))
AppKeys.addRefreshPage(to: viewMenu, target: menus, action: #selector(Menus.refreshPage))
viewMenu.addItem(withTitle: "Next", action: #selector(Menus.nextMode), keyEquivalent: "`").target = menus
let terminalItem = viewMenu.addItem(withTitle: "Terminal", action: #selector(Menus.terminal), keyEquivalent: "`")
terminalItem.target = menus
terminalItem.keyEquivalentModifierMask = .control
let windowMenu = NSMenu(title: "Window")
windowMenu.addItem(withTitle: "Close", action: #selector(Menus.close), keyEquivalent: "w").target = menus
for menu in [viewMenu, windowMenu] {
    let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
    item.submenu = menu
    bar.addItem(item)
}
NSApp.mainMenu = bar
// The editor: a terminal view with the keyboard, recording what reaches it.
final class Editor: NSView {
    var got: [String] = []
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) {
        let mods = event.modifierFlags.intersection([.command, .shift, .control, .option])
        got.append((mods.contains(.command) ? "cmd+" : "") + (mods.contains(.control) ? "ctrl+" : "") + (event.charactersIgnoringModifiers ?? ""))
    }
}
let editor = Editor(frame: stage.bounds)
stage.addSubview(editor)
assert(window.makeFirstResponder(editor))
var palettes = 0
window.terminalHasKeys = { (window.firstResponder as? NSView)?.isDescendant(of: stage) == true }
window.onPalette = { palettes += 1 }
window.filesShows = { true }
// ⌘R is the page's refresh only while no terminal has the keyboard (`AppKeys.pageRefreshes`, Files showing).
window.pageRefreshes = { AppKeys.pageRefreshes(.files, terminalHasKeys: window.terminalHasKeys()) }
menus.refreshes = window.pageRefreshes
func press(_ spec: String) -> String { CheckKeys.deliver(CheckKeys.event(spec, window: window)!, to: window) }
// ⌘K: the page's palette.
assert(EditorKeys.opensPalette(CheckKeys.event("cmd+k", window: window)!))
assert(!EditorKeys.opensPalette(CheckKeys.event("cmd+shift+k", window: window)!) && !EditorKeys.opensPalette(CheckKeys.event("ctrl+k", window: window)!))
assert(press("cmd+k") == "window" && palettes == 1)
// The window's own keys: the modes, Show Branch Changes, Show Files, and ⌘W, the file's tab (never the window).
assert(press("cmd+3") == "window" && menus.ran.last == "mode 3")
assert(press("cmd+shift+g") == "window" && menus.ran.last == "branchChanges")
assert(press("cmd+shift+e") == "window" && menus.ran.last == "showFiles")
assert(press("cmd+w") == "window" && menus.ran.last == "closeFileTab")
assert(!menus.ran.contains("closeWindow"))
// ⌘R stays the editor's: not offered ahead, and View → Refresh Page, disabled, refreshes nothing. (No ⌘ key reaches a
// terminal program, as in Terminal.app: SwiftTerm sends one only when asked to, `shouldSendCommandKeyToTerminal`.)
assert(press("cmd+r") == "menu" && menus.ran.last != "refreshPage", "\(menus.ran)")
// The menu's: ⌘` the next mode, ⌃` the terminal panel.
assert(press("cmd+`") == "menu" && menus.ran.last == "nextMode")
assert(press("ctrl+`") == "menu" && menus.ran.last == "terminal")
// Everything else is the editor's: Esc, ⌃ keys, arrows, letters, ⌘ keys no menu item has (⌘F, ⌘P, ⌘S, the page's elsewhere).
for spec in ["esc", "ctrl+c", "ctrl+w", "ctrl+r", "up", "down", "j", ":", "cmd+f", "cmd+p", "cmd+s", "cmd+t", "tab", "ctrl+tab"] {
    let before = editor.got.count
    assert(press(spec) == "responder", spec)
    assert(editor.got.count == before + 1, "\(spec) reached the editor")
}
assert(editor.got.first == "\u{1b}", "\(editor.got)")
assert(palettes == 1)
// Without the keyboard in a terminal, ⌘K is the page's own (it isn't taken ahead of it).
window.makeFirstResponder(nil)
assert(press("cmd+k") == "responder" && palettes == 1)
// And ⌘R is the page's refresh (View → Refresh Page), ahead of the page.
assert(press("cmd+r") == "window" && menus.ran.last == "refreshPage", "\(menus.ran)")

// ── Closing tabs whose editors still run ──
let request = EditorCloseRequest(["token": "c1", "items": [
    ["terminal": "term-1", "host": "", "name": "index.ts", "running": true],
    ["terminal": "term-2", "host": "srv_far", "name": "layout.ts", "running": true],
    ["terminal": "term-3", "name": "old.ts", "running": false],
    ["terminal": "", "name": "bad"],
]])!
assert(request.token == "c1" && request.items.map(\.terminal) == ["term-1", "term-2", "term-3"])
assert(request.items[1].host == "srv_far")
assert(EditorCloseRequest(["items": []]) == nil, "a request needs its token")
// This launch's sessions say first (term-1's editor quit); the page's word for the rest.
let running = request.running { ["term-1": true, "term-2": false][$0] }
assert(running.map(\.terminal) == ["term-2"], "\(running.map(\.terminal))")
let one = EditorCloseRequest.question(running)!
assert(one.message == "Close “layout.ts”?" && one.button == "Close" && one.detail.contains("still running") && one.detail.contains("unsaved"))
let several = EditorCloseRequest.question(request.running { _ in nil })!
assert(several.message == "Close 2 files?" && several.button == "Close 2 Files", several.message)
// None running (quit, or never started): closed at once, no question.
assert(EditorCloseRequest.question(request.running { _ in true }) == nil)
print("Editor embedding checks passed.")
