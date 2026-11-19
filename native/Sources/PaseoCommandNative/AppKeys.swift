import AppKit

/// The app-wide keys the window offers the main menu ahead of its views (`AppWindow.performKeyEquivalent`):
/// ⌘1…⌘5, the mode bar's tabs; and ⇧⌘G, View → Show Branch Changes (the selected workspace's branch against main,
/// in its own editor beside its conversation), except while Conquer has the keyboard: then ⇧⌘G goes on to Conquer, its
/// Find Previous (Show Branch Changes is disabled then, and a disabled item would still take the key in the menu).
/// (⇧⌘E Show Files and ⌘W Close File Tab went with the Files tab.)
/// And ⌘R while a page with a refresh of its own shows (`pageRefreshes`): View → Refresh Page, which asks the
/// page's shown view to refresh (`page-refresh`), never a reload of the web view.
enum AppKeys {
    static func offeredToMenu(_ event: NSEvent, conquerHasKeys: Bool, pageRefreshes: Bool = false) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        if flags == .command { return ("1"..."5").contains(key) || pageRefreshes && key == "r" }
        guard flags == [.command, .shift] else { return false }
        return !conquerHasKeys && key == "g"
    }

    /// ⌘B, the page's session panel, which the window hands the page while the Terminal tab's terminal has
    /// the keyboard, as Conquer does for its pages: a terminal never types ⌘ keys.
    static func togglesPanel(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
        return event.modifierFlags.intersection([.command, .shift, .control, .option]) == .command && key == "b"
    }

    /// What View → Refresh Page asks of the page: its shown view's own refresh (`pageRefresh.ts`).
    static let refreshPageCommand = "page-refresh"

    /// Whether ⌘R is the page's refresh: while GitHub or Activity shows (Settings has none) and no terminal has the
    /// keyboard. An editor keeps ⌘R, as a terminal app does (it types no ⌘ keys); in Conquer it's Reload Page (its view
    /// takes it while it has the keyboard); on the map it does nothing (the fleet is live).
    static func pageRefreshes(_ mode: Mode, terminalHasKeys: Bool) -> Bool {
        [.github, .activity].contains(mode) && !terminalHasKeys
    }

    /// View → Refresh Page, ⌘R. Enabled only while `pageRefreshes`; the View menu comes before Conquer's, whose
    /// Reload Page is disabled then (Conquer's view takes ⌘R itself while it has the keyboard).
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

/// The app's window. While Conquer shows, it gives accessibility clients the address of
/// Conquer's page as its document (AXDocument), as a browser's window does; the page's
/// own web area gives its address (AXURL) too, for autofill and other assistive tools.
final class AppWindow: NSWindow {
    var document: () -> URL? = { nil }
    override func accessibilityDocument() -> String? {
        guard let url = document(), ["http", "https"].contains(url.scheme ?? "") else { return super.accessibilityDocument() }
        return url.absoluteString
    }
    /// ⌘1…⌘6 pick the mode bar's tabs (the View menu's) from anywhere in the window, ahead of its
    /// views: the page, the Terminal tab, and Conquer's pages even while it has the keyboard.
    /// ⇧⌘G (View → Show Branch Changes) likewise, but while Conquer has the keyboard (`conquerHasKeys`)
    /// it stays Conquer's Find Previous (`AppKeys`).
    var conquerHasKeys: () -> Bool = { false }
    /// ⌘R too while a page with a refresh shows (`AppKeys.pageRefreshes`): View → Refresh Page.
    var pageRefreshes: () -> Bool = { false }
    /// ⌘K while a terminal (the Terminal tab's or a file's editor) has the keyboard: the page's palette (`EditorKeys`).
    var terminalHasKeys: () -> Bool = { false }
    var onPalette: () -> Void = {}
    /// ⌘B while the Terminal tab's terminal has the keyboard: the page's session panel (`AppKeys.togglesPanel`).
    var tabTerminalHasKeys: () -> Bool = { false }
    var onTogglePanel: () -> Void = {}
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if EditorKeys.opensPalette(event), terminalHasKeys() { onPalette(); return true }
        if AppKeys.togglesPanel(event), tabTerminalHasKeys() { onTogglePanel(); return true }
        if AppKeys.offeredToMenu(event, conquerHasKeys: conquerHasKeys(), pageRefreshes: pageRefreshes()), NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
}
