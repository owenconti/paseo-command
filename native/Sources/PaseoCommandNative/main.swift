import ImageIO
import AppKit
import Foundation
import notify

/// How the app was launched:
///   --url <url>        the Paseo Command app to show (default http://127.0.0.1:<AppFlavor.port>/,
///                      or PASEO_COMMAND_URL)
///   --ambient <fps>    the ambient frame rate (default 30)
///   --size <w>x<h>     the window's size in points
///   --front            show the window in front without activating the app
///   --background       run as an accessory that never activates (checks, measurements)
///   --ignore-occlusion keep drawing while the window is covered (for checks)
///   --no-server        don't run the app's bundled server on the --url's local port
///   --checks           keep the scene's state current in the page (for checks)
///   --info <path>      write the window number and process ids there as JSON
///                      (and snapshots, on request, beside it as PNG)
struct Options {
    var url = URL(string: ProcessInfo.processInfo.environment["PASEO_COMMAND_URL"] ?? "http://127.0.0.1:\(AppFlavor.port)/")!
    var size: CGSize?
    var front = false
    /// An accessory app (no Dock icon) that never becomes active, so it can't
    /// take focus: for checks and measurements while someone is working.
    var background = false
    var info: String?
    /// Keep the scene's state current in the page (`--checks`).
    var checks = false
    /// Run the app's bundled server when showing it; `--no-server` leaves the port alone.
    var manageServer = true
    /// Whether `--url` was given: if not, an updated copy comes back at its saved page.
    var urlGiven = false

    init(_ args: [String]) {
        var i = 1
        func next() -> String? { i += 1; return i < args.count ? args[i] : nil }
        while i < args.count {
            switch args[i] {
            case "--url": if let v = next(), let u = URL(string: v) { url = u; urlGiven = true }
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

/// The app's own build on disk, so the mode bar can show when an update is ready.
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

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    /// Where Sparkle's update left the window (`Updater.installNow`), read once.
    private lazy var restored = Updater.takeRestorePage(port: AppFlavor.port)
    lazy var options: Options = {
        var options = Options(CommandLine.arguments)
        // Sparkle relaunches the updated copy without arguments: back at the page it was on.
        if !options.urlGiven, let restored = self.restored { options.url = restored.url }
        return options
    }()
    var main: WorldWindow?
    private var tokens: [Int32] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Before any web view or preference read: the released app's new bundle id
        // starts with none of the old app's Conquer tabs or page storage.
        if AppFlavor.isRelease, LegacyState.pending(), oldAppClosed() { LegacyState.migrate() }
        buildMenu()
        // The dev copy is told apart from the released app at a glance in the Dock.
        if !AppFlavor.isRelease { NSApp.dockTile.badgeLabel = "DEV" }
        let world = WorldWindow(options: options)
        main = world
        if !options.urlGiven, options.size == nil, let frame = restored?.frame { world.window.setFrame(frame, display: false) }
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
        listen("com.paseo.command.native.handover") { [weak self] in self?.main?.acceptHandOver() }
        // A ⌘-key (`<info>.key`'s character) as the keyboard sends it: the focused view
        // (a page, say) sees it before the menu, as with a real key press (checks).
        listen("com.paseo.command.native.key") { [weak self] in
            let codes: [String: UInt16] = ["e": 14, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25]
            guard let self, let info = self.options.info, let window = self.main?.window,
                  let key = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".key", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
                  let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, characters: key, charactersIgnoringModifiers: key,
                                               isARepeat: false, keyCode: codes[key] ?? 0)
            else { return }
            // As AppKit offers a key equivalent: the window's views (a page among them) first, then the menu.
            let viewTook = window.performKeyEquivalent(with: event)
            Log.line("⌘\(key): views took it \(viewTook)")
            if !viewTook { NSApp.mainMenu?.performKeyEquivalent(with: event) }
        }
        // ⌘` as the keyboard sends it, through the main menu (steps to the next tab).
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
        // Open `<info>.url`'s address as a link from the chat would (checks).
        listen("com.paseo.command.native.appopen") { [weak self] in
            guard let self, let info = self.options.info,
                  let text = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".url", encoding: .utf8),
                  let url = ConquerView.destination(text) else { return }
            self.main?.openInApp(url)
        }
        listen("com.paseo.command.native.mode") { [weak self] in
            guard let main = self?.main else { return }
            main.show(main.mode == .command ? .conquer : .command)
        }
        listen("com.paseo.command.native.linear") { [weak self] in self?.main?.show(.linear) }
        listen("com.paseo.command.native.slack") { [weak self] in self?.main?.show(.slack) }
        listen("com.paseo.command.native.github") { [weak self] in self?.main?.show(.github) }
        listen("com.paseo.command.native.activity") { [weak self] in self?.main?.show(.activity) }
        // Run `<info>.do`'s Conquer steps, one a line, a second apart (checks; see `ConquerView.check`).
        listen("com.paseo.command.native.conquer") { [weak self] in
            guard let self, let info = self.options.info,
                  let text = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".do", encoding: .utf8) else { return }
            self.main?.show(.conquer)
            for (i, line) in text.split(separator: "\n").map(String.init).enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(i)) { [weak self] in self?.main?.conquer.check(line) }
            }
        }
        // Open `<info>.url`'s address in a Conquer tab (checks).
        listen("com.paseo.command.native.open") { [weak self] in
            guard let self, let info = self.options.info,
                  let text = try? String(contentsOfFile: (info as NSString).deletingPathExtension + ".url", encoding: .utf8),
                  let url = ConquerView.destination(text) else { return }
            self.main?.show(.conquer)
            self.main?.conquer.whenStarted { self.main?.conquer.open(url) }
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
        // The window as the screen shows it (`<info>-window.png`), unlike `snapshot`, which
        // composes its parts and can show a view that isn't actually on screen. An app
        // may capture its own windows; the call is looked up as newer SDKs hide it.
        listen("com.paseo.command.native.windowshot") { [weak self] in
            guard let self, let info = self.options.info, let window = self.main?.window else { return }
            typealias Capture = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
            guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { return }
            // Just this window, at its pixel size, without its shadow.
            let capture = unsafeBitCast(symbol, to: Capture.self)
            guard let image = capture(.null, 1 << 3, UInt32(window.windowNumber), 1 << 0 | 1 << 3)?.takeRetainedValue() else { return }
            let url = URL(fileURLWithPath: (info as NSString).deletingPathExtension + "-window.png")
            guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return }
            CGImageDestinationAddImage(destination, image, nil)
            CGImageDestinationFinalize(destination)
        }
        listen("com.paseo.command.native.snapshot") { [weak self] in
            guard let self, let info = self.options.info else { return }
            self.main?.snapshot(to: (info as NSString).deletingPathExtension + ".png")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.writeInfo() }
        // The released app says in the mode bar when Sparkle has an update waiting
        // for Restart app; a dev copy, when a newer build is.
        if let updater = Updater.shared {
            updater.currentPage = { [weak self] in self?.main.map { ($0.window.frame, $0.pageURL) } }
            updater.onChange = { [weak self] in
                self?.main?.modeBar.updateReady = Updater.shared?.pendingVersion != nil
                self?.main?.send(Updater.event, as: "paseo:update")
            }
        } else {
            Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                self?.main?.modeBar.updateReady = Build.newer
            }
        }
    }

    /// The bundled server goes with the app.
    func applicationWillTerminate(_ notification: Notification) {
        main?.server?.stop()
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
            "conquerFrame": NSStringFromRect(main.conquer.frame), "conquerFocus": main.conquer.hasKeyFocus,
            "commandShown": !main.command.isHiddenOrHasHiddenAncestor,
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
        if let updater = Updater.shared {
            let check = appMenu.addItem(withTitle: "Check for Updates…", action: #selector(Updater.checkNow(_:)), keyEquivalent: "")
            check.target = updater
            appMenu.addItem(.separator())
        }
        appMenu.addItem(withTitle: "Hide \(AppFlavor.name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(AppFlavor.name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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
        for mode in Mode.allCases {
            let item = view.addItem(withTitle: mode.title, action: #selector(showMode(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode.rawValue
        }
        // ⌘` steps Command → Conquer → Linear → Slack → GitHub → Activity → Command, through those shown
        // (ahead of macOS's own window cycling, as the app has one window).
        view.addItem(withTitle: "Next: Command, Conquer", action: #selector(toggleMode), keyEquivalent: "`").target = self
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
        // Conquer takes these keys itself, ahead of the page (`ConquerView.performKeyEquivalent`).
        for command in ConquerView.commands {
            guard let command else { conquer.addItem(.separator()); continue }
            let item = conquer.addItem(withTitle: command.title, action: #selector(conquerCommand(_:)), keyEquivalent: command.key)
            item.keyEquivalentModifierMask = command.mods
            item.representedObject = command.name
            item.target = self
            item.isHidden = command.hidden
            item.allowsKeyEquivalentWhenHidden = true
        }
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

    @objc private func toggleTerminal() { main?.toggleTerminal() }
    @objc private func moveTerminal() { main?.moveTerminal() }
    @objc private func maximizeTerminal() { main?.maximizeTerminal() }
    @objc private func unsplitTerminals() { main?.drawer.unsplit() }
    @objc private func zoomTerminal(_ sender: NSMenuItem) { main?.drawer.zoom(CGFloat(sender.tag)) }
    @objc private func toggleMode() {
        guard let main else { return }
        main.show(main.nextMode)
    }
    @objc private func showMode(_ sender: NSMenuItem) {
        if let mode = (sender.representedObject as? String).flatMap(Mode.init(rawValue:)) { main?.show(mode) }
    }
    @objc private func conquerCommand(_ sender: NSMenuItem) {
        if let name = sender.representedObject as? String { main?.conquer.perform(name) }
    }
    /// Window → Close, whose ⌘W is Close Tab's while Conquer shows.
    private var closeWindow: NSMenuItem?

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard let main else { return false }
        // Conquer's commands: while it shows and has the keyboard (the chat panel keeps them otherwise).
        let browser = main.mode == .conquer && main.conquer.hasKeyFocus
        closeWindow?.keyEquivalent = browser ? "" : "w"
        switch item.action {
        case #selector(showMode(_:)):
            item.state = item.representedObject as? String == main.mode.rawValue ? .on : .off
            return (item.representedObject as? String).flatMap(Mode.init(rawValue:)).map(main.shownModes.contains) ?? false
        case #selector(toggleMode):
            item.title = "Next: " + main.shownModes.map(\.title).joined(separator: ", ")
        case #selector(conquerCommand(_:)):
            if item.representedObject as? String == "togglePin" { item.title = main.conquer.current?.isPinned == true ? "Unpin Tab" : "Pin Tab" }
            return browser
        case #selector(moveTerminal): item.state = main.drawer.dock == .bottom ? .on : .off
        case #selector(unsplitTerminals): return !main.drawer.isHidden && main.drawer.isSplit
        case #selector(maximizeTerminal):
            item.state = main.drawer.maximized ? .on : .off
            return !main.drawer.isHidden
        // Only while the terminal shows, so the keys stay the page's otherwise; while Linear or
        // Slack or GitHub shows, only while the terminal has the keyboard (the page sizes their text with them).
        case #selector(zoomTerminal(_:)):
            return !main.drawer.isHidden && ((main.mode != .linear && main.mode != .slack && main.mode != .github) || main.drawer.hasKeyFocus)
        default: break
        }
        return true
    }

    /// The old app writes the preferences and WebKit folders being copied, so it must
    /// be closed first: offer to quit it. False skips the migration this launch only
    /// (it isn't marked done, so the next launch asks again).
    private func oldAppClosed() -> Bool {
        let running = { NSRunningApplication.runningApplications(withBundleIdentifier: LegacyState.oldBundleID) }
        guard !running().isEmpty else { return true }
        // A check copy never puts up a modal alert.
        if options.background { Log.line("migration: the old app is open; skipped this launch"); return false }
        let alert = NSAlert()
        alert.messageText = "The previous Paseo Command is still open."
        alert.informativeText = "Quit it to bring over your tabs and settings."
        alert.addButton(withTitle: "Quit It and Continue")
        alert.addButton(withTitle: "Continue Without")
        guard alert.runModal() == .alertFirstButtonReturn else {
            Log.line("migration: the old app is open; skipped this launch")
            return false
        }
        running().forEach { $0.terminate() }
        let deadline = Date() + 10
        while !running().isEmpty && Date() < deadline { RunLoop.current.run(until: Date() + 0.2) }
        guard running().isEmpty else {
            Log.line("migration: the old app didn't quit within 10 s; skipped this launch")
            return false
        }
        return true
    }

    /// The palette's Restart app: install Sparkle's waiting update (the app quits and
    /// comes back updated); otherwise stop our server, then relaunch at the same window
    /// position and page with the latest build, whose copy starts its own.
    @objc func reloadApp(_ sender: Any?) {
        guard let main, !reloading else { return }
        reloading = true
        if let updater = Updater.shared, updater.pendingVersion != nil {
            main.showSplash("Updating…")
            if updater.installNow() {
                // Sparkle quits the app to install. Still here after 30 s: it didn't, so
                // give the window back rather than leave it under the splash.
                DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
                    guard let self, self.reloading else { return }
                    Log.line("update install didn't finish")
                    self.reloading = false
                    main.splash.hide()
                }
                return
            }
        }
        // The splash covers the reload; a newer build's copy puts up its own.
        main.showSplash("Restarting…")
        restart(main)
    }
    private var reloading = false

    private func restart(_ main: WorldWindow) {
        // Off the main queue: the server may take a few seconds to close.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            main.server?.stop()
            DispatchQueue.main.async {
                self?.reloading = false
                self?.relaunch(main)
            }
        }
    }

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
        Log.line("restarting with the latest build")
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

if let info = Options(CommandLine.arguments).info {
    AppFlavor.checkData = FileManager.default.temporaryDirectory
        .appendingPathComponent("paseo-command-check-" + ((info as NSString).lastPathComponent as NSString).deletingPathExtension, isDirectory: true)
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(Options(CommandLine.arguments).background ? .accessory : .regular)
app.run()
