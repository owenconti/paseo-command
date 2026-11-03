import AppKit

/// The app-wide keys the window offers the main menu ahead of its views (`AppWindow.performKeyEquivalent`):
/// ⌘1…⌘6, the mode bar's tabs; ⇧⌘E, View → Show Files (the selected workspace's files in the Files tab),
/// which nothing else in the app uses; and ⇧⌘G, View → Show Branch Changes (the selected workspace's branch
/// in the GitHub tab), except while Conquer has the keyboard: then ⇧⌘G goes on to Conquer, its Find Previous
/// (Show Branch Changes is disabled then, and a disabled item would still take the key in the menu).
/// And ⌘W while the Files tab shows (`filesShows`): View → Close File Tab, which closes the page's shown file
/// tab, so the window's Close never has it there and the page sees it only as `files-close-tab`.
enum AppKeys {
    static func offeredToMenu(_ event: NSEvent, conquerHasKeys: Bool, filesShows: Bool = false) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        if flags == .command { return ("1"..."6").contains(key) || filesShows && key == "w" }
        guard flags == [.command, .shift] else { return false }
        return key == "e" || !conquerHasKeys && key == "g"
    }

    /// View → Close File Tab, ⌘W: the Files tab's shown file tab (none open: nothing; the page decides). Enabled only
    /// while Files shows; the View menu comes before Conquer's and the Window menu, so it has ⌘W ahead of them there.
    /// Elsewhere it is disabled, and ⌘W goes on as before: Conquer's Close Tab while it has the keyboard (its view
    /// takes the key ahead of the menu), else the menu's first ⌘W, which, disabled, takes the key and does nothing.
    @discardableResult
    static func addCloseFileTab(to menu: NSMenu, target: AnyObject, action: Selector) -> NSMenuItem {
        let item = menu.addItem(withTitle: "Close File Tab", action: action, keyEquivalent: "w")
        item.keyEquivalentModifierMask = .command
        item.target = target
        return item
    }

    /// View → Show Files, ⇧⌘E.
    @discardableResult
    static func addShowFiles(to menu: NSMenu, target: AnyObject, action: Selector) -> NSMenuItem {
        let item = menu.addItem(withTitle: "Show Files", action: action, keyEquivalent: "e")
        item.keyEquivalentModifierMask = [.command, .shift]
        item.target = target
        return item
    }

    /// View → Show Branch Changes, ⇧⌘G.
    @discardableResult
    static func addBranchChanges(to menu: NSMenu, target: AnyObject, action: Selector) -> NSMenuItem {
        let item = menu.addItem(withTitle: "Show Branch Changes", action: action, keyEquivalent: "g")
        item.keyEquivalentModifierMask = [.command, .shift]
        item.target = target
        return item
    }

    /// The Conquer menu's commands (`ConquerView.commands`), each naming its command.
    static func addConquerCommands(to menu: NSMenu, target: AnyObject, action: Selector) {
        for command in ConquerView.commands {
            guard let command else { menu.addItem(.separator()); continue }
            let item = menu.addItem(withTitle: command.title, action: action, keyEquivalent: command.key)
            item.keyEquivalentModifierMask = command.mods
            item.representedObject = command.name
            item.target = target
            item.isHidden = command.hidden
            item.allowsKeyEquivalentWhenHidden = true
        }
    }
}
