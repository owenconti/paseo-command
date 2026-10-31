// Runs in an isolated accessory process, with nonpersistent browser storage.
// Its only HTTP destination is the test runner's loopback fixture.
_ = NSApplication.shared
NSApp.setActivationPolicy(.accessory)
enum Log { static func line(_ message: String) {} }
let fixture = URL(string: CommandLine.arguments.last!)!
// The optional Linear, Slack and Activity tabs are absent until explicitly enabled;
// Activity's tab carries its unread count.
do {
    let bar = ModeBar(frame: CGRect(x: 0, y: 0, width: 900, height: 32))
    func find(_ title: String, in view: NSView) -> NSButton? {
        if let button = view as? NSButton, button.title.trimmingCharacters(in: .whitespaces).hasPrefix(title) { return button }
        return view.subviews.compactMap { find(title, in: $0) }.first
    }
    let linear = find("Linear", in: bar)!, slack = find("Slack", in: bar)!, activity = find("Activity", in: bar)!
    assert(linear.isHidden && slack.isHidden && activity.isHidden)
    bar.enabled = [.linear, .activity]
    assert(!linear.isHidden && slack.isHidden && !activity.isHidden)
    bar.activityUnread = 4
    assert(activity.title.hasSuffix("4"))
    bar.activityUnread = 0
    assert(activity.title.trimmingCharacters(in: .whitespaces) == "Activity")
    bar.enabled = []
    assert(linear.isHidden && slack.isHidden && activity.isHidden)
}
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
// Reload shortcuts choose the current page's normal or cache-bypassing reload,
// even while it is loading; they do not act as the toolbar's Stop button.
final class ReloadPage: WKWebView {
    var reloads = 0
    var originReloads = 0
    var stops = 0
    override var isLoading: Bool { true }
    override func reload() -> WKNavigation? { reloads += 1; return nil }
    override func reloadFromOrigin() -> WKNavigation? { originReloads += 1; return nil }
    override func stopLoading() { stops += 1 }
}
do {
    let b = browser()
    let window = NSWindow(contentRect: b.frame, styleMask: [.titled], backing: .buffered, defer: false)
    let content = NSView(frame: b.frame)
    window.contentView = content
    content.addSubview(b)
    let page = ReloadPage(frame: .zero, configuration: b.configuration)
    b.select(BrowserTab(web: page))
    assert(window.makeFirstResponder(page))
    func key(_ modifiers: NSEvent.ModifierFlags) -> NSEvent {
        NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: 0,
                         windowNumber: window.windowNumber, context: nil, characters: "r", charactersIgnoringModifiers: "r",
                         isARepeat: false, keyCode: 15)!
    }
    assert(b.performKeyEquivalent(with: key(.command)))
    assert(page.reloads == 1 && page.originReloads == 0 && page.stops == 0)
    assert(b.performKeyEquivalent(with: key([.command, .shift])))
    assert(page.reloads == 1 && page.originReloads == 1 && page.stops == 0)

    // The adjacent app panel keeps its keys, and hidden Conquer cannot reload.
    let panel = NSTextView()
    content.addSubview(panel)
    assert(window.makeFirstResponder(panel))
    assert(!b.hasKeyFocus)
    assert(!b.performKeyEquivalent(with: key(.command)))
    assert(window.makeFirstResponder(page))
    b.isHidden = true
    assert(!b.performKeyEquivalent(with: key([.command, .shift])))
    assert(page.reloads == 1 && page.originReloads == 1)
}
print("Conquer tab closing and reload shortcut checks passed.")
