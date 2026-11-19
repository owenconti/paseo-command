import AppKit

/// The app-wide keys the window offers the main menu ahead of its views (`AppWindow.performKeyEquivalent`):
/// ⌘1…⌘3, the mode bar's tabs; and ⇧⌘G, View → Show Branch Changes (the selected workspace's branch against main,
/// in its own editor beside its conversation). (⇧⌘E Show Files and ⌘W Close File Tab went with the Files tab, Conquer's
/// keys with Conquer.)
/// And ⌘R while a page with a refresh of its own shows (`pageRefreshes`): View → Refresh Page, which asks the
/// page's shown view to refresh (`page-refresh`), never a reload of the web view.
enum AppKeys {
    static func offeredToMenu(_ event: NSEvent, pageRefreshes: Bool = false) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        if flags == .command { return ("1"..."3").contains(key) || pageRefreshes && key == "r" }
        return flags == [.command, .shift] && key == "g"
    }

    /// What View → Refresh Page asks of the page: its shown view's own refresh (`pageRefresh.ts`).
    static let refreshPageCommand = "page-refresh"

    /// Whether ⌘R is the page's refresh: while GitHub or Activity shows (Settings has none) and no terminal has the
    /// keyboard. Your editor keeps ⌘R, as a terminal app does (it types no ⌘ keys); on the map it does nothing (the fleet
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

    /// What View → Show Branch Changes asks of the page: the selected workspace’s changes, in your editor,
    /// which the page then asks the app to show (or says why not).
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
    /// ⌘1…⌘3 pick the mode bar's tabs (the View menu's) from anywhere in the window, ahead of its
    /// views: the page, your editor and the agent's browser. ⇧⌘G (View → Show Branch Changes) likewise (`AppKeys`).
    /// ⌘R too while a page with a refresh shows (`AppKeys.pageRefreshes`): View → Refresh Page.
    var pageRefreshes: () -> Bool = { false }
    /// ⌘K while your editor or the agent's browser has the keyboard: the page's palette (`EditorKeys`).
    var terminalHasKeys: () -> Bool = { false }
    var onPalette: () -> Void = {}
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if EditorKeys.opensPalette(event), terminalHasKeys() { onPalette(); return true }
        if AppKeys.offeredToMenu(event, pageRefreshes: pageRefreshes()), NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
}
