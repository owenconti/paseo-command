// The Terminal tab owns the app's terminals (the Files page's editors aside): its sessions, tabs, splits
// (`PaneLayout`), + / × and font. There is no side or bottom panel: no dock or maximize buttons, nothing
// to move between places. Its splits and current tab stay as they were while it hides, and each workspace
// keeps its own.
import AppKit
import SwiftTerm

_ = NSApplication.shared
// No server answers here: the sessions' sockets just fail (never the app's ports).
let drawer = TerminalDrawer(frame: CGRect(x: 0, y: 0, width: 1000, height: 700))
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

let map = NSView(frame: CGRect(x: 0, y: 0, width: 1200, height: 800))
map.addSubview(drawer)
let state = drawer.state()
let views = terminals(drawer)
assert(state["panes"] as? String == "(a | (b / c))", "\(state["panes"] ?? "")")
assert(state["current"] as? String == "c")
assert(state["tabs"] as? [String] == ["zsh", "server", "tests"])
assert(views.count == 3, "a view for each pane: \(views.count)")
assert(!shown("Maximize") && !shown("Restore") && !shown("Move terminal"), "no panel: no dock or maximize buttons")
assert(shown("Unsplit"), "unsplit shows while split")
for gone in ["dock", "maximized", "inTab"] { assert(state[gone] == nil, "no panel state: \(gone)") }

// Hidden (another tab shows) and shown again: the same views, panes and current tab.
drawer.isHidden = true
drawer.setActive(false)
drawer.isHidden = false
assert(terminals(drawer) == views, "the same terminal views, not new ones")
assert(drawer.state()["panes"] as? String == "(a | (b / c))" && drawer.state()["current"] as? String == "c")

// Splits still work: a tab into a pane's middle takes its place; unsplit leaves the current one, the others as tabs.
drawer.place("a", at: "c", .center)
assert(drawer.state()["panes"] as? String == "(b / a)", "\(drawer.state()["panes"] ?? "")")
assert(drawer.isSplit)
drawer.unsplit()
assert(drawer.state()["panes"] as? String == "a" && !drawer.isSplit)
assert(drawer.state()["tabs"] as? [String] == ["zsh", "server", "tests"], "unsplit keeps every tab")
assert(!shown("Unsplit"), "no unsplit with one pane")
drawer.splitForCheck()
assert(drawer.state()["panes"] as? String == "(a | c)", "\(drawer.state()["panes"] ?? "")")

// Another workspace has its own panes; coming back finds these as they were.
drawer.show(TerminalWorkspace(id: "other", host: "", name: "other"))
drawer.list([("x", "zsh")])
assert(drawer.state()["panes"] as? String == "x")
drawer.show(TerminalWorkspace(id: "wks", host: "", name: "main"))
drawer.list([("a", "zsh"), ("b", "server"), ("c", "tests")])
assert(drawer.state()["panes"] as? String == "(a | c)" && drawer.state()["current"] as? String == "c", "\(drawer.state())")
drawer.closeAll()
print("Terminal tab checks passed.")
