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
    /// The strip across the top that switches between Command and Conquer.
    let modeBar: ModeBar
    /// Command: the split and its splash, under the mode bar.
    let command: NSView
    /// Conquer: the browser, in Command's place while it shows.
    let conquer: ConquerView
    private(set) var mode: Mode = .command
    let atlasView: AtlasView
    let scene: AtlasScene
    let options: Options
    /// The map's Apple Music bar's player (`paseoMusic` messages).
    let music = MusicController()
    /// Bridge messages decode their images here, in order, then apply on main.
    private let decoding = DispatchQueue(label: "paseo.world.decode", qos: .userInitiated)
    /// Runs the app's own server when the page is that server's (see `ServerManager`).
    private let server: ServerManager?
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
        window.title = "Paseo Command"
        // No title bar: the mode bar takes its place, the traffic lights at its left.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // Where the user left it, across launches and ⌘R updates (checks pass --size).
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
        let barHeight: CGFloat = titlebar > 0 ? titlebar : 30
        modeBar = ModeBar(frame: CGRect(x: 0, y: root.bounds.height - barHeight, width: root.bounds.width, height: barHeight))
        modeBar.autoresizingMask = [.width, .minYMargin]
        command = NSView(frame: CGRect(x: 0, y: 0, width: root.bounds.width, height: root.bounds.height - barHeight))
        command.autoresizingMask = [.width, .height]
        split.frame = command.bounds
        command.addSubview(split)
        splash = SplashView(frame: command.bounds)
        splash.autoresizingMask = [.width, .height]
        command.addSubview(splash)
        conquer = ConquerView(frame: command.frame, persistent: options.info == nil)
        conquer.autoresizingMask = [.width, .height]
        conquer.isHidden = true
        for v in [command, conquer, modeBar] { root.addSubview(v) }
        window.contentView = root
        content = NSView(frame: split.bounds)
        content.autoresizingMask = [.width, .height]
        drawer = TerminalDrawer(frame: CGRect(x: 0, y: 0, width: 460, height: split.bounds.height))
        split.addArrangedSubview(content)
        split.setHoldingPriority(.defaultLow, forSubviewAt: 0)
        // The panel joins the split only while it shows (see `attachDrawer`).
        drawer.isHidden = true
        drawer.dock = dock

        scene = AtlasScene(size: content.bounds.size)
        atlasView = AtlasView(frame: content.bounds, scene: scene)
        atlasView.autoresizingMask = []
        content.addSubview(atlasView)

        let configuration = WKWebViewConfiguration()
        // Check runs (`--info`) keep their page storage to themselves: sharing the
        // user's copy's, a check that quits stops that copy's storage saving to disk.
        configuration.websiteDataStore = options.info == nil ? .default() : .nonPersistent()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: content.bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        // The page is transparent where the map is; SpriteKit shows through.
        web.setValue(false, forKey: "drawsBackground")
        web.isInspectable = true
        // Measurements and checks draw while covered: WebKit stops throttling too.
        let occlusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if AtlasView.ignoreOcclusion, web.responds(to: occlusion) { web.perform(occlusion, with: false) }
        content.addSubview(web)
        super.init()
        configuration.userContentController.add(self, name: "paseoWorld")
        configuration.userContentController.add(self, name: "paseoMusic")
        music.send = { [weak self] reading in self?.send(reading, as: "paseo:music") }
        music.visible = { [weak self] in self?.window.occlusionState.contains(.visible) ?? false }
        web.navigationDelegate = self
        web.uiDelegate = self
        window.delegate = self
        scene.emit = { [weak self] message in self?.send(message) }
        drawer.server = { [weak self] in self?.serverURL ?? options.url }
        drawer.onMove = { [weak self] in self?.moveTerminal() }
        drawer.onMaximize = { [weak self] in self?.maximizeTerminal() }
        modeBar.onSelect = { [weak self] mode in self?.show(mode) }
        placeModeBar()
        // Where the user left it, across launches and ⌘R updates.
        if options.info == nil, UserDefaults.standard.string(forKey: "mode") == Mode.conquer.rawValue {
            DispatchQueue.main.async { self.show(.conquer) }
        }
        if UserDefaults.standard.bool(forKey: "terminalOpen") { DispatchQueue.main.async { self.setTerminal(open: true, newTab: false) } }
        if server != nil {
            showSplash("Starting the app server…")
            notice("Starting Paseo Command…", "Starting the app server on \(options.url.host ?? ""):\(options.url.port ?? 4310).")
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
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if message.name == "paseoMusic" {
            switch type {
            case "watch": music.watch(body["on"] as? Bool ?? false)
            case "command": music.command(body["name"] as? String ?? "")
            default: break
            }
            return
        }
        switch type {
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
        case "viewport":
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
            drawer.show(w.flatMap { w in
                (w["id"] as? String).map { TerminalWorkspace(id: $0, host: w["host"] as? String ?? "", name: w["name"] as? String ?? $0) }
            })
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
            case "conquer-tab": show(.conquer); conquer.newTab()
            case "zen-cookies": conquer.perform("importCookies")
            case "reload": (NSApp.delegate as? AppDelegate)?.reloadApp(nil)
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

    /// Cover the window while the app (re)loads: at launch, on ⌘R, and when
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

    /// Lay the SpriteKit view exactly under the page's map surface.
    private func layoutAtlas() {
        guard let viewport, viewport.width > 0, viewport.height > 0 else { return }
        let frame = CGRect(x: viewport.minX, y: web.bounds.height - viewport.maxY, width: viewport.width, height: viewport.height)
        let resized = atlasView.frame.size != frame.size
        atlasView.frame = frame
        atlasView.isHidden = !scene.hasArt
        if resized {
            atlasView.resized()
            scene.size = frame.size
            scene.viewportChanged()
        }
        atlasView.govern()
        placeMaximized()
    }

    /// The mode bar's tabs start past the traffic lights, or at the edge in
    /// full screen, where the lights are hidden.
    private func placeModeBar() {
        let fullScreen = window.styleMask.contains(.fullScreen)
        modeBar.leading = fullScreen ? 0 : (window.standardWindowButton(.zoomButton)?.frame.maxX ?? 0)
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
            notice("Starting Paseo Command…", "The app server wasn’t running; starting it again.")
            startServer { [weak self] in self?.splash.say("Loading…"); self?.web.load(URLRequest(url: url)) }
            return
        }
        failure("Paseo Command isn’t reachable", "\(options.url.absoluteString) did not answer. " +
            (server == nil ? "Start the app server (<code>npm run app:start</code>) and reload (⌘R)." : "Reload (⌘R) to try again."))
    }

    /// A plain page in place of the app (starting up, or unreachable).
    private func notice(_ title: String, _ detail: String) {
        let html = "<body style='font:15px -apple-system;color:#f2e1b2;background:#182420;padding:40px'><h2>\(title)</h2><p>\(detail)</p></body>"
        web.loadHTMLString(html, baseURL: nil)
    }

    /// A notice that something went wrong, shown with the splash lifted.
    private func failure(_ title: String, _ detail: String) {
        splashFallback?.cancel()
        splash.hide()
        notice(title, detail)
    }

    private func startServer(_ then: @escaping () -> Void) {
        server?.ensure(port: options.url.port ?? 80) { [weak self] result in
            switch result {
            case .success: then()
            case .failure(let error):
                let text = error.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
                self?.failure("The app server didn’t start", "<pre style='white-space:pre-wrap'>\(text)</pre>Fix it and reload (⌘R).")
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

    /// Links that open a new window (PRs, issues) go to the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // The app stays on its own origin; other links open in the browser.
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
           url.host != options.url.host || url.port != options.url.port {
            NSWorkspace.shared.open(url)
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
    func snapshot(to path: String) {
        if mode == .conquer { return conquer.snapshot(under: modeBar, to: path) }
        let bounds = web.bounds
        let whole = split.bounds
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
            let left = CGRect(x: 0, y: whole.height - bounds.height, width: bounds.width, height: bounds.height)
            if let world { ctx.draw(world, in: self.atlasView.frame.offsetBy(dx: 0, dy: left.minY)) }
            if let page, let image = page.cgImage(forProposedRect: nil, context: nil, hints: nil) { ctx.draw(image, in: left) }
            if let terminal {
                // Beside the page in the split, or over its map when maximized.
                let r = self.split.convert(self.drawer.frame, from: self.drawer.superview)
                ctx.draw(terminal, in: CGRect(x: r.minX, y: whole.height - r.maxY, width: r.width, height: r.height))
            }
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

    /// Switch the window between the map and panels and the browser (⌘` toggles).
    /// The side not shown keeps running: the page, its terminals and its tabs stay live.
    func show(_ next: Mode) {
        guard next != mode else { return }
        mode = next
        modeBar.mode = next
        command.isHidden = next != .command
        conquer.isHidden = next != .conquer
        atlasView.govern()
        if next == .conquer {
            conquer.start()
            conquer.focusPage()
        } else {
            window.makeFirstResponder(web)
        }
        if options.info == nil { UserDefaults.standard.set(next.rawValue, forKey: "mode") }
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
    }

    private func detachDrawer() {
        guard let parent = drawer.superview else { return }
        if parent === split { split.removeArrangedSubview(drawer) }
        drawer.removeFromSuperview()
        split.adjustSubviews()
    }

    /// The maximized panel lies exactly over the page's map (it follows the map as the page lays out).
    private func placeMaximized() {
        guard drawer.maximized else { return }
        drawer.frame = viewport == nil ? content.bounds : atlasView.frame
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

    /// Before a ⌘R: bring our own server up to date (restarted only when its
    /// code changed, so `app:update` never drops the page's connections).
    /// `done` says whether the server is ready (on a failure the window shows why).
    func refreshServer(_ done: @escaping (_ ready: Bool) -> Void) {
        guard let server else { return done(true) }
        server.refresh(port: options.url.port ?? 80) { [weak self] result in
            if case .failure(let error) = result {
                let text = error.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
                self?.failure("The app server didn’t restart", "<pre style='white-space:pre-wrap'>\(text)</pre>Fix it and reload (⌘R).")
            }
            done((try? result.get()) != nil)
        }
    }

    func reload() {
        // A ⌘R after the server failed tries it again.
        if server != nil, web.url?.host != options.url.host {
            recovered = nil
            splash.say("Starting the app server…")
            notice("Starting Paseo Command…", "Starting the app server.")
            let url = pageURL
            startServer { [weak self] in self?.splash.say("Loading…"); self?.web.load(URLRequest(url: url)) }
            return
        }
        if web.url?.host == options.url.host && web.url?.port == options.url.port { web.reload() }
        else { web.load(URLRequest(url: pageURL)) }
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
        return super.hitTest(point)
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
        window?.invalidateCursorRects(for: self)
    }
}
