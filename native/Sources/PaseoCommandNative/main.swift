import AppKit
import Foundation
import notify

/// How the app was launched:
///   --url <url>        the Paseo Command app to show (default http://127.0.0.1:4310/,
///                      or PASEO_COMMAND_URL)
///   --ambient <fps>    the ambient frame rate (default 30)
///   --size <w>x<h>     the window's size in points
///   --front            show the window in front without activating the app
///   --background       run as an accessory that never activates (checks, measurements)
///   --ignore-occlusion keep drawing while the window is covered (for checks)
///   --no-server        don't start the app's server (app:start on the --url's local port) when it isn't running
///   --checks           keep the scene's state current in the page (for checks)
///   --info <path>      write the window number and process ids there as JSON
///                      (and snapshots, on request, beside it as PNG)
struct Options {
    var url = URL(string: ProcessInfo.processInfo.environment["PASEO_COMMAND_URL"] ?? "http://127.0.0.1:4310/")!
    var size: CGSize?
    var front = false
    /// An accessory app (no Dock icon) that never becomes active, so it can't
    /// take focus: for checks and measurements while someone is working.
    var background = false
    var info: String?
    /// Keep the scene's state current in the page (`--checks`).
    var checks = false
    /// Run the app's own server (`app:start`) when showing it; `--no-server` leaves it alone.
    var manageServer = true

    init(_ args: [String]) {
        var i = 1
        func next() -> String? { i += 1; return i < args.count ? args[i] : nil }
        while i < args.count {
            switch args[i] {
            case "--url": if let v = next(), let u = URL(string: v) { url = u }
            case "--ambient": if let v = next(), let n = Int(v) { AtlasView.ambientRate = n }
            case "--size":
                if let v = next() {
                    let parts = v.split(separator: "x").compactMap { Double($0) }
                    if parts.count == 2 { size = CGSize(width: parts[0], height: parts[1]) }
                }
            case "--front": front = true
            case "--background": background = true
            case "--ignore-occlusion": AtlasView.ignoreOcclusion = true
            case "--info": info = next()
            case "--checks": checks = true
            case "--no-server": manageServer = false
            default: break
            }
            i += 1
        }
    }
}

/// The app's own build on disk, so ⌘R can tell when a newer one is ready.
enum Build {
    static func stamp() -> Date? {
        guard let path = Bundle.main.executablePath else { return nil }
        return (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
    }
    static let launched = stamp()
    /// A newer build has replaced this one's executable since launch.
    static var newer: Bool {
        guard let now = stamp(), let then = launched else { return false }
        return now > then
    }
}

enum Log {
    static func line(_ text: String) {
        FileHandle.standardError.write("[paseo-native] \(text)\n".data(using: .utf8)!)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    let options = Options(CommandLine.arguments)
    var main: WorldWindow?
    private var tokens: [Int32] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let world = WorldWindow(options: options)
        main = world
        // Never take focus from whatever the user is doing: the window comes
        // up without activating the app.
        if options.front { world.window.orderFrontRegardless() } else { world.window.orderFront(nil) }
        Log.line("window \(world.window.windowNumber) loading \(options.url.absoluteString)")
        // Check and measurement hooks, posted with `notifyutil -p <name>`. They
        // reach every copy on the machine, so only a copy run for checks
        // (`--info`) listens: the user's own copy ignores them.
        listen("com.paseo.command.native.pan") { [weak self] in self?.main?.scriptedPan(seconds: 10) }
        listen("com.paseo.command.native.info") { [weak self] in self?.writeInfo() }
        listen("com.paseo.command.native.quit") { NSApp.terminate(nil) }
        listen("com.paseo.command.native.reload") { [weak self] in self?.reloadApp(nil) }
        // ⌘R as the keyboard sends it, through the main menu (checks the menu's routing).
        listen("com.paseo.command.native.keyreload") {
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0,
                                               windowNumber: 0, context: nil, characters: "r", charactersIgnoringModifiers: "r",
                                               isARepeat: false, keyCode: 15) else { return }
            Log.line("⌘R through the menu: \(NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false)")
        }
        // A ⌘-key as the keyboard sends it (`<info>.key`'s character), through the main menu (checks).
        listen("com.paseo.command.native.key") { [weak self] in
            guard let self, let info = self.options.info,
                  let key = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".key", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
                  let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0, windowNumber: 0,
                                               context: nil, characters: key, charactersIgnoringModifiers: key, isARepeat: false, keyCode: 0)
            else { return }
            Log.line("⌘\(key) through the menu: \(NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false)")
        }
        // ⌘` as the keyboard sends it, through the main menu (switches Command and Conquer).
        listen("com.paseo.command.native.keymode") {
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0,
                                               windowNumber: 0, context: nil, characters: "`", charactersIgnoringModifiers: "`",
                                               isARepeat: false, keyCode: 50) else { return }
            Log.line("⌘` through the menu: \(NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false)")
        }
        listen("com.paseo.command.native.terminal") { [weak self] in self?.main?.toggleTerminal() }
        listen("com.paseo.command.native.dock") { [weak self] in self?.main?.moveTerminal() }
        listen("com.paseo.command.native.maximize") { [weak self] in self?.main?.maximizeTerminal() }
        listen("com.paseo.command.native.split") { [weak self] in self?.main?.drawer.splitForCheck() }
        // Drag the terminal panel's divider 150 points towards the map (checks).
        listen("com.paseo.command.native.divider") { [weak self] in
            guard let split = self?.main?.split, split.subviews.count > 1 else { return }
            let first = split.subviews[0].frame
            split.setPosition((split.isVertical ? first.width : first.height) - 150, ofDividerAt: 0)
        }
        listen("com.paseo.command.native.unsplit") { [weak self] in self?.main?.drawer.unsplit() }
        listen("com.paseo.command.native.newterminal") { [weak self] in self?.main?.drawer.newTerminal() }
        listen("com.paseo.command.native.zoom") { [weak self] in self?.main?.drawer.zoom(1) }
        listen("com.paseo.command.native.mode") { [weak self] in
            guard let main = self?.main else { return }
            main.show(main.mode == .command ? .conquer : .command)
        }
        // Open `<info>.url`'s address in a Conquer tab (checks).
        listen("com.paseo.command.native.open") { [weak self] in
            guard let self, let info = self.options.info,
                  let text = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".url", encoding: .utf8),
                  let url = ConquerView.destination(text) else { return }
            self.main?.show(.conquer)
            self.main?.conquer.open(url)
        }
        // Type `<info>.type`'s text into the drawer's terminal, as keys would.
        listen("com.paseo.command.native.type") { [weak self] in
            guard let self, let info = self.options.info,
                  let text = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".type", encoding: .utf8) else { return }
            self.main?.drawer.type(text)
        }
        // Run `<info>.js` in the page, writing its result to `<info>.out` (checks and tests).
        listen("com.paseo.command.native.eval") { [weak self] in
            guard let self, let info = self.options.info, let main = self.main else { return }
            let base = (info as NSString).deletingPathExtension
            guard let js = try? String(contentsOfFile: base + ".js", encoding: .utf8) else { return }
            main.web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                let text: String
                switch result {
                case .success(let value):
                    if JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
                        text = String(data: data, encoding: .utf8) ?? ""
                    } else { text = "\(value)" }
                case .failure(let error): text = "error: \(error)"
                }
                try? text.write(toFile: base + ".out", atomically: true, encoding: .utf8)
            }
        }
        // Alternate the window between its size and a smaller, taller one (checks).
        listen("com.paseo.command.native.resize") { [weak self] in
            guard let window = self?.main?.window else { return }
            let small = window.frame.width > 1200
            var frame = window.frame
            frame.size = small ? CGSize(width: 1000, height: 960) : (self?.options.size ?? CGSize(width: 1440, height: 900))
            window.setFrame(window.frameRect(forContentRect: CGRect(origin: frame.origin, size: frame.size)), display: true)
        }
        listen("com.paseo.command.native.snapshot") { [weak self] in
            guard let self, let info = self.options.info else { return }
            self.main?.snapshot(to: (info as NSString).deletingPathExtension + ".png")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.writeInfo() }
        // Say in the title bar when a newer build is waiting for ⌘R.
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.main?.window.subtitle = Build.newer ? "Update ready · ⌘R" : ""
        }
    }

    private func listen(_ name: String, _ action: @escaping () -> Void) {
        guard let info = options.info else { return }
        // Named for this run too (`<name>.<info file's name>`), so posts for
        // one copy never reach another.
        let run = ((info as NSString).lastPathComponent as NSString).deletingPathExtension
        var token: Int32 = 0
        notify_register_dispatch("\(name).\(run)", &token, DispatchQueue.main) { _ in action() }
        tokens.append(token)
    }

    private func writeInfo() {
        guard let path = options.info, let main else { return }
        let info: [String: Any] = [
            "window": main.window.windowNumber, "pids": main.processes(),
            "mode": main.mode.rawValue, "conquer": main.conquer.state(),
            "visible": main.window.occlusionState.contains(.visible), "framesDrawn": main.scene.framesDrawn,
            "paused": main.atlasView.isPaused, "fps": main.atlasView.preferredFramesPerSecond,
            "terminal": main.drawer.state(),
            "splash": main.splash.showing,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildMenu() {
        let bar = NSMenu()
        let appItem = NSMenuItem()
        bar.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide Paseo Command", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Paseo Command", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        // The page's text fields need the standard editing commands.
        let editItem = NSMenuItem()
        bar.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem()
        bar.addItem(viewItem)
        let view = NSMenu(title: "View")
        // Targeted at this delegate: left to the responder chain, the web view
        // (which has its own `reload`) would answer ⌘R and skip the update check.
        let reload = view.addItem(withTitle: "Reload", action: #selector(reloadApp(_:)), keyEquivalent: "r")
        reload.target = self
        let terminal = view.addItem(withTitle: "Terminal", action: #selector(toggleTerminal), keyEquivalent: "`")
        terminal.target = self
        terminal.keyEquivalentModifierMask = [.control]
        let bottom = view.addItem(withTitle: "Terminal at Bottom", action: #selector(moveTerminal), keyEquivalent: "")
        bottom.target = self
        let maximize = view.addItem(withTitle: "Maximize Terminal", action: #selector(maximizeTerminal), keyEquivalent: "\r")
        maximize.target = self
        maximize.keyEquivalentModifierMask = [.command, .shift]
        let unsplit = view.addItem(withTitle: "Unsplit Terminals", action: #selector(unsplitTerminals), keyEquivalent: "")
        unsplit.target = self
        view.addItem(.separator())
        for (title, mode) in [("Command", Mode.command), ("Conquer", Mode.conquer)] {
            let item = view.addItem(withTitle: title, action: #selector(showMode(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode.rawValue
        }
        // ⌘` flips between the two (ahead of macOS's own window cycling, as the app has one window).
        view.addItem(withTitle: "Switch Command / Conquer", action: #selector(toggleMode), keyEquivalent: "`").target = self
        view.addItem(.separator())
        // The terminals' text size. ⌘= reaches "Bigger" too, as ⌘+ needs ⇧ on most layouts.
        for (title, key, step, hidden) in [("Bigger Terminal Text", "+", 1, false), ("Bigger Terminal Text", "=", 1, true),
                                           ("Smaller Terminal Text", "-", -1, false), ("Actual Terminal Text Size", "0", 0, false)] {
            let item = view.addItem(withTitle: title, action: #selector(zoomTerminal(_:)), keyEquivalent: key)
            item.target = self
            item.tag = step
            item.isHidden = hidden
            item.allowsKeyEquivalentWhenHidden = true
        }
        viewItem.submenu = view
        // The browser's own commands, while it shows (the page keeps these keys otherwise).
        let conquerItem = NSMenuItem()
        bar.addItem(conquerItem)
        let conquer = NSMenu(title: "Conquer")
        // ⌘E steps to the next tab; ⌃Tab reaches it too, as in other browsers.
        for (title, key, mask, action, hidden) in [("New Tab", "t", NSEvent.ModifierFlags.command, #selector(newTab), false),
                                                   ("Close Tab", "w", .command, #selector(closeTab), false),
                                                   ("Open Location…", "l", .command, #selector(openLocation), false),
                                                   ("Next Tab", "e", .command, #selector(nextTab), false),
                                                   ("Next Tab", "\t", .control, #selector(nextTab), true),
                                                   ("Previous Tab", "\t", [.control, .shift], #selector(previousTab), false)] {
            let item = conquer.addItem(withTitle: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = mask
            item.target = self
            item.isHidden = hidden
            item.allowsKeyEquivalentWhenHidden = true
        }
        // ⌘1…⌘8 go to that tab, ⌘9 to the last.
        for n in 1...9 {
            let item = conquer.addItem(withTitle: n == 9 ? "Last Tab" : "Tab \(n)", action: #selector(goToTab(_:)), keyEquivalent: "\(n)")
            item.tag = n
            item.target = self
            item.isHidden = true
            item.allowsKeyEquivalentWhenHidden = true
        }
        conquer.addItem(.separator())
        conquer.addItem(withTitle: "Import Zen Cookies", action: #selector(importZenCookies), keyEquivalent: "").target = self
        conquerItem.submenu = conquer
        let windowItem = NSMenuItem()
        bar.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        closeWindow = windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        NSApp.mainMenu = bar
        NSApp.windowsMenu = windowMenu
    }

    /// ⌘R: the page reloads with the latest web build; if a newer native
    /// build is on disk, the app swaps itself for it in place: same window,
    /// same page, no quitting by hand.
    @objc private func toggleTerminal() { main?.toggleTerminal() }
    @objc private func moveTerminal() { main?.moveTerminal() }
    @objc private func maximizeTerminal() { main?.maximizeTerminal() }
    @objc private func unsplitTerminals() { main?.drawer.unsplit() }
    @objc private func zoomTerminal(_ sender: NSMenuItem) { main?.drawer.zoom(CGFloat(sender.tag)) }
    @objc private func toggleMode() {
        guard let main else { return }
        main.show(main.mode == .command ? .conquer : .command)
    }
    @objc private func showMode(_ sender: NSMenuItem) {
        if let mode = (sender.representedObject as? String).flatMap(Mode.init(rawValue:)) { main?.show(mode) }
    }
    @objc private func newTab() { main?.conquer.newTab() }
    @objc private func closeTab() { main?.conquer.closeTab() }
    @objc private func openLocation() { main?.conquer.focusAddress() }
    @objc private func nextTab() { main?.conquer.cycle(1) }
    @objc private func previousTab() { main?.conquer.cycle(-1) }
    @objc private func goToTab(_ sender: NSMenuItem) { main?.conquer.selectTab(sender.tag) }
    @objc func importZenCookies() {
        main?.conquer.importZenCookies { [weak self] in
            guard let window = self?.main?.window, let conquer = self?.main?.conquer else { return }
            let alert = NSAlert()
            alert.messageText = "Imported from Zen Browser"
            alert.informativeText = "\(conquer.imported). Reload a page to use them."
            alert.beginSheetModal(for: window)
        }
    }
    /// Window → Close, whose ⌘W is Close Tab's while Conquer shows.
    private var closeWindow: NSMenuItem?

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard let main else { return false }
        let browsing = main.mode == .conquer
        closeWindow?.keyEquivalent = browsing ? "" : "w"
        switch item.action {
        case #selector(showMode(_:)): item.state = item.representedObject as? String == main.mode.rawValue ? .on : .off
        case #selector(newTab), #selector(closeTab), #selector(openLocation), #selector(nextTab), #selector(previousTab),
             #selector(goToTab(_:)):
            return browsing
        case #selector(toggleTerminal), #selector(moveTerminal): return !browsing
        case #selector(moveTerminal): item.state = main.drawer.dock == .bottom ? .on : .off
        case #selector(unsplitTerminals): return !browsing && !main.drawer.isHidden && main.drawer.isSplit
        case #selector(maximizeTerminal):
            item.state = main.drawer.maximized ? .on : .off
            return !browsing && !main.drawer.isHidden
        // Only while the terminal shows, so the keys stay the page's otherwise.
        case #selector(zoomTerminal(_:)): return !browsing && !main.drawer.isHidden
        default: break
        }
        return true
    }

    /// ⌘R: the server first (restarted if its code changed), then this
    /// app (relaunched if a newer build is on disk) or just the page.
    @objc func reloadApp(_ sender: Any?) {
        guard let main, !reloading else { return }
        // In Conquer, ⌘R reloads its page, unless a newer build is waiting.
        if main.mode == .conquer && !Build.newer { return main.conquer.reloadPage() }
        reloading = true
        // The splash covers the reload; a newer build's copy puts up its own.
        main.showSplash("Reloading…")
        main.refreshServer { [weak self] ready in
            self?.reloading = false
            guard ready else { return }
            if Build.newer { self?.relaunch(main) } else { main.reload() }
        }
    }
    private var reloading = false

    private func relaunch(_ main: WorldWindow) {
        main.window.saveFrame(usingName: WorldWindow.frameName)
        // The same options, at the page the window is on now.
        var args: [String] = []
        var rest = Array(CommandLine.arguments.dropFirst())
        while !rest.isEmpty {
            let arg = rest.removeFirst()
            if arg == "--url" || arg == "--size" { if !rest.isEmpty { rest.removeFirst() }; continue }
            args.append(arg)
        }
        args += ["--url", main.pageURL.absoluteString]
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.arguments = args
        Log.line("relaunching for a newer build")
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, error in
            DispatchQueue.main.async {
                if let error {
                    Log.line("relaunch failed: \(error.localizedDescription)")
                    main.reload()
                } else {
                    NSApp.terminate(nil)
                }
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(Options(CommandLine.arguments).background ? .accessory : .regular)
app.run()
