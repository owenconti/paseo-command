// Runs in an isolated accessory process, with nonpersistent browser storage.
// Its only HTTP destination is the test runner's loopback fixture.
_ = NSApplication.shared
NSApp.setActivationPolicy(.accessory)
enum Log { static func line(_ message: String) {} }
let fixture = URL(string: CommandLine.arguments.last!)!
func browser() -> ConquerView { ConquerView(frame: CGRect(x: 0, y: 0, width: 900, height: 600), persistent: false) }
func pin(_ browser: ConquerView, name: String = "Pinned") -> BrowserTab {
    let tab = BrowserTab(url: fixture.appendingPathComponent(name), title: name)
    browser.togglePin(tab)
    return tab
}

// The reported case: all pinned pages are unloaded, and the only ordinary
// tab is blank. Closing it selects a pinned page instead of recreating it.
do {
    let b = browser()
    let pinned = pin(b)
    assert(pinned.web == nil)
    b.newTab()
    let blank = b.current!
    b.closeTab()
    assert(b.tabs.isEmpty)
    assert(b.current === pinned)
    assert(!b.allTabs.contains { $0 === blank })
    assert(pinned.web != nil)
}

// Closing the last tab leaves no replacement, and New Tab still works.
do {
    let b = browser()
    b.newTab()
    b.closeTab()
    assert(b.current == nil && b.tabs.isEmpty && b.allTabs.isEmpty)
    b.check("go \(fixture.absoluteString)")
    assert(b.current?.url == fixture && b.tabs.count == 1)
    b.closeTab()
    assert(b.current == nil && b.tabs.isEmpty)
    b.perform("reopen")
    assert(b.current?.url == fixture && b.tabs.count == 1)
    b.closeTab()
    b.newTab()
    assert(b.current != nil && b.tabs.count == 1)
}

// Closing a pinned page unloads it without opening another closed pin or
// manufacturing a blank tab; its saved pin stays in the sidebar.
do {
    let b = browser()
    let first = pin(b, name: "First")
    let second = pin(b, name: "Second")
    b.select(first)
    b.closeTab()
    assert(b.current == nil && b.tabs.isEmpty)
    assert(first.web == nil && second.web == nil)
    assert(b.pinned.count == 2)
}

// Ordinary neighbours take priority, and an already open pinned page takes
// priority over an unloaded one.
do {
    let b = browser()
    let closedPin = pin(b, name: "Closed")
    let openPin = pin(b, name: "Open")
    b.select(openPin)
    b.newTab()
    let previous = b.current!
    b.newTab()
    b.closeTab()
    assert(b.current === previous && b.tabs.count == 1)
    b.closeTab()
    assert(b.current === openPin && b.tabs.isEmpty && closedPin.web == nil)
}
print("Conquer tab closing checks passed.")
