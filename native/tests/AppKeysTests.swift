// ⇧⌘G: View → Show Branch Changes (the Files tab's Changes) from anywhere, but Conquer's Find Previous while it has the keyboard.
// ⇧⌘E: View → Show Files from anywhere. The Files tab after GitHub, always shown.
// ⌘W: View → Close File Tab, offered to the menu ahead of the page while Files shows; elsewhere as before.
_ = NSApplication.shared
enum Log { static func line(_ message: String) {} }
// The app's menus while Conquer hasn't the keyboard (its own commands are disabled then).
final class Menus: NSObject, NSMenuItemValidation {
    var ran: [String] = []
    @objc func branchChanges() { ran.append("branchChanges") }
    @objc func showFiles() { ran.append("showFiles") }
    @objc func closeFileTab() { ran.append("closeFileTab") }
    @objc func close() { ran.append("close") }
    var files = false
    @objc func conquerCommand(_ sender: NSMenuItem) { ran.append(sender.representedObject as! String) }
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action == #selector(closeFileTab) ? files : [#selector(branchChanges), #selector(showFiles), #selector(close)].contains(item.action)
    }
}
let menus = Menus()
let bar = NSMenu()
for (title, fill) in [("View", { (m: NSMenu) in
                          AppKeys.addBranchChanges(to: m, target: menus, action: #selector(Menus.branchChanges))
                          AppKeys.addShowFiles(to: m, target: menus, action: #selector(Menus.showFiles))
                          AppKeys.addCloseFileTab(to: m, target: menus, action: #selector(Menus.closeFileTab))
                      }),
                      ("Conquer", { (m: NSMenu) in AppKeys.addConquerCommands(to: m, target: menus, action: #selector(Menus.conquerCommand(_:))) }),
                      ("Window", { (m: NSMenu) in m.addItem(withTitle: "Close", action: #selector(Menus.close), keyEquivalent: "w").target = menus })] {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let menu = NSMenu(title: title)
    fill(menu)
    item.submenu = menu
    bar.addItem(item)
}
let view = bar.item(withTitle: "View")!.submenu!
let branch = view.item(withTitle: "Show Branch Changes")!
assert(branch.keyEquivalent == "g" && branch.keyEquivalentModifierMask == [.command, .shift])
// It asks the page for the workspace's Changes in the Files tab (no longer the GitHub tab's).
assert(AppKeys.branchChangesCommand == "branch-changes")
// Conquer keeps its binding.
let previous = ConquerView.commands.compactMap { $0 }.first { $0.name == "findPrevious" }!
assert(previous.key == "g" && previous.mods == [.command, .shift])

// As the keyboard sends them: with ⌘ held, the characters ignoring modifiers ignore ⇧ too ("g" for ⇧⌘G).
func key(_ chars: String, _ mods: NSEvent.ModifierFlags) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: mods, timestamp: 0, windowNumber: 0, context: nil,
                     characters: chars, charactersIgnoringModifiers: chars.lowercased(), isARepeat: false, keyCode: 5)!
}
// The window offers ⇧⌘G (and ⌘1…⌘6) to the menu ahead of its views; not ⌘G, ⌥⇧⌘G or ⌘7.
let shiftG = key("G", [.command, .shift])
assert(AppKeys.offeredToMenu(shiftG, conquerHasKeys: false))
assert(AppKeys.offeredToMenu(key("3", .command), conquerHasKeys: false))
assert(!AppKeys.offeredToMenu(key("g", .command), conquerHasKeys: false))
assert(!AppKeys.offeredToMenu(key("G", [.command, .shift, .option]), conquerHasKeys: false))
assert(AppKeys.offeredToMenu(key("6", .command), conquerHasKeys: true), "six tabs: ⌘6 is Activity's, even from Conquer")
assert(!AppKeys.offeredToMenu(key("7", .command), conquerHasKeys: false), "six tabs: ⌘7 is no tab")
assert(!ConquerView.commands.compactMap { $0 }.contains { $0.key == "6" && $0.mods == .command }, "Conquer has no ⌘6")
// Anywhere else (the map, the page, the terminal): Show Branch Changes.
assert(bar.performKeyEquivalent(with: shiftG))
assert(menus.ran == ["branchChanges"], "\(menus.ran)")
// Conquer with the keyboard: the window leaves ⇧⌘G to Conquer's view (⌘1…⌘5 still go to the menu),
// which takes it as Find Previous.
assert(!AppKeys.offeredToMenu(shiftG, conquerHasKeys: true))
assert(AppKeys.offeredToMenu(key("3", .command), conquerHasKeys: true))
assert(ConquerView.command(for: shiftG.charactersIgnoringModifiers!, shiftG.modifierFlags) == "findPrevious")
assert(ConquerView.command(for: "G", [.command, .shift]) == "findPrevious")
assert(ConquerView.command(for: "g", .command) == "findNext")

// ⇧⌘E: Show Files, offered to the menu ahead of the views, Conquer with the keyboard or not (Conquer has no ⇧⌘E).
let files = view.item(withTitle: "Show Files")!
assert(files.keyEquivalent == "e" && files.keyEquivalentModifierMask == [.command, .shift])
assert(!ConquerView.commands.compactMap { $0 }.contains { $0.key.lowercased() == "e" && $0.mods == [.command, .shift] })
let shiftE = key("E", [.command, .shift])
assert(AppKeys.offeredToMenu(shiftE, conquerHasKeys: false))
assert(AppKeys.offeredToMenu(shiftE, conquerHasKeys: true))
assert(!AppKeys.offeredToMenu(key("e", .command), conquerHasKeys: false), "⌘E stays Conquer's next tab")
assert(!AppKeys.offeredToMenu(key("E", [.command, .shift, .control]), conquerHasKeys: false))
menus.ran = []
assert(bar.performKeyEquivalent(with: shiftE))
assert(menus.ran == ["showFiles"], "\(menus.ran)")
// The tabs: Command, Files, Terminal, GitHub, Conquer, Activity. Files is drawn by the page and shown whatever the
// integrations (⌘2); Terminal is the app's own, always shown (⌘3); Settings is no tab but the tools' gear, still a
// side the page draws (old saved modes show it).
assert(Mode.tabs == [.command, .files, .terminal, .github, .conquer, .activity])
assert(Mode.terminal.title == "Terminal" && !Mode.terminal.drawnByPage)
assert(Mode.terminal.keys(at: 2) == "⌘3, ⌃⇧` or ⌘`")
// Remembered across launches as the others are (`mode` in the preferences): not the page's, so shown at once.
assert(Mode(rawValue: Mode.terminal.rawValue) == .terminal && Mode.terminal.rawValue == "terminal")
// ⌘` steps through it: the next after Files, before GitHub (or Conquer, GitHub off).
let shownTabs = Mode.tabs.filter { !$0.drawnByPage || Mode.alwaysShown.contains($0) }
assert(shownTabs == [.command, .files, .terminal, .conquer], "\(shownTabs)")
assert(shownTabs[(shownTabs.firstIndex(of: .files)! + 1) % shownTabs.count] == .terminal)
assert(shownTabs[(shownTabs.firstIndex(of: .terminal)! + 1) % shownTabs.count] == .conquer)

// ⌃⇧`: the Terminal tab, from anywhere (the window takes it ahead of its views, a terminal's among them),
// whatever characters the layout gives the shifted key; ⌃` stays the panel's (the View menu's), ⌘` the next tab.
func grave(_ chars: String, _ mods: NSEvent.ModifierFlags, code: UInt16 = 50) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: mods, timestamp: 0, windowNumber: 0, context: nil,
                     characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)!
}
assert(AppKeys.showsTerminalTab(grave("~", [.control, .shift])))
assert(AppKeys.showsTerminalTab(grave("`", [.control, .shift])))
assert(AppKeys.showsTerminalTab(grave("£", [.control, .shift])), "by its key, whatever the layout's character")
assert(!AppKeys.showsTerminalTab(grave("`", .control)), "⌃` is the panel's")
assert(!AppKeys.showsTerminalTab(grave("`", .command)), "⌘` steps the tabs")
assert(!AppKeys.showsTerminalTab(grave("~", [.control, .shift, .command])))
assert(!AppKeys.showsTerminalTab(grave("~", [.control, .shift, .option])))
assert(!AppKeys.showsTerminalTab(grave("A", [.control, .shift], code: 0)))
do {
    let window = AppWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: true)
    var shown = 0
    window.onTerminalTab = { shown += 1 }
    // Even while a terminal has the keyboard (`terminalHasKeys`), as the panel keeps ⌃`.
    window.terminalHasKeys = { true }
    assert(window.performKeyEquivalent(with: grave("~", [.control, .shift])) && shown == 1)
    assert(!window.performKeyEquivalent(with: grave("`", .control)) && shown == 1, "⌃` goes on to the menu")
    // ⌘B: the page's session panel while the panel's (or the tab's) terminal has the keyboard, as in Conquer.
    var toggled = 0
    window.onTogglePanel = { toggled += 1 }
    let cmdB = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0, windowNumber: 0, context: nil,
                                characters: "b", charactersIgnoringModifiers: "b", isARepeat: false, keyCode: 11)!
    assert(AppKeys.togglesPanel(cmdB) && !AppKeys.togglesPanel(grave("b", [.command, .shift], code: 11)))
    window.panelTerminalHasKeys = { false }
    _ = window.performKeyEquivalent(with: cmdB)
    assert(toggled == 0, "elsewhere ⌘B is the page's own")
    window.panelTerminalHasKeys = { true }
    assert(window.performKeyEquivalent(with: cmdB) && toggled == 1)
}
assert(Mode(rawValue: "settings") == .settings && Mode.settings.drawnByPage)
assert(Mode.files.drawnByPage && Mode.alwaysShown == [.files, .settings])
assert(Mode.files.title == "Files" && Mode.files.keys(at: 1) == "⌘2, ⇧⌘E or ⌘`")
assert(Mode.settings.keys(at: nil) == "⌘,")
assert(AppKeys.offeredToMenu(key("5", .command), conquerHasKeys: true))

// The bar: its tabs in that order (GitHub and Activity only while on), and the Settings gear, lit while Settings shows.
do {
    let modeBar = ModeBar(frame: CGRect(x: 0, y: 0, width: 1200, height: 38))
    modeBar.enabled = [.files, .settings]
    assert(modeBar.state()["tabs"] as? [String] == ["command", "files", "terminal", "conquer"], "\(modeBar.state())")
    modeBar.enabled = [.files, .settings, .github, .activity]
    assert(modeBar.state()["tabs"] as? [String] == ["command", "files", "terminal", "github", "conquer", "activity"])
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

// ⌘W. While Files shows, the window offers it to the menu ahead of its views (the page, the terminal), and
// View → Close File Tab (ahead of Conquer's Close Tab and the window's Close) closes the page's shown file tab.
let cmdW = key("w", .command)
assert(AppKeys.offeredToMenu(cmdW, conquerHasKeys: false, filesShows: true))
assert(!AppKeys.offeredToMenu(key("w", [.command, .shift]), conquerHasKeys: false, filesShows: true), "⇧⌘W isn't taken")
assert(!AppKeys.offeredToMenu(key("w", [.command, .option]), conquerHasKeys: false, filesShows: true))
assert(!AppKeys.offeredToMenu(key("w", .control), conquerHasKeys: false, filesShows: true), "⌃W goes on to the page")
let closeTab = view.item(withTitle: "Close File Tab")!
assert(closeTab.keyEquivalent == "w" && closeTab.keyEquivalentModifierMask == .command)
menus.files = true
menus.ran = []
assert(bar.performKeyEquivalent(with: cmdW))
assert(menus.ran == ["closeFileTab"], "\(menus.ran)")
// Elsewhere it isn't offered ahead and Close File Tab is disabled: ⌘W goes on as it did before Files had tabs.
// While Conquer has the keyboard, its view takes it first as Close Tab; else the menu's first ⌘W, disabled
// (Conquer's Close Tab, now Close File Tab), takes it and nothing closes, the window's Close included.
menus.files = false
menus.ran = []
assert(!AppKeys.offeredToMenu(cmdW, conquerHasKeys: false, filesShows: false))
assert(!AppKeys.offeredToMenu(cmdW, conquerHasKeys: true, filesShows: false))
assert(ConquerView.command(for: "w", .command) == "closeTab")
_ = bar.performKeyEquivalent(with: cmdW)
assert(menus.ran == [], "\(menus.ran)")
// ⇧⌘T, ⌃Tab and ⌥⌘←/→ aren't offered ahead: the page takes them in Files (Conquer's are disabled then).
for k in [key("t", [.command, .shift]), key("\t", .control), key("\t", [.control, .shift])] {
    assert(!AppKeys.offeredToMenu(k, conquerHasKeys: false, filesShows: true))
}
assert(!ConquerView.commands.compactMap { $0 }.contains { $0.mods == [.command, .option] && ["\u{F702}", "\u{F703}"].contains($0.key) })
print("App key checks passed.")
