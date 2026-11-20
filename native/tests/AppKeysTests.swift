// ⇧⌘G: View → Show Branch Changes (in the workspace's editor) from anywhere.
// No Files, Terminal or Conquer tab (the user's call: the workspace's own editor and the agent's browser do their
// work): no ⇧⌘E Show Files, no ⌃` Show Terminal, no Conquer menu, and ⌘W is no key of the app's.
// ⌘R: View → Refresh Page, offered ahead of the page while GitHub or Activity shows; your editor keeps it.
// ⇧⌘C: no app key or menu item of its own (the GitHub tab's page copies the PR's link).
_ = NSApplication.shared
enum Log { static func line(_ message: String) {} }
final class Menus: NSObject, NSMenuItemValidation {
    var ran: [String] = []
    @objc func branchChanges() { ran.append("branchChanges") }
    @objc func refreshPage() { ran.append("refreshPage") }
    @objc func close() { ran.append("close") }
    var refreshes = false
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action == #selector(refreshPage) ? refreshes : [#selector(branchChanges), #selector(close)].contains(item.action)
    }
}
let menus = Menus()
let bar = NSMenu()
for (title, fill) in [("View", { (m: NSMenu) in
                          AppKeys.addBranchChanges(to: m, target: menus, action: #selector(Menus.branchChanges))
                          AppKeys.addRefreshPage(to: m, target: menus, action: #selector(Menus.refreshPage))
                      }),
                      // As the app's: Close has no ⌘W (it would quit the app, the one window closing).
                      ("Window", { (m: NSMenu) in m.addItem(withTitle: "Close", action: #selector(Menus.close), keyEquivalent: "").target = menus })] {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let menu = NSMenu(title: title)
    fill(menu)
    item.submenu = menu
    bar.addItem(item)
}
let view = bar.item(withTitle: "View")!.submenu!
let branch = view.item(withTitle: "Show Branch Changes")!
assert(branch.keyEquivalent == "g" && branch.keyEquivalentModifierMask == [.command, .shift])
// It asks the page for the workspace's changes, which it shows in the workspace's editor.
assert(AppKeys.branchChangesCommand == "branch-changes")

// As the keyboard sends them: with ⌘ held, the characters ignoring modifiers ignore ⇧ too ("g" for ⇧⌘G).
func key(_ chars: String, _ mods: NSEvent.ModifierFlags, code: UInt16 = 5) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: mods, timestamp: 0, windowNumber: 0, context: nil,
                     characters: chars, charactersIgnoringModifiers: chars.lowercased(), isARepeat: false, keyCode: code)!
}
// The window offers ⇧⌘G (and ⌘1…⌘4) to the menu ahead of its views; not ⌘G, ⌥⇧⌘G or ⌘5.
let shiftG = key("G", [.command, .shift])
assert(AppKeys.offeredToMenu(shiftG))
assert(AppKeys.offeredToMenu(key("3", .command)))
assert(!AppKeys.offeredToMenu(key("g", .command)))
assert(!AppKeys.offeredToMenu(key("G", [.command, .shift, .option])))
assert(AppKeys.offeredToMenu(key("4", .command)))
assert(!AppKeys.offeredToMenu(key("5", .command)), "four tabs: ⌘5 is no tab")
assert(bar.performKeyEquivalent(with: shiftG))
assert(menus.ran == ["branchChanges"], "\(menus.ran)")

// ⌃` is no app key now (the Terminal tab went). View's tools are, from anywhere, ahead of the views (your editor, its
// terminal and the agent's browser's pages too): ⇧⌘E the editor, ⇧⌘T the terminal, ⇧⌘B the browser, ⇧⌘D the message box.
assert(!AppKeys.offeredToMenu(key("`", .control, code: 50)))
assert(view.item(withTitle: "Show Files") == nil)
final class Tools: NSObject { var ran: [String] = []; @objc func tool(_ sender: NSMenuItem) { ran.append(sender.representedObject as! String) } }
let tools = Tools()
AppKeys.addTools(to: view, target: tools, action: #selector(Tools.tool(_:)))
for (letter, command) in [("E", "tools-editor"), ("T", "tools-terminal"), ("B", "tools-browser"), ("D", "focus-composer")] {
    let event = key(letter, [.command, .shift])
    assert(AppKeys.offeredToMenu(event), letter)
    tools.ran = []
    assert(view.performKeyEquivalent(with: event) && tools.ran == [command], "\(letter): \(tools.ran)")
    assert(!AppKeys.offeredToMenu(key(letter.lowercased(), .command)), "⌘\(letter) alone isn't one")
}
assert(view.item(withTitle: "Show Terminal")?.keyEquivalent == "t")
// The tabs: Crew (the map), Command (the open conversation), GitHub, Activity; Settings is no tab but the tools' gear,
// still a side the page draws. A saved Files, Terminal or Conquer mode is no mode (the map shows).
assert(Mode.tabs == [.crew, .command, .github, .activity])
for gone in ["files", "terminal", "conquer", "linear"] { assert(Mode(rawValue: gone) == nil, gone) }
assert(Mode.github.keys(at: 2) == "⌘3, ⌘`")
assert(Mode(rawValue: "settings") == .settings && Mode.settings.drawnByPage)
assert(Mode.alwaysShown == [.settings])
assert(Mode.settings.keys(at: nil) == "⌘,")
// ⌘` steps through those shown: with no integrations, Crew and Command.
let shownTabs = Mode.tabs.filter { !$0.drawnByPage || Mode.alwaysShown.contains($0) }
assert(shownTabs == [.crew, .command], "\(shownTabs)")

// The bar: its tabs in that order (GitHub and Activity only while on), and the Settings gear, lit while Settings shows.
do {
    let modeBar = ModeBar(frame: CGRect(x: 0, y: 0, width: 1200, height: 38))
    modeBar.enabled = [.settings]
    assert(modeBar.state()["tabs"] as? [String] == ["crew", "command"], "\(modeBar.state())")
    modeBar.enabled = [.settings, .github, .activity]
    assert(modeBar.state()["tabs"] as? [String] == ["crew", "command", "github", "activity"])
    assert(modeBar.state()["settingsOn"] as? Bool == false)
    var used: [String] = []
    modeBar.onAction = { name, _ in used.append(name) }
    modeBar.clickSettings()
    assert(used == ["settings"], "\(used)")
    modeBar.mode = .settings
    assert(modeBar.state()["settingsOn"] as? Bool == true)
    modeBar.mode = .github
    assert(modeBar.state()["settingsOn"] as? Bool == false)
}
// The optional GitHub and Activity tabs are absent until enabled; Activity's tab carries its unread count.
do {
    let modeBar = ModeBar(frame: CGRect(x: 0, y: 0, width: 900, height: 32))
    func find(_ title: String, in view: NSView) -> NSButton? {
        if let button = view as? NSButton, button.title.trimmingCharacters(in: .whitespaces).hasPrefix(title) { return button }
        return view.subviews.compactMap { find(title, in: $0) }.first
    }
    let github = find("GitHub", in: modeBar)!, activity = find("Activity", in: modeBar)!
    for gone in ["Terminal", "Conquer", "Files", "Linear", "Slack", "Settings"] { assert(find(gone, in: modeBar) == nil, gone) }
    assert(github.isHidden && activity.isHidden)
    modeBar.enabled = [.github, .activity]
    assert(!github.isHidden && !activity.isHidden)
    assert(github.toolTip?.hasSuffix("(⌘3, ⌘`)") == true && activity.toolTip?.hasSuffix("(⌘4, ⌘`)") == true)
    assert(find("Crew", in: modeBar)?.toolTip?.hasSuffix("(⌘1, ⌘`)") == true && find("Command", in: modeBar)?.toolTip?.hasSuffix("(⌘2, ⌘`)") == true)
    modeBar.activityUnread = 4
    assert(activity.title.hasSuffix("4"))
    modeBar.activityUnread = 0
    assert(activity.title.trimmingCharacters(in: .whitespaces) == "Activity")
    modeBar.enabled = [.activity]
    assert(activity.toolTip?.hasSuffix("(⌘3, ⌘`)") == true)
}

// ⌘W is never offered ahead of the views, and no menu item has it: your editor and the agent's browser keep it.
let cmdW = key("w", .command)
assert(!AppKeys.offeredToMenu(cmdW))
assert(!bar.items.flatMap { $0.submenu?.items ?? [] }.contains { $0.keyEquivalent == "w" })
// ⌘R: View → Refresh Page while GitHub or Activity shows and your editor hasn't the keyboard, offered ahead of the
// views (it asks the page's shown view to refresh, never a reload of the web view). Settings has no refresh,
// the map's fleet is live, your editor keeps it.
let cmdR = key("r", .command)
assert(AppKeys.refreshPageCommand == "page-refresh")
for mode in [Mode.github, .activity] { assert(AppKeys.pageRefreshes(mode, terminalHasKeys: false), "\(mode)") }
for mode in [Mode.command, .settings] { assert(!AppKeys.pageRefreshes(mode, terminalHasKeys: false), "\(mode)") }
assert(!AppKeys.pageRefreshes(.github, terminalHasKeys: true), "your editor keeps ⌘R")
assert(AppKeys.offeredToMenu(cmdR, pageRefreshes: true))
assert(!AppKeys.offeredToMenu(cmdR, pageRefreshes: false))
assert(!AppKeys.offeredToMenu(key("r", [.command, .shift]), pageRefreshes: true), "⇧⌘R isn't taken")
assert(!AppKeys.offeredToMenu(key("r", [.command, .option]), pageRefreshes: true))
let refresh = view.item(withTitle: "Refresh Page")!
assert(refresh.keyEquivalent == "r" && refresh.keyEquivalentModifierMask == .command)
menus.refreshes = true
menus.ran = []
assert(bar.performKeyEquivalent(with: cmdR))
assert(menus.ran == ["refreshPage"], "\(menus.ran)")
// Elsewhere it's disabled: the menu's ⌘R takes it and nothing reloads, the web view included.
menus.refreshes = false
menus.ran = []
_ = bar.performKeyEquivalent(with: cmdR)
assert(menus.ran == [], "\(menus.ran)")
do {
    let window = AppWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: true)
    NSApp.mainMenu = bar
    menus.refreshes = true
    window.pageRefreshes = { true }
    assert(window.performKeyEquivalent(with: cmdR) && menus.ran == ["refreshPage"], "\(menus.ran)")
    window.pageRefreshes = { false }
    menus.ran = []
    _ = window.performKeyEquivalent(with: cmdR)
    assert(menus.ran == [], "not offered ahead of the views")
    NSApp.mainMenu = nil
    menus.refreshes = false
}
// ⌃Tab and ⌥⌘←/→ aren't offered ahead.
for k in [key("\t", .control), key("\t", [.control, .shift])] {
    assert(!AppKeys.offeredToMenu(k))
}
// ⇧⌘C: the GitHub tab's (the page copies the PR's link, `GitHubView.tsx`). No app key or menu item uses it, so the
// web view, ahead of the menu, hands it to the page, as ⌘S and ⌘F.
let shiftC = key("C", [.command, .shift])
assert(!AppKeys.offeredToMenu(shiftC, pageRefreshes: true))
assert(!bar.items.flatMap { $0.submenu?.items ?? [] }.contains { $0.keyEquivalent.lowercased() == "c" }, "no View or Window item of ⌘C or ⇧⌘C (Edit → Copy is ⌘C only)")
print("App key checks passed.")
