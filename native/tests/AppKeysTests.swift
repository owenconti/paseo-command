// ⇧⌘G: View → Show Branch Changes from anywhere, but Conquer's Find Previous while it has the keyboard.
// ⇧⌘E: View → Show Files from anywhere. The Files tab after GitHub, always shown.
_ = NSApplication.shared
enum Log { static func line(_ message: String) {} }
// The app's menus while Conquer hasn't the keyboard (its own commands are disabled then).
final class Menus: NSObject, NSMenuItemValidation {
    var ran: [String] = []
    @objc func branchChanges() { ran.append("branchChanges") }
    @objc func showFiles() { ran.append("showFiles") }
    @objc func conquerCommand(_ sender: NSMenuItem) { ran.append(sender.representedObject as! String) }
    func validateMenuItem(_ item: NSMenuItem) -> Bool { item.action == #selector(branchChanges) || item.action == #selector(showFiles) }
}
let menus = Menus()
let bar = NSMenu()
for (title, fill) in [("View", { (m: NSMenu) in
                          AppKeys.addBranchChanges(to: m, target: menus, action: #selector(Menus.branchChanges))
                          AppKeys.addShowFiles(to: m, target: menus, action: #selector(Menus.showFiles))
                      }),
                      ("Conquer", { (m: NSMenu) in AppKeys.addConquerCommands(to: m, target: menus, action: #selector(Menus.conquerCommand(_:))) })] {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let menu = NSMenu(title: title)
    fill(menu)
    item.submenu = menu
    bar.addItem(item)
}
let view = bar.item(withTitle: "View")!.submenu!
let branch = view.item(withTitle: "Show Branch Changes")!
assert(branch.keyEquivalent == "g" && branch.keyEquivalentModifierMask == [.command, .shift])
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
assert(!AppKeys.offeredToMenu(key("7", .command), conquerHasKeys: false))
// Anywhere else (the map, the page, the terminal): Show Branch Changes.
assert(bar.performKeyEquivalent(with: shiftG))
assert(menus.ran == ["branchChanges"], "\(menus.ran)")
// Conquer with the keyboard: the window leaves ⇧⌘G to Conquer's view (⌘1…⌘6 still go to the menu),
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
// The Files tab: after GitHub, before Settings; drawn by the page; shown whatever the integrations (⌘6 with them all).
assert(Mode.tabs == [.command, .conquer, .activity, .github, .files, .settings])
assert(Mode.files.drawnByPage && Mode.alwaysShown == [.files, .settings])
assert(Mode.files.title == "Files" && Mode.files.keys(at: 4) == "⌘5, ⇧⌘E or ⌘`")
assert(AppKeys.offeredToMenu(key("6", .command), conquerHasKeys: true))
print("App key checks passed.")
