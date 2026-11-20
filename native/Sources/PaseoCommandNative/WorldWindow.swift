import AppKit
import ImageIO
import WebKit

/// One window: the React app in a web view, which draws the fleet itself (Crew) and its panels and
/// pages, and over it the native views laid over boxes the page draws (your editor and the agent's
/// browser, beside an agent's conversation). The page keeps every pointer and key event as in a browser,
/// and keeps focus and its shortcuts.
final class WorldWindow: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let window: NSWindow
    let web: WKWebView
    /// Your editor's terminal, over the pane beside an agent's conversation (Settings → Files' command).
    let editors: EditorOverlay
    /// The terminals' font (Settings → Terminal; ⌘+, ⌘−, ⌘0 its size), kept across launches.
    private(set) var terminalFont = TerminalFontSettings()
    /// The browser attached to each agent, over the box the page draws for it beside its conversation (`BoardBrowser.swift`).
    let boardBrowser: BoardBrowser
    /// Over the page, the window's (not the page's sibling): where your editor and the agent's browser
    /// go. It lets everything else through to the page.
    let content: NSView
    /// Covers the window until the page has its fleet (its `loaded` message).
    let splash: SplashView
    /// The strip across the top that switches between Crew, Command, GitHub, Activity and Settings.
    let modeBar: ModeBar
    /// Command: the page, under `content`, the splash and the mode bar.
    let command: NSView
    /// The mode bar's height: the page's own top bar, whose tools show at its right end.
    let barHeight: CGFloat
    private(set) var mode: Mode = .crew
    /// Keep drawing when the window is covered (`--ignore-occlusion`, for checks): the page and the robot's browser.
    static var ignoreOcclusion = false
    let options: Options
    /// The page's sides that can show: those whose integration is on (the page says, with
    /// `integrations`), and Settings.
    private(set) var enabledModes: Set<Mode> = Mode.alwaysShown { didSet { if enabledModes != oldValue { onModesChanged?() } } }
    /// The tabs shown changed (the View menu renumbers its keys).
    var onModesChanged: (() -> Void)?
    /// The tabs shown, in the mode bar's order: ⌘` steps through them, ⌘1…⌘4 pick one (Settings is the gear).
    var shownModes: [Mode] { Mode.tabs.filter { !$0.drawnByPage || enabledModes.contains($0) } }
    /// The side Settings returns to when it closes.
    private var beforeSettings: Mode = .crew
    var nextMode: Mode {
        let modes = shownModes
        // From Settings, on from the side it opened over.
        return modes[((modes.firstIndex(of: mode == .settings ? beforeSettings : mode) ?? 0) + 1) % modes.count]
    }
    /// Runs the app's own server when the page is that server's (see `ServerManager`).
    let server: ServerManager?
    private let refusedPort: Bool
    /// When the server was last (re)started for an unreachable page, so a
    /// server that won't come up shows its error rather than looping.
    private var recovered: Date?
    private var splashFallback: DispatchWorkItem?

    init(options: Options) {
        self.options = options
        let local = ["127.0.0.1", "localhost"].contains(options.url.host ?? "")
        // A workspace's build never runs a server on the main checkout's Dev port (see `AppFlavor.isWorkspaceBuild`).
        refusedPort = options.manageServer && local && AppFlavor.isWorkspaceBuild && options.url.port == AppFlavor.port
        server = options.manageServer && local && !refusedPort ? ServerManager() : nil
        let screen = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let size = options.size ?? CGSize(width: min(1440, screen.width - 80), height: min(900, screen.height - 80))
        window = AppWindow(contentRect: CGRect(x: screen.minX + 40, y: screen.maxY - size.height - 40, width: size.width, height: size.height),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = AppFlavor.name
        // No title bar: the mode bar takes its place, the traffic lights at its left.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // An empty toolbar makes the title bar tall enough for the page's name beside the
        // tabs, and centres the traffic lights in it.
        window.toolbar = NSToolbar(identifier: "bar")
        window.toolbarStyle = .unifiedCompact
        // Where the user left it, across launches and app restarts (checks pass --size).
        if options.size == nil {
            window.setFrameUsingName(WorldWindow.frameName)
            window.setFrameAutosaveName(WorldWindow.frameName)
        }
        window.minSize = NSSize(width: 760, height: 520)
        window.isReleasedWhenClosed = false
        window.backgroundColor = .windowBackgroundColor
        let root = NSView(frame: window.contentView!.bounds)
        // The title bar's height, so the traffic lights sit centred in the mode bar.
        let titlebar = window.frame.height - window.contentLayoutRect.height
        barHeight = titlebar > 0 ? titlebar : 30
        modeBar = ModeBar(frame: CGRect(x: 0, y: root.bounds.height - barHeight, width: root.bounds.width, height: barHeight))
        modeBar.autoresizingMask = [.width, .minYMargin]
        // The bar is native, all of it; the page and `content` over it lie below it.
        command = NSView(frame: CGRect(x: 0, y: 0, width: root.bounds.width, height: root.bounds.height - barHeight))
        command.autoresizingMask = [.width, .height]
        splash = SplashView(frame: command.frame)
        splash.autoresizingMask = [.width, .height]
        window.contentView = root
        content = PassThroughView(frame: command.frame)
        content.autoresizingMask = [.width, .height]
        editors = EditorOverlay(font: TerminalFontSettings())
        content.addSubview(editors)
        // An agent's browser, over the box the page draws for it on the board; its other tabs' pages
        // wait under everything, drawn but unseen.
        boardBrowser = BoardBrowser(persistent: options.info == nil)
        content.addSubview(boardBrowser.stage, positioned: .below, relativeTo: editors)
        root.addSubview(boardBrowser.parking)

        let configuration = WKWebViewConfiguration()
        // Check runs (`--info`) keep their page storage to themselves: sharing the
        // user's copy's, a check that quits stops that copy's storage saving to disk.
        configuration.websiteDataStore = options.info == nil ? .default() : .nonPersistent()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // The page draws no top bar of its own: the app's is above it.
        configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.style.setProperty('--app-bar', '0px')",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: command.bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        // The page draws its own background; the window's shows through while it loads.
        web.setValue(false, forKey: "drawsBackground")
        web.isInspectable = true
        // Measurements and checks draw while covered: WebKit stops throttling too.
        let occlusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if WorldWindow.ignoreOcclusion, web.responds(to: occlusion) { web.perform(occlusion, with: false) }
        // The page, then over it `content`: it lets everything through to the page but
        // your editor and the agent's browser. It is the window's, not the page's sibling:
        // views after a web view in its own parent stay off screen until the web view is hidden and shown again.
        command.addSubview(web)
        for v in [command, content, splash, modeBar] { root.addSubview(v) }
        super.init()
        (window as? AppWindow)?.pageRefreshes = { [weak self] in self?.pageRefreshes == true }
        (window as? AppWindow)?.terminalHasKeys = { [weak self] in
            self?.editors.hasKeyFocus == true || self?.boardBrowser.hasKeyFocus == true
        }
        (window as? AppWindow)?.onPalette = { [weak self] in
            guard let self else { return }
            if self.editors.hasKeyFocus { self.editors.openPalette(web: self.web) }
            else { self.window.makeFirstResponder(self.web); self.web.evaluateJavaScript(EditorKeys.paletteScript, completionHandler: nil) }
        }
        configuration.userContentController.add(self, name: "paseoWorld")
        web.navigationDelegate = self
        web.uiDelegate = self
        window.delegate = self
        editors.server = { [weak self] in self?.serverURL ?? options.url }
        editors.tell = { [weak self] in self?.send($0, as: "paseo:editor") }
        editors.runInPage = { [weak self] in self?.web.evaluateJavaScript($0, completionHandler: nil) }
        boardBrowser.server = { [weak self] in self?.serverURL ?? options.url }
        boardBrowser.tell = { [weak self] in self?.send($0, as: "paseo:browser") }
        boardBrowser.pageView = web
        boardBrowser.drawsWhileCovered = WorldWindow.ignoreOcclusion
        modeBar.onSelect = { [weak self] mode in self?.show(mode) }
        modeBar.enabled = enabledModes
        modeBar.onAction = { [weak self] action, view in
            if action == "settings" { self?.toggleSettings() } else { self?.barAction(action, view) }
        }
        placeModeBar()
        // Where the user left it, across launches and app restarts.
        if options.info == nil, let saved = UserDefaults.standard.string(forKey: "mode").flatMap(Mode.init(rawValue:)), saved != .crew {
            DispatchQueue.main.async { self.show(saved) }
        }
        // The old terminal panel's saved state (`terminalOpen`, `terminalDock`, its sizes) is left alone, unread.
        if let server {
            server.confirmHandOver = { [weak self] old, answer in
                guard let self else { return answer(false) }
                self.confirmHandOver(old, answer)
            }
            showSplash("Starting the app server…")
            notice("Starting \(AppFlavor.name)…", "Starting the app server on \(options.url.host ?? ""):\(options.url.port ?? 4310).")
            startServer { [weak self] in self?.splash.say("Loading…"); self?.web.load(URLRequest(url: options.url)) }
        } else if refusedPort {
            Log.line("a workspace build: not running a server on port \(AppFlavor.port)")
            failure("This workspace build leaves port \(AppFlavor.port) alone",
                    "It was built in \(Self.html(AppFlavor.checkout ?? "a workspace")). Port \(AppFlavor.port) is the main checkout’s \(AppFlavor.name)’s" +
                    (AppFlavor.mainCheckout.map { " (\(Self.html($0))/native/build/\(AppFlavor.name).app)" } ?? "") +
                    ". Launch this copy with <code>--url</code> on a port of its own, or <code>--no-server</code>.")
        } else {
            showSplash("Loading…")
            web.load(URLRequest(url: options.url))
        }
    }

    // MARK: Page → Swift

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let sender = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              WebOrigin.matches(scheme: sender.protocol, host: sender.host, port: sender.port, to: options.url) else { return }
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "integrations":
            enabledModes = Set(Mode.tabs.filter { $0.drawnByPage && body[$0.rawValue] as? Bool == true }).union(Mode.alwaysShown)
            modeBar.enabled = enabledModes
            if mode.drawnByPage && !enabledModes.contains(mode) { show(.crew) }
            else if mode != .settings, let saved = UserDefaults.standard.string(forKey: "mode").flatMap(Mode.init(rawValue:)),
                    saved.drawnByPage, enabledModes.contains(saved) { show(saved) }
        default:
            handle(type, body)
        }
    }

    private func handle(_ type: String, _ body: [String: Any]) {
        switch type {
        case "mode":
            // The page asks which side shows (it draws GitHub, Activity and Settings itself, over the map).
            sendMode()
        case "activity":
            // Activity's unread count, for its tab.
            modeBar.activityUnread = max(0, body["unread"] as? Int ?? 0)
        case "update":
            // The page asks for the version and whether updates can be checked for.
            send(Updater.event, as: "paseo:update")
        case "barState":
            // What the top bar's tools show: who needs you, usage, the glance, What's new, the panel's state.
            modeBar.apply(body)
        case "glanceClick":
            // ⌘K opens a glance count's menu: as a click on it, so the page gets where it is.
            if let id = body["id"] as? String { modeBar.clickGlance(id) }
        case "viewport":
            // The page's map area (beside its session panel).
            layoutWorkspace()
            layoutContent()
        case "editor":
            // Your editor's terminal and the pane's frame beside the conversation (or none).
            editors.place(EditorPlacement(body), showing: mode.rawValue, web: web)
        case "editorFocus": if editors.placement.mode == mode.rawValue { editors.focus() }
        case "editorClose": if let request = EditorCloseRequest(body) { editors.close(request, window: window) }
        case "editorForget": editors.forget(body["terminals"] as? [String] ?? [])
        case "browser":
            // The robot's browser (over Crew): whose shows, and the box the page drew for it (or none).
            boardBrowser.place(BrowserPlacement(body), commandShows: mode == .command)
        case "browserDo": boardBrowser.perform(body)
        // Settings → Map: agents' browser tools open and drive tabs here.
        case "browserHost": boardBrowser.setHosting(body["enabled"] as? Bool ?? false)
        case "browserState": boardBrowser.publish()
        case "terminalFont":
            // Settings → Terminal: it asks for the font, the line height and spacing and the installed
            // monospaced families, and sets them (`set`), for every terminal at once.
            if let change = body["set"] as? [String: Any] { setTerminalFont(terminalFont.applying(change, families: TerminalFonts.families())) }
            else { sendTerminalFont(families: true) }
        case "revealFile":
            if let path = body["path"] as? String, path.hasPrefix("/"), !path.hasPrefix("//"),
               !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            }
        case "openLink":
            // A link clicked in the chat (and not taken by the agent's browser): your default browser. A Linear
            // issue opens in Linear's desktop app when it's installed; a GitHub pull request goes to the page for
            // its tab, unless the page sent it `direct`.
            if let text = body["url"] as? String, let url = URL(string: text), url.scheme?.hasPrefix("http") == true {
                if LinearLink.openInApp(url) { break }
                if body["direct"] as? Bool == true || !routeLink(url) { openOutside(url) }
            }
        case "loaded":
            // The page has its first fleet and has drawn it: the splash lifts.
            reveal()
        case "menu":
            // The page's command palette, choosing a View menu item.
            switch body["action"] as? String {
            case "terminal-bigger": zoomTerminals(1)
            case "terminal-smaller": zoomTerminals(-1)
            case "terminal-actual": zoomTerminals(0)
            case "mode-next": show(nextMode)
            case "github": show(.github)
            case "activity": show(.activity)
            case "settings": show(.settings)
            case "settings-close": if mode == .settings { show(beforeSettings) }
            case "crew": show(.crew)
            case "command": show(.command)
            case "reload": (NSApp.delegate as? AppDelegate)?.reloadApp(nil)
            case "check-updates": Updater.shared?.checkNow()
            default: break
            }
        case "log":
            Log.line("page: \(body["text"] as? String ?? "")")
        default: break
        }
    }

    // MARK: Splash

    /// Cover the window while the app (re)loads: at launch, on app restart, and when
    /// the page's process restarts. It lifts once the page has its fleet (`loaded`).
    func showSplash(_ text: String) {
        splash.show(text)
        armSplashFallback(after: 60)
    }

    /// Lift the splash, a moment later so the page's frame is up.
    private func reveal() {
        guard splash.showing else { return }
        splashFallback?.cancel()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.splash.hide() }
    }

    /// Never leave the app covered: a page that loads but never says it has
    /// its fleet (a fault in it, say) is shown as it is.
    private func armSplashFallback(after seconds: Double) {
        splashFallback?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.splash.hide() }
        splashFallback = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    /// The page's top bar spans the window; the rest of the page keeps to `content`, the window's width below the bar.
    private func layoutWorkspace() {
        let height = content.bounds.height
        web.evaluateJavaScript("""
            (() => {
                const root = document.documentElement;
                const width = '\(Int(content.bounds.width))px', height = '\(Int(height))px';
                if (root.style.getPropertyValue('--workspace-width') === width && root.style.getPropertyValue('--workspace-height') === height) return;
                root.dataset.nativeWorkspace = '';
                root.style.setProperty('--workspace-width', width);
                root.style.setProperty('--workspace-height', height);
                window.dispatchEvent(new Event('resize'));
            })()
            """, completionHandler: nil)
    }

    /// Lay your editor and the agent's browser over their boxes again (the page moved, or the window resized).
    private func layoutContent() {
        editors.place(nil, showing: mode.rawValue, web: web)
        boardBrowser.place()
    }

    /// The mode bar's tabs start past the traffic lights, or at the edge in
    /// full screen, where the lights are hidden.
    private func placeModeBar() {
        let lead = WorldWindow.barLead(window, fullScreen: window.styleMask.contains(.fullScreen))
        modeBar.leading = lead
    }

    /// Where the bar's content starts: past the traffic lights, or at the edge in full screen.
    private static func barLead(_ window: NSWindow, fullScreen: Bool) -> CGFloat {
        fullScreen ? 14 : (window.standardWindowButton(.zoomButton)?.frame.maxX ?? 0) + 16
    }

    func windowDidEnterFullScreen(_ notification: Notification) { placeModeBar() }
    func windowDidExitFullScreen(_ notification: Notification) { placeModeBar() }

    func windowDidResize(_ notification: Notification) {
        layoutWorkspace()
        // The page reports its map area's new rectangle; until it does, keep the old one.
        layoutContent()
    }

    // MARK: Swift → page

    func send(_ message: [String: Any], as event: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(event)',{detail:\(json)}))", completionHandler: nil)
    }

    // MARK: Web view

    /// A new page is coming in: the old one's robot browser placement goes with it (the new page says its own).
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        boardBrowser.place(.nothing)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Log.line("page loaded: \(webView.url?.absoluteString ?? "")")
        // The installed version and any update waiting (Settings shows them).
        if WebOrigin.matches(webView.url, to: options.url) { send(Updater.event, as: "paseo:update") }
        if splash.showing, webView.url?.host == options.url.host, webView.url?.port == options.url.port {
            splash.say("Loading the fleet…")
            armSplashFallback(after: 15)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.line("page failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Log.line("page failed to load: \(error.localizedDescription)")
        let url = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? pageURL
        // Our own server stopped: start it again and retry, once a minute at most.
        if server != nil, recovered.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
            recovered = Date()
            showSplash("Starting the app server…")
            notice("Starting \(AppFlavor.name)…", "The app server wasn’t running; starting it again.")
            startServer { [weak self] in self?.splash.say("Loading…"); self?.web.load(URLRequest(url: url)) }
            return
        }
        failure("\(AppFlavor.name) isn’t reachable", "\(options.url.absoluteString) did not answer. " +
            (server == nil ? "Start the app server (<code>npm run app:start</code>) and restart \(AppFlavor.name)." : "Restart \(AppFlavor.name) to try again."))
    }

    /// A plain page in place of the app (starting up, or unreachable).
    private func notice(_ title: String, _ detail: String) {
        let html = "<body style='font:15px -apple-system;color:#f2e1b2;background:#182420;padding:40px'><h2>\(title)</h2><p>\(detail)</p></body>"
        noticing = true
        web.loadHTMLString(html, baseURL: nil)
    }
    /// While a notice is being shown, its `about:blank` loads pass the origin policy.
    private var noticing = false

    /// A notice that something went wrong, shown with the splash lifted.
    private func failure(_ title: String, _ detail: String) {
        splashFallback?.cancel()
        splash.hide()
        notice(title, detail)
    }

    /// The alert offering to stop an old checkout server, while it shows.
    private var handOverAlert: NSAlert?

    /// Offer to stop the old checkout server holding the port; Quit quits.
    private func confirmHandOver(_ old: OldServer, _ answer: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "An older Paseo Command server is running from \(old.checkout.path). Stop it and use this app?"
        alert.informativeText = "Its data is copied into this app’s data folder; the checkout keeps its own."
        alert.addButton(withTitle: "Stop and Continue")
        alert.addButton(withTitle: "Quit")
        handOverAlert = alert
        alert.beginSheetModal(for: window) { [weak self] response in
            self?.handOverAlert = nil
            let accepted = response == .alertFirstButtonReturn
            answer(accepted)
            if !accepted { NSApp.terminate(nil) }
        }
    }

    /// Choose the hand-over alert's default, as Return would (checks).
    func acceptHandOver() {
        handOverAlert?.buttons.first?.performClick(nil)
    }

    private func startServer(_ then: @escaping () -> Void) {
        server?.ensure(port: options.url.port ?? 80) { [weak self] result in
            switch result {
            case .success: then()
            case .failure(let error as BundleHome.Gone):
                self?.bundleGone(error, canStay: false)
            case .failure(let error):
                self?.failure("The app server didn’t start", "<pre style='white-space:pre-wrap'>\(Self.html(error.localizedDescription))</pre>Fix it and restart \(AppFlavor.name).")
            }
        }
    }

    private static func html(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    }

    /// This copy's bundle was deleted or moved: say so and where another copy is, and
    /// offer to open that one (only on the user's click) or quit. Never relaunches into
    /// the missing bundle. `canStay`: this window still works (its server runs on), so
    /// it may stay open; otherwise the page says so too.
    func bundleGone(_ gone: BundleHome.Gone = BundleHome.Gone(app: Bundle.main.bundleURL), canStay: Bool) {
        let other = BundleHome.replacement()
        Log.line("bundle gone: \(gone.app.path); another copy: \(other?.path ?? "none")")
        let elsewhere = other.map { "Open the one at \($0.path)." } ?? (AppFlavor.isRelease
            ? "Download Paseo Command again from github.com/owenconti/paseo-command/releases into /Applications."
            : "Build one with npm run app:update in the main checkout and open its native/build/\(AppFlavor.name).app.")
        if !canStay { failure("This copy of \(AppFlavor.name) is gone", "\(Self.html(gone.localizedDescription)) \(Self.html(elsewhere))") }
        splash.hide()
        let alert = NSAlert()
        alert.messageText = "This copy of \(AppFlavor.name) was deleted or moved."
        alert.informativeText = "It was at \(gone.app.path), so it can’t restart. \(elsewhere)" +
            (canStay ? " This window keeps working until you quit it." : "")
        if let other { alert.addButton(withTitle: "Open \(other.deletingPathExtension().lastPathComponent)"); alert.addButton(withTitle: "Show in Finder") }
        alert.addButton(withTitle: "Quit")
        if canStay { alert.addButton(withTitle: "Not Now") }
        goneAlert = alert
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            self.goneAlert = nil
            let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
            let title = index >= 0 && index < alert.buttons.count ? alert.buttons[index].title : ""
            switch title {
            case "Quit": NSApp.terminate(nil)
            case "Show in Finder": if let other { NSWorkspace.shared.activateFileViewerSelecting([other]) }
                if !canStay { self.bundleGone(gone, canStay: canStay) }
            case "Not Now": break
            default: if let other { self.handOff(to: other) }
            }
        }
    }
    /// The deleted-copy alert, while it shows (checks read and press it).
    private(set) var goneAlert: NSAlert?

    /// Stop our server (the other copy needs the port), open `other` and quit.
    private func handOff(to other: URL) {
        showSplash("Opening \(other.deletingPathExtension().lastPathComponent)…")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.server?.stop()
            DispatchQueue.main.async {
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.createsNewApplicationInstance = true
                NSWorkspace.shared.openApplication(at: other, configuration: configuration) { _, error in
                    DispatchQueue.main.async {
                        if let error {
                            Log.line("opening \(other.path) failed: \(error.localizedDescription)")
                            self?.bundleGone(canStay: false)
                        } else { NSApp.terminate(nil) }
                    }
                }
            }
        }
    }

    /// The web content process ended (crash or memory pressure): load again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.line("web content process ended; reloading")
        showSplash("Loading…")
        webView.load(URLRequest(url: options.url))
    }

    /// Links that open a new window (PRs, issues) go to the default browser: web and
    /// mail links only, never `file:` or another app's URL scheme. A Linear issue opens in
    /// Linear's desktop app.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""),
           !routeLink(url) {
            openOutside(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // A frame's inline document (a visual reply's page) is the page's own content, not a place to go.
        if WebOrigin.inlineFrame(navigationAction.request.url,
                                 mainFrame: navigationAction.targetFrame?.isMainFrame ?? true) {
            return decisionHandler(.allow)
        }
        // The app stays on its own origin (or shows our notice); other links open in the browser.
        let blank = navigationAction.request.url?.absoluteString == "about:blank"
        let notice = noticing && blank
        if !blank { noticing = false }
        if let url = navigationAction.request.url, !notice, !WebOrigin.matches(url, to: options.url) {
            if navigationAction.navigationType == .linkActivated,
               ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""), !routeLink(url) {
                openOutside(url)
            }
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    /// The window as the user sees it, for checks without screen recording:
    /// the page's snapshot with the native views over it, written as a PNG.
    func snapshot(to path: String, app: NSImage? = nil) {
        let bounds = web.bounds
        let whole = window.contentView!.bounds
        let scale = window.backingScaleFactor
        // The splash, while it covers the window.
        var cover: CGImage?
        if splash.showing, let layer = splash.layer,
           let ctx = Textures.context(Int(splash.bounds.width * scale), Int(splash.bounds.height * scale)) {
            ctx.scaleBy(x: scale, y: scale)
            layer.render(in: ctx)
            cover = ctx.makeImage()
        }
        // The mode bar, over the page's top bar but for the page's tools.
        var bar: CGImage?
        if let layer = modeBar.layer,
           let ctx = Textures.context(Int(modeBar.bounds.width * scale), Int(modeBar.bounds.height * scale)) {
            ctx.scaleBy(x: scale, y: scale)
            layer.render(in: ctx)
            bar = ctx.makeImage()
        }
        web.takeSnapshot(with: nil) { [weak self] page, error in
            guard let self else { return }
            let width = Int(whole.width * scale), height = Int(whole.height * scale)
            guard let ctx = Textures.context(width, height) else { return }
            ctx.scaleBy(x: scale, y: scale)
            ctx.setFillColor(self.window.backgroundColor.cgColor)
            ctx.fill(whole)
            // The page's area, from the window's bottom-left origin.
            let left = self.window.contentView!.convert(bounds, from: self.web)
            if let page, let image = page.cgImage(forProposedRect: nil, context: nil, hints: nil) { ctx.draw(image, in: left) }
            if let bar { ctx.draw(bar, in: self.modeBar.frame) }
            if let cover { ctx.draw(cover, in: whole) }
            guard let image = ctx.makeImage(),
                  let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)
            else { return }
            CGImageDestinationAddImage(destination, image, nil)
            CGImageDestinationFinalize(destination)
            Log.line("snapshot \(path)\(error.map { " (\($0))" } ?? "")")
        }
    }

    static let frameName = "PaseoCommand.main"

    /// The app server's root (the page's scheme, host and port).
    var serverURL: URL {
        var c = URLComponents(url: pageURL, resolvingAgainstBaseURL: false)!
        c.path = "/"
        c.query = nil
        c.fragment = nil
        return c.url ?? options.url
    }

    /// Switch the map's place between the map and the pages (⌘` steps through them), which the page
    /// draws over its map; the panels stay.
    func show(_ next: Mode) {
        guard !next.drawnByPage || enabledModes.contains(next) else { return }
        guard next != mode else { return }
        if next == .settings { beforeSettings = mode }
        mode = next
        modeBar.mode = next
        // Your editor shows only in its mode, Command (the page says where once it draws it again).
        editors.place(nil, showing: next.rawValue, web: web)
        // An agent's browser shows only over the map.
        boardBrowser.place(commandShows: next == .command)
        sendMode()
        window.makeFirstResponder(web)
        if options.info == nil { UserDefaults.standard.set(next.rawValue, forKey: "mode") }
    }

    /// Settings, from the app menu (⌘,) or the bar's gear: opens it, or closes it again.
    @objc func toggleSettings() { show(mode == .settings ? beforeSettings : .settings) }

    /// A top bar tool was used: the page opens what it asks for beneath its button
    /// (`paseo:bar`, with the button's rectangle in the page's coordinates).
    private func barAction(_ action: String, _ view: NSView) {
        let button = view.convert(view.bounds, to: nil)
        let page = web.convert(web.bounds, to: nil)
        send(["action": action, "x": button.minX - page.minX, "y": page.maxY - button.maxY,
              "width": button.width, "height": button.height], as: "paseo:bar")
    }

    /// ⌘R is the page's refresh (View → Refresh Page): GitHub or Activity shows and your editor hasn't the keyboard.
    var pageRefreshes: Bool { AppKeys.pageRefreshes(mode, terminalHasKeys: editors.hasKeyFocus) }

    /// Asks the page for one of its commands (`web/src/appCommands.ts`), as its palette does.

    func pageCommand(_ name: String) {
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('paseo:command', { detail: '\(name)' }))", completionHandler: nil)
    }
    /// Tell the page which side shows, so it draws GitHub, Activity or Settings in the map's place.
    private func sendMode() { send(["mode": mode.rawValue], as: "paseo:mode") }

    /// The page's tab a link opens in: a GitHub pull request (`github.com/<owner>/<repo>/pull/<n>…`),
    /// as the page's `parseAppLink` reads it.
    static func pageMode(for url: URL) -> Mode? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host?.lowercased() else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        func matches(_ text: String, _ pattern: String) -> Bool {
            text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if host == "github.com" || host == "www.github.com", parts.count >= 4, parts[2] == "pull",
           matches(parts[0], "^[A-Za-z0-9_.-]{1,100}$"), matches(parts[1], "^[A-Za-z0-9_.-]{1,100}$"),
           matches(parts[3], "^[0-9]{1,9}$") { return .github }
        return nil
    }

    /// Opens a link elsewhere: a Linear issue in Linear's desktop app (`LinearLink`), or hands a GitHub
    /// pull request's link to the page, which opens it in its tab; false when it's another link (or
    /// the GitHub tab is off).
    func routeLink(_ url: URL) -> Bool {
        if LinearLink.openInApp(url) { return true }
        guard let mode = Self.pageMode(for: url), enabledModes.contains(mode) else { return false }
        send(["url": url.absoluteString], as: "paseo:link")
        return true
    }

    /// A link the page opens outside: your default browser (a check run only notes it, `openedOutside`).
    private func openOutside(_ url: URL) {
        if options.info != nil { openedOutside.append(url); return }
        NSWorkspace.shared.open(url)
    }
    /// The links a check run would have opened in the default browser.
    private(set) var openedOutside: [URL] = []

    /// A link, as the chat's open (checks): Linear's app, the GitHub tab, else the default browser.
    func openLink(_ url: URL) {
        if !routeLink(url) { openOutside(url) }
    }

    /// Your editor's text size (⌘+, ⌘−, ⌘0 while it has the keyboard).
    func zoomTerminals(_ step: CGFloat) {
        var next = terminalFont
        next.size = step == 0 ? TerminalFontSettings.defaultSize
            : min(TerminalFontSettings.sizes.upperBound, max(TerminalFontSettings.sizes.lowerBound, terminalFont.size + step))
        setTerminalFont(next)
    }

    /// The terminals' font (Settings → Terminal), kept and applied to your editor at once.
    func setTerminalFont(_ font: TerminalFontSettings) {
        terminalFont = font
        font.save()
        editors.setFont(font)
        sendTerminalFont()
    }

    /// Tell the page the terminals' font (`paseo:terminal-font`), with the installed monospaced families when asked.
    func sendTerminalFont(families: Bool = false) {
        var message = terminalFont.json
        message["defaults"] = TerminalFontSettings.standard.json
        message["ranges"] = ["size": [TerminalFontSettings.sizes.lowerBound, TerminalFontSettings.sizes.upperBound],
                             "lineHeight": [0, TerminalFontSettings.maxLineHeight],
                             "letterSpacing": [TerminalFontSettings.letterSpacings.lowerBound, TerminalFontSettings.letterSpacings.upperBound]]
        if families { message["families"] = TerminalFonts.families() }
        send(message, as: "paseo:terminal-font")
    }

    /// The app page the window is on (its query keeps the panel's place), or
    /// the app's own address if it is showing the "isn't reachable" notice.
    var pageURL: URL {
        if let url = web.url, url.host == options.url.host, url.port == options.url.port { return url }
        return options.url
    }

    func reload() {
        let url = pageURL
        let showing = web.url?.host == options.url.host && web.url?.port == options.url.port
        let load: () -> Void = { [weak self] in if showing { self?.web.reload() } else { self?.web.load(URLRequest(url: url)) } }
        guard server != nil else { return load() }
        // Our server comes first (it may have been stopped for a restart); a reload
        // after it failed tries it again.
        if !showing {
            recovered = nil
            splash.say("Starting the app server…")
            notice("Starting \(AppFlavor.name)…", "Starting the app server.")
        }
        startServer { [weak self] in self?.splash.say("Loading…"); load() }
    }

    /// Processes that do this window's work: the app, and WebKit's content and GPU processes.
    func processes() -> [String: Int] {
        var result = ["app": Int(ProcessInfo.processInfo.processIdentifier)]
        for (name, key) in [("webContent", "_webProcessIdentifier"), ("gpu", "_gpuProcessIdentifier"), ("network", "_networkProcessIdentifier")] {
            if web.responds(to: NSSelectorFromString(key)), let pid = web.value(forKey: key) as? Int, pid > 0 { result[name] = pid }
        }
        return result
    }
}

/// A view that takes no events of its own: those reach what lies under it.
final class PassThroughView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}
