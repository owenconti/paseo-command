// The Terminal tab and the panel share one set of sessions: the window moves the panel's view itself, from
// the split into the map's place and back (`WorldWindow.enterTerminalTab`/`leaveTerminalTab`), so its
// terminals (SwiftTerm views, which show in one place), tabs, splits and current tab come along unchanged.
// In the tab it has no dock or maximize button; it puts them back as it returns to the panel.
import AppKit
import SwiftTerm

_ = NSApplication.shared
// No server answers here: the sessions' sockets just fail (never the app's ports).
let drawer = TerminalDrawer(frame: CGRect(x: 0, y: 0, width: 460, height: 600))
drawer.server = { URL(string: "http://127.0.0.1:9/")! }
drawer.show(TerminalWorkspace(id: "wks", host: "", name: "main"))
drawer.layoutSubtreeIfNeeded()
drawer.list([("a", "zsh"), ("b", "server"), ("c", "tests")])
drawer.place("b", at: "a", .right)
drawer.place("c", at: "b", .bottom)

func terminals(_ view: NSView) -> [ObjectIdentifier] {
    view.subviews.flatMap { ($0 is TerminalView ? [ObjectIdentifier($0)] : []) + terminals($0) }
}
func buttons(_ view: NSView) -> [NSButton] {
    view.subviews.flatMap { ($0 as? NSButton).map { [$0] } ?? [] + buttons($0) }
}
func shown(_ symbol: String) -> Bool {
    buttons(drawer).contains { !$0.isHiddenOrHasHiddenAncestor && $0.image?.accessibilityDescription?.contains(symbol) == true }
}

let panel = NSView(frame: CGRect(x: 0, y: 0, width: 1200, height: 800))
let map = NSView(frame: panel.frame)
panel.addSubview(drawer)
let before = drawer.state()
let views = terminals(drawer)
assert(before["panes"] as? String == "(a | (b / c))", "\(before["panes"] ?? "")")
assert(before["current"] as? String == "c")
assert(views.count == 3, "a view for each pane: \(views.count)")
assert(shown("Maximize") && shown("Move terminal"), "the panel has its dock and maximize buttons")
assert(before["inTab"] as? Bool == false)

// Into the tab, as the window moves it: the same views, panes and current tab.
drawer.removeFromSuperview()
drawer.inTab = true
map.addSubview(drawer)
drawer.frame = map.bounds
let inTab = drawer.state()
assert(drawer.superview === map)
assert(terminals(drawer) == views, "the same terminal views, not new ones")
assert(inTab["panes"] as? String == "(a | (b / c))" && inTab["current"] as? String == "c")
assert(inTab["tabs"] as? [String] == ["zsh", "server", "tests"])
assert(inTab["inTab"] as? Bool == true)
assert(!shown("Maximize") && !shown("Restore") && !shown("Move terminal"), "no dock or maximize in the tab")
assert(shown("Unsplit"), "unsplit stays")

// Changed in the tab, kept as it goes back.
drawer.place("a", at: "c", .center)
assert(drawer.state()["panes"] as? String == "(b / a)")

// Back to the panel: the same views, the layout as the tab left it, and its buttons again.
drawer.removeFromSuperview()
drawer.inTab = false
panel.addSubview(drawer)
let after = drawer.state()
assert(drawer.superview === panel)
assert(Set(terminals(drawer)).isSubset(of: Set(views)) && terminals(drawer).count == 2, "a's and b's views, as before")
assert(after["panes"] as? String == "(b / a)" && after["current"] as? String == "a", "\(after)")
assert(after["inTab"] as? Bool == false)
assert(shown("Maximize") && shown("Move terminal"))

// What the tab puts back of the panel.
var state = TerminalPanelState(open: true, maximized: true)
state.open = false
assert(state == TerminalPanelState(open: false, maximized: true))
drawer.closeAll()
print("Terminal tab checks passed.")
