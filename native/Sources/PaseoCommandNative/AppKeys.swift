import AppKit

/// The app-wide keys the window offers the main menu ahead of its views (`AppWindow.performKeyEquivalent`):
/// ⌘1…⌘4, the mode bar's tabs; ⇧⌘G, View → Show Branch Changes (the selected workspace's branch against its base,
/// the Files tab's Branch view beside its conversation); and View → Show Files ⇧⌘F, Show Terminal ⇧⌘T, Show
/// Browser ⇧⌘B and Focus Message Box ⇧⌘D, the open agent's tools beside its conversation and its message box, and
/// Show or Hide Tools ⌥⌘B, the panel they share, from anywhere (the terminal and its browser's pages included).
/// (The Editor tab's Show Editor ⇧⌘E went with it.) (Conquer's keys went with Conquer.)
/// And ⌘R while a page with a refresh of its own shows (`pageRefreshes`): View → Refresh Page, which asks the
/// page's shown view to refresh (`page-refresh`), never a reload of the web view.
enum AppKeys {
    static func offeredToMenu(_ event: NSEvent, pageRefreshes: Bool = false) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        if flags == .command { return ("1"..."4").contains(key) || pageRefreshes && key == "r" }
        if flags == [.command, .option] { return key == toggleTools.key }
        return flags == [.command, .shift] && ["g", "f", "t", "b", "d"].contains(key)
    }

    /// View's tool items: their titles, ⇧⌘ keys and the page command each asks (`web/src/main.tsx`).
    static let tools: [(title: String, key: String, command: String)] = [
        ("Show Files", "f", "tools-files"),
        ("Show Terminal", "t", "tools-terminal"),
        ("Show Browser", "b", "tools-browser"),
        ("Focus Message Box", "d", "focus-composer"),
    ]

    /// View → Show or Hide Tools, ⌥⌘B: the panel of tools beside the conversation, hidden (the conversation taking the
    /// width) or shown again with the tool last shown (the page's `tools-toggle`).
    static let toggleTools = (title: "Show or Hide Tools", key: "b", command: "tools-toggle")

    /// View → Show Files, Show Terminal, Show Browser, Focus Message Box, each naming its page command,
    /// then Show or Hide Tools.
    static func addTools(to menu: NSMenu, target: AnyObject, action: Selector) {
        for tool in tools {
            let item = menu.addItem(withTitle: tool.title, action: action, keyEquivalent: tool.key)
            item.keyEquivalentModifierMask = [.command, .shift]
            item.representedObject = tool.command
            item.target = target
        }
        let item = menu.addItem(withTitle: toggleTools.title, action: action, keyEquivalent: toggleTools.key)
        item.keyEquivalentModifierMask = [.command, .option]
        item.representedObject = toggleTools.command
        item.target = target
    }

    /// What View → Refresh Page asks of the page: its shown view's own refresh (`pageRefresh.ts`).
    static let refreshPageCommand = "page-refresh"

    /// Whether ⌘R is the page's refresh: while GitHub or Activity shows (Settings has none) and no terminal has the
    /// keyboard. The terminal keeps ⌘R, as a terminal app does (it types no ⌘ keys); on the map it does nothing (the fleet
    /// is live).
    static func pageRefreshes(_ mode: Mode, terminalHasKeys: Bool) -> Bool {
        [.github, .activity].contains(mode) && !terminalHasKeys
    }

    /// View → Refresh Page, ⌘R. Enabled only while `pageRefreshes`.
    @discardableResult
    static func addRefreshPage(to menu: NSMenu, target: AnyObject, action: Selector) -> NSMenuItem {
        let item = menu.addItem(withTitle: "Refresh Page", action: action, keyEquivalent: "r")
        item.keyEquivalentModifierMask = .command
        item.target = target
        return item
    }

    /// What View → Show Branch Changes asks of the page: the selected workspace’s branch changes, in the Files tab,
    /// which the page shows (or says why not).
    static let branchChangesCommand = "branch-changes"

    /// View → Show Branch Changes, ⇧⌘G.
    @discardableResult
    static func addBranchChanges(to menu: NSMenu, target: AnyObject, action: Selector) -> NSMenuItem {
        let item = menu.addItem(withTitle: "Show Branch Changes", action: action, keyEquivalent: "g")
        item.keyEquivalentModifierMask = [.command, .shift]
        item.target = target
        return item
    }
}

/// The app's window.
final class AppWindow: NSWindow {
    /// ⌘1…⌘4 pick the mode bar's tabs (the View menu's) from anywhere in the window, ahead of its
    /// views: the page, the terminal and the agent's browser. ⇧⌘G and View's tools (⇧⌘F, ⇧⌘T, ⇧⌘B, ⇧⌘D) likewise (`AppKeys`).
    /// ⌘R too while a page with a refresh shows (`AppKeys.pageRefreshes`): View → Refresh Page.
    var pageRefreshes: () -> Bool = { false }
    /// ⌘K while the terminal or the agent's browser has the keyboard: the page's palette (`EditorKeys`).
    var terminalHasKeys: () -> Bool = { false }
    var onPalette: () -> Void = {}
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if EditorKeys.opensPalette(event), terminalHasKeys() { onPalette(); return true }
        if AppKeys.offeredToMenu(event, pageRefreshes: pageRefreshes()), NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
}
