import AppKit
import ImageIO
import SpriteKit
import WebKit

/// One window: the SpriteKit Atlas, and over it the React app in a
/// transparent web view. The page keeps every pointer and key event: its
/// toolbar, legend, tooltips and panels take theirs as in a browser, and the
/// map surface forwards its own to Swift (see `rendering/src/native/bridge.ts`).
/// No hit regions need syncing, and the page keeps focus and its shortcuts.
final class WorldWindow: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let window: NSWindow
    let web: WKWebView
    let split: PanelSplitView
    let drawer: TerminalDrawer
    /// The map and page: the split's first side, and where the maximized terminal panel goes.
    let content: NSView
    /// Covers the window until the map has drawn (see `revealWhenDrawn`).
    let splash: SplashView
    /// The strip across the top that switches between Command, Conquer, Linear, Slack and Activity.
    let modeBar: ModeBar
    /// Command: the map, the page over it, the split over that and its splash, under the mode bar.
    let command: NSView
    /// The mode bar's height: the page's own top bar, whose tools show at its right end.
    let barHeight: CGFloat
    /// Conquer: the browser, in the map's place while it shows.
    let conquer: ConquerView
    private(set) var mode: Mode = .command
    let atlasView: AtlasView
    let scene: AtlasScene
    let options: Options
    /// The page's tabs whose integration is on (the page says, with `integrations`).
    private(set) var enabledModes: Set<Mode> = []
    /// The tabs ⌘` steps through, in the mode bar's order.
    var shownModes: [Mode] { Mode.allCases.filter { !$0.drawnByPage || enabledModes.contains($0) } }
    var nextMode: Mode {
        let modes = shownModes
        return modes[((modes.firstIndex(of: mode) ?? 0) + 1) % modes.count]
    }
    /// Bridge messages decode their images here, in order, then apply on main.
    private let decoding = DispatchQueue(label: "paseo.world.decode", qos: .userInitiated)
    /// Runs the app's own server when the page is that server's (see `ServerManager`).
    let server: ServerManager?
    /// When the server was last (re)started for an unreachable page, so a
    /// server that won't come up shows its error rather than looping.
    private var recovered: Date?
    /// The page's map rectangle, in its CSS pixels (top-left origin).
    private var viewport: CGRect?
    /// While the splash shows: whether the page has its fleet, and the scene
    /// builds there were when it went up (the map is drawn once one more lands).
    private var fleetLoaded = false
    private var buildsAtSplash = 0
    private var splashFallback: DispatchWorkItem?

    init(options: Options) {
        self.options = options
        let local = ["127.0.0.1", "localhost"].contains(options.url.host ?? "")
        server = options.manageServer && local ? ServerManager() : nil
        let screen = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let size = options.size ?? CGSize(width: min(1440, screen.width - 80), height: min(900, screen.height - 80))
        window = NSWindow(contentRect: CGRect(x: screen.minX + 40, y: screen.maxY - size.height - 40, width: size.width, height: size.height),
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
        window.backgroundColor = Textures.color(0x1d6884)
        // The map and page on the left (or above); the terminal panel on the right (or below),
        // collapsed until asked for.
        split = PanelSplitView(frame: window.contentView!.bounds)
        let dock = TerminalDock(rawValue: UserDefaults.standard.string(forKey: "terminalDock") ?? "") ?? .right
        split.isVertical = dock == .right
        split.dividerStyle = .thin
        split.autoresizingMask = [.width, .height]
        let root = NSView(frame: split.frame)
        // The title bar's height, so the traffic lights sit centred in the mode bar.
        let titlebar = window.frame.height - window.contentLayoutRect.height
        barHeight = titlebar > 0 ? titlebar : 30
        modeBar = ModeBar(frame: CGRect(x: 0, y: root.bounds.height - barHeight, width: root.bounds.width, height: barHeight))
        modeBar.autoresizingMask = [.width, .minYMargin]
        // The page reaches the window's top, under the mode bar, and draws its tools at the
        // bar's right end. The split (the page's place beside the terminal panel) lies below
        // the bar and over the page, so the panel is never under the page.
        command = NSView(frame: root.bounds)
        command.autoresizingMask = [.width, .height]
        split.frame = CGRect(x: 0, y: 0, width: command.bounds.width, height: command.bounds.height - barHeight)
        splash = SplashView(frame: command.bounds)
        splash.autoresizingMask = [.width, .height]
        conquer = ConquerView(frame: command.frame, persistent: options.info == nil)
        conquer.isHidden = true
        window.contentView = root
        content = PassThroughView(frame: split.bounds)
        content.autoresizingMask = [.width, .height]
        drawer = TerminalDrawer(frame: CGRect(x: 0, y: 0, width: 460, height: split.bounds.height))
        split.addArrangedSubview(content)
        split.setHoldingPriority(.defaultLow, forSubviewAt: 0)
        // The panel joins the split only while it shows (see `attachDrawer`).
        drawer.isHidden = true
        drawer.dock = dock
        drawer.barInset = 0

        scene = AtlasScene(size: content.bounds.size)
        atlasView = AtlasView(frame: content.bounds, scene: scene)
        atlasView.autoresizingMask = []
        command.addSubview(atlasView)

        let configuration = WKWebViewConfiguration()
        // Check runs (`--info`) keep their page storage to themselves: sharing the
        // user's copy's, a check that quits stops that copy's storage saving to disk.
        configuration.websiteDataStore = options.info == nil ? .default() : .nonPersistent()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // The mode bar's height, which the page leaves as its own top bar.
        configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.style.setProperty('--app-bar', '\(Int(barHeight))px')" +
                ";document.documentElement.style.setProperty('--app-bar-lead', '\(Int(WorldWindow.barLead(window, fullScreen: false)))px')",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: command.bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        // The page is transparent where the map is; SpriteKit shows through.
        web.setValue(false, forKey: "drawsBackground")
        web.isInspectable = true
        // Measurements and checks draw while covered: WebKit stops throttling too.
        let occlusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if AtlasView.ignoreOcclusion, web.responds(to: occlusion) { web.perform(occlusion, with: false) }
        // Map and page, then over them the split: its page side lets everything through
        // to the page but Conquer and the maximized panel; the panel beside it is its own.
        // The split is the window's, not the page's sibling: views after a web view in its
        // own parent stay off screen until the web view is hidden and shown again.
        command.addSubview(web)
        for v in [command, split, splash, modeBar] { root.addSubview(v) }
        super.init()
        split.onResize = { [weak self] in self?.layoutWorkspace() }
        conquer.onTogglePanel = { [weak self] in
            self?.web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('paseo:command', { detail: 'toggle-panel' }))", completionHandler: nil)
        }
        conquer.onLink = { [weak self] url in self?.routeLink(url) ?? false }
        configuration.userContentController.add(self, name: "paseoWorld")
        web.navigationDelegate = self
        web.uiDelegate = self
        window.delegate = self
        scene.emit = { [weak self] message in self?.send(message) }
        drawer.server = { [weak self] in self?.serverURL ?? options.url }
        drawer.onMove = { [weak self] in self?.moveTerminal() }
        drawer.onMaximize = { [weak self] in self?.maximizeTerminal() }
        modeBar.onSelect = { [weak self] mode in self?.show(mode) }
        placeModeBar()
        // Where the user left it, across launches and app restarts.
        if options.info == nil, let saved = UserDefaults.standard.string(forKey: "mode").flatMap(Mode.init(rawValue:)), saved != .command {
            DispatchQueue.main.async { self.show(saved) }
        }
        if UserDefaults.standard.bool(forKey: "terminalOpen") { DispatchQueue.main.async { self.setTerminal(open: true, newTab: false) } }
        if let server {
            server.confirmHandOver = { [weak self] old, answer in
                guard let self else { return answer(false) }
                self.confirmHandOver(old, answer)
            }
            showSplash("Starting the app server…")
            notice("Starting \(AppFlavor.name)…", "Starting the app server on \(options.url.host ?? ""):\(options.url.port ?? 4310).")
            startServer { [weak self] in self?.splash.say("Loading…"); self?.web.load(URLRequest(url: options.url)) }
        } else {
            showSplash("Loading…")
            web.load(URLRequest(url: options.url))
        }
        // Checks read the scene's state from the page; keep it current.
        if options.checks {
            Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.reportState() }
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
            enabledModes = Set(Mode.allCases.filter { $0.drawnByPage && body[$0.rawValue] as? Bool == true })
            modeBar.enabled = enabledModes
            if mode.drawnByPage && !enabledModes.contains(mode) { show(.command) }
            else if let saved = UserDefaults.standard.string(forKey: "mode").flatMap(Mode.init(rawValue:)),
                    saved.drawnByPage, enabledModes.contains(saved) { show(saved) }
        case "art":
            decoding.async { [weak self] in
                var frames: [String: CGImage] = [:]
                for f in body["frames"] as? [[String: Any]] ?? [] {
                    if let name = f["name"] as? String, let png = f["png"] as? String, let image = Textures.image(dataURL: png) { frames[name] = image }
                }
                var tiles: [String: CGImage] = [:]
                for (name, png) in body["tiles"] as? [String: String] ?? [:] { tiles[name] = Textures.image(dataURL: png) }
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.scene.setArt(frames: frames, tiles: tiles, constants: body["constants"] as? [String: Any] ?? [:],
                                      reduced: body["reduced"] as? Bool ?? false)
                    self.layoutAtlas()
                }
            }
        case "scene":
            decoding.async { [weak self] in
                var images: [String: CGImage] = [:]
                for list in ["pieces", "banners", "streamers"] {
                    for item in body[list] as? [[String: Any]] ?? [] {
                        if let key = item["key"] as? String, let png = item["png"] as? String, let image = Textures.image(dataURL: png) { images[key] = image }
                    }
                }
                DispatchQueue.main.async { self?.scene.setScene(body, images: images); self?.reportState(); self?.revealWhenDrawn() }
            }
        case "agents":
            decoding.async { DispatchQueue.main.async { [weak self] in self?.scene.setAgents(body); self?.reportState() } }
        default:
            // Everything else is cheap and keeps its order behind any pending decode.
            decoding.async { DispatchQueue.main.async { [weak self] in self?.handle(type, body) } }
        }
    }

    private func handle(_ type: String, _ body: [String: Any]) {
        let point = CGPoint(x: body["x"] as? Double ?? 0, y: body["y"] as? Double ?? 0)
        switch type {
        case "mode":
            // The page asks which side shows (it draws Linear, Slack and Activity itself, over the map).
            sendMode()
        case "activity":
            // Activity's unread count, for its tab.
            modeBar.activityUnread = max(0, body["unread"] as? Int ?? 0)
        case "update":
            // The page asks for the version and whether updates can be checked for.
            send(Updater.event, as: "paseo:update")
        case "appBar":
            // Where the page draws its tools in the top bar, in its own coordinates.
            let rect = CGRect(x: body["x"] as? Double ?? 0, y: body["y"] as? Double ?? 0,
                              width: body["width"] as? Double ?? 0, height: body["height"] as? Double ?? 0)
            modeBar.tools = rect.isEmpty ? .zero : modeBar.convert(rect, from: web)
            let title = CGRect(x: body["titleX"] as? Double ?? 0, y: body["titleY"] as? Double ?? 0,
                               width: body["titleWidth"] as? Double ?? 0, height: body["titleHeight"] as? Double ?? 0)
            modeBar.title = title.isEmpty ? .zero : modeBar.convert(title, from: web)
        case "viewport":
            layoutWorkspace()
            viewport = CGRect(x: body["x"] as? Double ?? 0, y: body["y"] as? Double ?? 0,
                              width: body["width"] as? Double ?? 0, height: body["height"] as? Double ?? 0)
            layoutAtlas()
        case "pointer": scene.pointer(phase: body["phase"] as? String ?? "", at: point)
        case "wheel": scene.wheel(at: point, dy: CGFloat(body["dy"] as? Double ?? 0))
        case "pinch": scene.pinch(at: point, scale: CGFloat(body["scale"] as? Double ?? 1))
        case "key": scene.key(body["key"] as? String ?? "", down: body["down"] as? Bool ?? false)
        case "select": scene.select(body["id"] as? String)
        case "focus": if let id = body["id"] as? String { scene.focus(id, closer: body["zoom"] as? Bool ?? false) }
        case "command": scene.command(body["name"] as? String ?? "")
        case "input": scene.setInput(body["enabled"] as? Bool ?? true)
        case "motion": scene.setMotion(reduced: body["reduced"] as? Bool ?? false)
        case "workspace":
            let w = body["workspace"] as? [String: Any]
            let selected = w.flatMap { w in
                (w["id"] as? String).map { TerminalWorkspace(id: $0, host: w["host"] as? String ?? "", name: w["name"] as? String ?? $0) }
            }
            drawer.show(selected)
        case "openLink":
            // A link clicked in the chat: a new Conquer tab, in the map's place.
            // A Linear issue or Slack message goes to the page for its tab, unless the page sent it `direct`.
            if let text = body["url"] as? String, let url = URL(string: text), url.scheme?.hasPrefix("http") == true {
                if body["direct"] as? Bool == true || !routeLink(url) { openInApp(url) }
            }
        case "external":
            // "Open in Linear": the default browser, never the app's own tabs.
            if let text = body["url"] as? String, let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
        case "loaded":
            // The page has its first fleet and has handed it to the world.
            fleetLoaded = true
            splash.say("Drawing the map…")
            revealWhenDrawn()
        case "menu":
            // The page's command palette, choosing a View menu item.
            switch body["action"] as? String {
            case "terminal": toggleTerminal()
            case "terminal-dock": moveTerminal()
            case "terminal-maximize": maximizeTerminal()
            case "terminal-unsplit": drawer.unsplit()
            case "terminal-bigger": drawer.zoom(1)
            case "terminal-smaller": drawer.zoom(-1)
            case "terminal-actual": drawer.zoom(0)
            case "conquer": show(.conquer)
            case "mode-next": show(nextMode)
            case "linear": show(.linear)
            case "slack": show(.slack)
            case "activity": show(.activity)
            case "command": show(.command)
            case "conquer-tab": show(.conquer); conquer.whenStarted { [weak self] in self?.conquer.newTab() }
            case "conquer-sidebar": show(.conquer); conquer.perform("toggleSidebar")
            case "conquer-reload": if mode == .conquer { conquer.perform("reload") }
            case "conquer-reload-without-cache": if mode == .conquer { conquer.perform("reloadWithoutCache") }
            case "zen-cookies": conquer.perform("importCookies")
            case "reload": (NSApp.delegate as? AppDelegate)?.reloadApp(nil)
            case "check-updates": Updater.shared?.checkNow()
            default: break
            }
        case "detach":
            // The page unmounted its world (it is reloading or navigating).
            atlasView.isHidden = true
            atlasView.isPaused = true
        default: break
        }
        if type != "detach", atlasView.isHidden, scene.hasArt { atlasView.isHidden = false; atlasView.govern() }
        if AtlasScene.debug { Log.line("\(type) \(body)") }
        if type != "pointer" && type != "wheel" { reportState() }
    }

    // MARK: Splash

    /// Cover the window while the app (re)loads: at launch, on app restart, and when
    /// the page's process restarts. It lifts once the map has drawn.
    func showSplash(_ text: String) {
        fleetLoaded = false
        buildsAtSplash = scene.builds
        splash.show(text)
        armSplashFallback(after: 60)
    }

    /// Lift the splash once the page has its fleet and the world has drawn a
    /// scene since the splash went up, a moment later so SpriteKit's frame is up.
    private func revealWhenDrawn() {
        guard splash.showing, fleetLoaded, scene.hasArt, scene.builds > buildsAtSplash else { return }
        splashFallback?.cancel()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.splash.hide() }
    }

    /// Never leave the app covered: a page that loads but never reports its
    /// map (a fault in the world, say) is shown as it is.
    private func armSplashFallback(after seconds: Double) {
        splashFallback?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.splash.hide() }
        splashFallback = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    /// The page's top bar spans the window; the rest of the page keeps to the split's page side.
    private func layoutWorkspace() {
        let height = content.bounds.height + barHeight
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

    /// The map's rectangle in the split's page side, where Conquer and the maximized panel go.
    private var mapInContent: CGRect {
        viewport == nil ? content.bounds : content.convert(atlasView.frame, from: command)
    }

    /// Lay the SpriteKit view exactly under the page's map surface.
    private func layoutAtlas() {
        guard let viewport, viewport.width > 0, viewport.height > 0 else { return }
        let webRect = web.isFlipped ? viewport : CGRect(x: viewport.minX, y: web.bounds.height - viewport.maxY, width: viewport.width, height: viewport.height)
        let frame = command.convert(webRect, from: web)
        let resized = atlasView.frame.size != frame.size
        atlasView.frame = frame
        atlasView.isHidden = !scene.hasArt
        if resized {
            atlasView.resized()
            scene.size = frame.size
            scene.viewportChanged()
        }
        atlasView.govern()
        if mode == .conquer { conquer.frame = mapInContent }
        placeMaximized()
    }

    /// The mode bar's tabs start past the traffic lights, or at the edge in
    /// full screen, where the lights are hidden.
    private func placeModeBar() {
        let lead = WorldWindow.barLead(window, fullScreen: window.styleMask.contains(.fullScreen))
        modeBar.leading = lead
        // The page draws the product's name there, and the tabs follow it.
        web.evaluateJavaScript("document.documentElement.style.setProperty('--app-bar-lead', '\(Int(lead))px')", completionHandler: nil)
    }

    /// Where the bar's content starts: past the traffic lights, or at the edge in full screen.
    private static func barLead(_ window: NSWindow, fullScreen: Bool) -> CGFloat {
        fullScreen ? 14 : (window.standardWindowButton(.zoomButton)?.frame.maxX ?? 0) + 16
    }

    func windowDidEnterFullScreen(_ notification: Notification) { placeModeBar() }
    func windowDidExitFullScreen(_ notification: Notification) { placeModeBar() }

    func windowDidResize(_ notification: Notification) {
        // The page reports its map's new rectangle; until it does, keep the old one.
        layoutAtlas()
    }

    // MARK: Swift → page

    func send(_ message: [String: Any], as event: String = "paseo:world") {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(event)',{detail:\(json)}))", completionHandler: nil)
    }

    private var stateTimer: Timer?
    /// The scene's own account, for the page's `inspect()` (tests and checks).
    private func reportState() {
        guard stateTimer == nil else { return }
        stateTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.stateTimer = nil
            self.send(["type": "state", "state": self.scene.state()])
        }
    }

    /// A scripted drag across the map (for measurements): pointer events on
    /// the map surface, as a hand would make them, for `seconds`.
    func scriptedPan(seconds: Double) {
        let js = """
        (() => {
          const surface = document.querySelector('.atlas-world-surface');
          if (!surface) return 'no map';
          const target = surface;
          const r = target.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const send = (type, x, y, buttons) =>
            target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          send('pointerdown', cx, cy, 1);
          const start = performance.now();
          const step = (now) => {
            const t = (now - start) / 1000;
            const x = cx + Math.sin(t * Math.PI) * 220, y = cy + Math.sin(t * Math.PI * 0.7) * 140;
            if (t < \(seconds)) { send('pointermove', x, y, 1); requestAnimationFrame(step); }
            else send('pointerup', x, y, 0);
          };
          requestAnimationFrame(step);
          return 'panning';
        })()
        """
        web.evaluateJavaScript(js) { result, error in
            Log.line("scripted pan: \(result ?? "") \(error.map { "\($0)" } ?? "")")
        }
    }

    // MARK: Web view

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
            case .failure(let error):
                let text = error.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
                self?.failure("The app server didn’t start", "<pre style='white-space:pre-wrap'>\(text)</pre>Fix it and restart \(AppFlavor.name).")
            }
        }
    }

    /// The web content process ended (crash or memory pressure): load again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.line("web content process ended; reloading")
        showSplash("Loading…")
        atlasView.isHidden = true
        webView.load(URLRequest(url: options.url))
    }

    /// Links that open a new window (PRs, issues) go to the default browser: web and
    /// mail links only, never `file:` or another app's URL scheme.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""),
           !routeLink(url) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // The app stays on its own origin (or shows our notice); other links open in the browser.
        let blank = navigationAction.request.url?.absoluteString == "about:blank"
        let notice = noticing && blank
        if !blank { noticing = false }
        if let url = navigationAction.request.url, !notice, !WebOrigin.matches(url, to: options.url) {
            if navigationAction.navigationType == .linkActivated,
               ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""), !routeLink(url) {
                NSWorkspace.shared.open(url)
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
    /// SpriteKit's world under the page's snapshot, written as a PNG.
    func snapshot(to path: String, app: NSImage? = nil) {
        // Conquer's page first, when it covers the map.
        if mode == .conquer, app == nil, let page = conquer.current?.web {
            return page.takeSnapshot(with: nil) { [weak self] shot, _ in self?.snapshot(to: path, app: shot ?? NSImage()) }
        }
        // Its tab strip and page bar are layers; the page goes over them.
        var appChrome: CGImage?
        if mode == .conquer, let layer = conquer.layer,
           let ctx = Textures.context(Int(conquer.bounds.width * window.backingScaleFactor), Int(conquer.bounds.height * window.backingScaleFactor)) {
            ctx.scaleBy(x: window.backingScaleFactor, y: window.backingScaleFactor)
            layer.render(in: ctx)
            appChrome = ctx.makeImage()
        }
        let bounds = web.bounds
        let whole = window.contentView!.bounds
        let scale = window.backingScaleFactor
        // The terminal panel is layer-backed: its layer tree draws it.
        var terminal: CGImage?
        if !drawer.isHidden, let layer = drawer.layer,
           let ctx = Textures.context(Int(drawer.bounds.width * scale), Int(drawer.bounds.height * scale)) {
            ctx.scaleBy(x: scale, y: scale)
            if drawer.isFlipped {
                ctx.translateBy(x: 0, y: drawer.bounds.height)
                ctx.scaleBy(x: 1, y: -1)
            }
            layer.render(in: ctx)
            terminal = ctx.makeImage()
        }
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
        var world: CGImage?
        if !atlasView.isHidden, let texture = atlasView.texture(from: scene) { world = texture.cgImage() }
        web.takeSnapshot(with: nil) { [weak self] page, error in
            guard let self else { return }
            let width = Int(whole.width * scale), height = Int(whole.height * scale)
            guard let ctx = Textures.context(width, height) else { return }
            ctx.scaleBy(x: scale, y: scale)
            ctx.setFillColor(Textures.color(0x1d6884).cgColor)
            ctx.fill(whole)
            // The page's area, from the split's bottom-left origin (it is flipped).
            let left = self.window.contentView!.convert(bounds, from: self.web)
            if let world { ctx.draw(world, in: self.window.contentView!.convert(self.atlasView.bounds, from: self.atlasView)) }
            if let page, let image = page.cgImage(forProposedRect: nil, context: nil, hints: nil) { ctx.draw(image, in: left) }
            if self.mode == .conquer {
                let inContent = { (v: NSView) in self.window.contentView!.convert(v.bounds, from: v) }
                if let appChrome { ctx.draw(appChrome, in: inContent(self.conquer)) }
                if let page = self.conquer.current?.web, let image = app?.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                    ctx.draw(image, in: inContent(page))
                }
            }
            if let terminal {
                // Beside the page in the split, or over its map when maximized.
                let r = self.window.contentView!.convert(self.drawer.bounds, from: self.drawer)
                ctx.draw(terminal, in: r)
            }
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

    /// Switch the map's place between the map, the browser and Linear (⌘` steps through them),
    /// which the page draws over its map; the panels and terminal stay, and ⌘B (the page's
    /// panel toggle) gives the browser the width.
    /// The side not shown keeps running: the map's page and Conquer's tabs stay live.
    func show(_ next: Mode) {
        guard !next.drawnByPage || enabledModes.contains(next) else { return }
        guard next != mode else { return }
        mode = next
        modeBar.mode = next
        atlasView.covered = next != .command
        placeConquer()
        sendMode()
        if next == .conquer {
            conquer.start()
            conquer.focusPage()
        } else {
            window.makeFirstResponder(web)
        }
        if options.info == nil { UserDefaults.standard.set(next.rawValue, forKey: "mode") }
    }

    /// Tell the page which side shows, so it draws Linear, Slack or Activity in the map's place.
    private func sendMode() { send(["mode": mode.rawValue], as: "paseo:mode") }

    /// Open `url` in a new Conquer tab (a link from the chat), in the map's
    /// place, once its tabs and cookies are in.
    /// The page's tab a link opens in: a Linear issue (`linear.app/<workspace>/issue/<KEY>`) or a Slack
    /// conversation or message (`<team>.slack.com/archives/<id>…`), as the page's `parseAppLink` reads them.
    static func pageMode(for url: URL) -> Mode? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host?.lowercased() else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        func matches(_ text: String, _ pattern: String) -> Bool {
            text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if host == "linear.app", parts.count >= 3, parts[1] == "issue", matches(parts[2], "^[a-z][a-z0-9]{0,9}-[0-9]{1,6}$") { return .linear }
        if host.hasSuffix(".slack.com"), parts.count >= 2, parts[0] == "archives",
           parts[1].range(of: "^[CDG][A-Z0-9]{1,30}$", options: .regularExpression) != nil { return .slack }
        return nil
    }

    /// Hands a Linear issue's or Slack message's link to the page, which opens it in that tab
    /// (or back in Conquer when it isn't the workspace's); false when that tab is off or it's another link.
    func routeLink(_ url: URL) -> Bool {
        guard let mode = Self.pageMode(for: url), enabledModes.contains(mode) else { return false }
        send(["url": url.absoluteString], as: "paseo:link")
        return true
    }

    func openInApp(_ url: URL) {
        show(.conquer)
        conquer.whenStarted { [weak self] in self?.conquer.open(url) }
    }

    /// Conquer stands exactly over the map (it follows the map as the page lays out).
    private func placeConquer() {
        if conquer.superview !== content {
            conquer.removeFromSuperview()
            content.addSubview(conquer)
        }
        conquer.autoresizingMask = []
        conquer.frame = mapInContent
        conquer.isHidden = mode != .conquer
    }

    /// Show or hide the terminal panel (View → Terminal, ⌃`), at the size it last had;
    /// opened so, it starts a terminal in the selected workspace if it has none.
    @objc func toggleTerminal() { setTerminal(open: drawer.isHidden, newTab: true) }

    func setTerminal(open: Bool, newTab: Bool) {
        guard open == drawer.isHidden else { return }
        if open {
            drawer.isHidden = false
            attachDrawer()
            placeTerminal()
            drawer.setActive(true)
            if newTab { drawer.opened() } else { drawer.focusTerminal() }
        } else {
            setMaximized(false)
            saveTerminalSize()
            drawer.setActive(false)
            drawer.isHidden = true
            detachDrawer()
            window.makeFirstResponder(web)
        }
        UserDefaults.standard.set(open, forKey: "terminalOpen")
    }

    /// Cover the map with the terminal panel, or return it beside the map
    /// (View → Maximize Terminal, ⇧⌘↩). The page's panels stay in view.
    @objc func maximizeTerminal() {
        if drawer.isHidden { setTerminal(open: true, newTab: false) }
        setMaximized(!drawer.maximized)
    }

    private func setMaximized(_ on: Bool) {
        guard on != drawer.maximized else { return }
        if on {
            saveTerminalSize()
            detachDrawer()
            drawer.maximized = true
            content.addSubview(drawer)
            placeMaximized()
        } else {
            drawer.maximized = false
            attachDrawer()
            placeTerminal()
        }
        drawer.focusTerminal()
        window.invalidateCursorRects(for: split)
    }

    /// Put the panel in the split, beside or under the page. Out of it (closed or
    /// maximized) the split has no divider: hidden in it, the panel left the
    /// divider's layer drawn over the map where its edge had been.
    private func attachDrawer() {
        guard drawer.superview !== split else { return }
        drawer.removeFromSuperview()
        split.addArrangedSubview(drawer)
        split.setHoldingPriority(.defaultHigh, forSubviewAt: 1)
        layoutWorkspace()
    }

    private func detachDrawer() {
        guard let parent = drawer.superview else { return }
        if parent === split { split.removeArrangedSubview(drawer) }
        drawer.removeFromSuperview()
        split.adjustSubviews()
        // The page's side may not have changed size in the split's eyes: say so anyway.
        layoutWorkspace()
    }

    /// The maximized panel lies exactly over the page's map (it follows the map as the page lays out).
    private func placeMaximized() {
        guard drawer.maximized else { return }
        drawer.frame = mapInContent
    }

    /// The panel's key for its saved size along the split: width on the right, height at the bottom.
    private var terminalSizeKey: String { drawer.dock == .right ? "terminalWidth" : "terminalHeight" }

    private func saveTerminalSize() {
        guard !drawer.maximized else { return }
        UserDefaults.standard.set(drawer.dock == .right ? drawer.frame.width : drawer.frame.height, forKey: terminalSizeKey)
    }

    /// Set the open panel at its saved size for its dock.
    private func placeTerminal() {
        let right = drawer.dock == .right
        let length = right ? split.bounds.width : split.bounds.height
        let saved = UserDefaults.standard.double(forKey: terminalSizeKey).nonZero ?? (right ? 460 : 280)
        let size = max(split.minPanel, min(saved, length - split.minPage))
        split.adjustSubviews()
        split.setPosition(length - size - split.dividerThickness, ofDividerAt: 0)
    }

    /// Move the terminal panel between the right side and the bottom (View → Terminal at Bottom).
    @objc func moveTerminal() {
        setMaximized(false)
        if !drawer.isHidden { saveTerminalSize() }
        drawer.dock = drawer.dock == .right ? .bottom : .right
        UserDefaults.standard.set(drawer.dock.rawValue, forKey: "terminalDock")
        split.isVertical = drawer.dock == .right
        if drawer.isHidden { setTerminal(open: true, newTab: false) } else { placeTerminal(); drawer.focusTerminal() }
        window.invalidateCursorRects(for: split)
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

    /// Processes that do this window's work, for measurements: the app (and
    /// SpriteKit in it), and WebKit's content and GPU processes.
    func processes() -> [String: Int] {
        var result = ["app": Int(ProcessInfo.processInfo.processIdentifier)]
        for (name, key) in [("webContent", "_webProcessIdentifier"), ("gpu", "_gpuProcessIdentifier"), ("network", "_networkProcessIdentifier")] {
            if web.responds(to: NSSelectorFromString(key)), let pid = web.value(forKey: key) as? Int, pid > 0 { result[name] = pid }
        }
        return result
    }
}

private extension Double {
    var nonZero: Double? { self == 0 ? nil : self }
}

/// The window's split: the page beside the terminal panel. Its thin divider is
/// grabbed a few points either side, ahead of the web view under it, and
/// keeps both sides usable.
final class PanelSplitView: NSSplitView, NSSplitViewDelegate {
    /// The smallest panel and page along the split: widths beside each other, heights stacked.
    var minPanel: CGFloat { isVertical ? 280 : 140 }
    var minPage: CGFloat { isVertical ? 480 : 240 }
    var onResize: (() -> Void)?
    private static let grab: CGFloat = 4

    override init(frame: NSRect) {
        super.init(frame: frame)
        delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var handle: CGRect? {
        guard subviews.count > 1, !subviews[1].isHidden else { return nil }
        if !isVertical {
            let y = subviews[0].frame.maxY
            return CGRect(x: 0, y: y - Self.grab, width: bounds.width, height: dividerThickness + Self.grab * 2)
        }
        let x = subviews[0].frame.maxX
        return CGRect(x: x - Self.grab, y: 0, width: dividerThickness + Self.grab * 2, height: bounds.height)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        if let handle, handle.contains(convert(point, from: superview)) { return self }
        // Elsewhere only its sides' own views: the page under it takes the rest.
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        if let handle { addCursorRect(handle, cursor: isVertical ? .resizeLeftRight : .resizeUpDown) }
    }

    func splitView(_ splitView: NSSplitView, effectiveRect proposedEffectiveRect: NSRect, forDrawnRect drawnRect: NSRect,
                   ofDividerAt dividerIndex: Int) -> NSRect {
        handle ?? proposedEffectiveRect
    }
    func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
        max(proposedMinimumPosition, minPage)
    }
    func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposedMaximumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
        min(proposedMaximumPosition, (isVertical ? bounds.width : bounds.height) - minPanel - dividerThickness)
    }
    func splitViewDidResizeSubviews(_ notification: Notification) {
        onResize?()
        window?.invalidateCursorRects(for: self)
    }
}

/// A view that takes no events of its own: those reach what lies under it.
final class PassThroughView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}
