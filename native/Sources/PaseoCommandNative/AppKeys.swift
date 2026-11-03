import AppKit

/// The app-wide keys the window offers the main menu ahead of its views (`AppWindow.performKeyEquivalent`):
/// ⌘1…⌘6, the mode bar's tabs, and ⇧⌘G, View → Show Branch Changes (the selected workspace's branch in the
/// GitHub tab), except while Conquer has the keyboard: then ⇧⌘G goes on to Conquer, its Find Previous
/// (Show Branch Changes is disabled then, and a disabled item would still take the key in the menu).
enum AppKeys {
    static func offeredToMenu(_ event: NSEvent, conquerHasKeys: Bool) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers else { return false }
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        return flags == .command && ("1"..."6").contains(key) || !conquerHasKeys && flags == [.command, .shift] && key.lowercased() == "g"
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
