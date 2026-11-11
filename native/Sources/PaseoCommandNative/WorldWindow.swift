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
    /// The Terminal tab's terminals (its tabs, panes and sessions), in the map's place while it shows.
    let drawer: TerminalDrawer
    /// The Files page's editor terminals, over its viewer (Settings → Files → Open files in an editor).
    let editors: EditorOverlay
    /// The browser attached to each agent on the Dungeon Board, over the board above its dialogue box (`BoardBrowser.swift`).
    let boardBrowser: BoardBrowser
    /// Over the map and page, the window's (not the page's sibling): where Conquer, the Terminal tab and
    /// the Files page's editors go. It lets everything else through to the page.
    let content: NSView
    /// Covers the window until the map has drawn (see `revealWhenDrawn`).
    let splash: SplashView
    /// The strip across the top that switches between Command, Conquer, Activity, GitHub, Files and Settings.
    let modeBar: ModeBar
    /// Command: the map and the page over it, under `content`, the splash and the mode bar.
    let command: NSView
    /// The mode bar's height: the page's own top bar, whose tools show at its right end.
    let barHeight: CGFloat
    /// Conquer: the browser, in the map's place while it shows.
    let conquer: ConquerView
    private(set) var mode: Mode = .command
    /// The SpriteKit view; replaced by a fresh one if its loop wedges (`rebuildAtlasView`).
    private(set) var atlasView: AtlasView
    /// The page's last account of its world (`pageStatus`), for `--info`.
    var pageWorld: [String: Any] = [:]
    private(set) var scene: MapScene
    /// The style the page's map is drawn in now, as the page reports it (View → Map Style marks it).
    private(set) var mapStyle = "islands"
    let options: Options
    /// The page's sides that can show: those whose integration is on (the page says, with
    /// `integrations`), and Files and Settings.
    private(set) var enabledModes: Set<Mode> = Mode.alwaysShown { didSet { if enabledModes != oldValue { onModesChanged?() } } }
    /// The tabs shown changed (the View menu renumbers its keys).
    var onModesChanged: (() -> Void)?
    /// The tabs shown, in the mode bar's order: ⌘` steps through them, ⌘1…⌘6 pick one (Settings is the gear).
    var shownModes: [Mode] { Mode.tabs.filter { !$0.drawnByPage || enabledModes.contains($0) } }
    /// The side Settings returns to when it closes.
    private var beforeSettings: Mode = .command
    /// The side ⌃` returns to from the Terminal tab.
    private var beforeTerminal: Mode = .command
    var nextMode: Mode {
        let modes = shownModes
        // From Settings, on from the side it opened over.
        return modes[((modes.firstIndex(of: mode == .settings ? beforeSettings : mode) ?? 0) + 1) % modes.count]
    }
    /// Bridge messages decode their images here, in order, then apply on main.
    private let decoding = DispatchQueue(label: "paseo.world.decode", qos: .userInitiated)
    /// Runs the app's own server when the page is that server's (see `ServerManager`).
    let server: ServerManager?
    private let refusedPort: Bool
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
        window.backgroundColor = Textures.color(0x1d6884)
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
        conquer = ConquerView(frame: command.frame, persistent: options.info == nil)
        conquer.isHidden = true
        window.contentView = root
        content = PassThroughView(frame: command.frame)
        content.autoresizingMask = [.width, .height]
        drawer = TerminalDrawer(frame: content.bounds)
        editors = EditorOverlay(font: drawer.font)
        // Over the page's viewer, under Conquer and the Terminal tab.
        content.addSubview(editors)
        // An agent's browser, over the box the page draws for it on the board; its other tabs' pages
        // wait under everything, drawn but unseen.
        boardBrowser = BoardBrowser(persistent: options.info == nil)
        content.addSubview(boardBrowser.stage, positioned: .below, relativeTo: editors)
        root.addSubview(boardBrowser.parking)
        // Shown only with the Terminal tab (see `enterTerminalTab`).
        drawer.isHidden = true
        drawer.autoresizingMask = []
        content.addSubview(drawer)

        scene = makeMapScene(kind: "atlas", size: content.bounds.size)
        atlasView = AtlasView(frame: content.bounds, scene: scene)
        atlasView.autoresizingMask = []
        command.addSubview(atlasView)

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
        // The page is transparent where the map is; SpriteKit shows through.
        web.setValue(false, forKey: "drawsBackground")
        web.isInspectable = true
        // Measurements and checks draw while covered: WebKit stops throttling too.
        let occlusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if AtlasView.ignoreOcclusion, web.responds(to: occlusion) { web.perform(occlusion, with: false) }
        // Map and page, then over them `content`: it lets everything through to the page but
        // Conquer, the Terminal tab and the editors. It is the window's, not the page's sibling:
        // views after a web view in its own parent stay off screen until the web view is hidden and shown again.
        command.addSubview(web)
        for v in [command, content, splash, modeBar] { root.addSubview(v) }
        super.init()
        conquer.onTogglePanel = { [weak self] in self?.pageCommand("toggle-panel") }
        conquer.onLink = { [weak self] url in self?.routeLink(url) ?? false }
        (window as? AppWindow)?.document = { [weak self] in self?.mode == .conquer ? self?.conquer.current?.url : nil }
        (window as? AppWindow)?.conquerHasKeys = { [weak self] in self?.mode == .conquer && self?.conquer.hasKeyFocus == true }
        (window as? AppWindow)?.filesShows = { [weak self] in self?.mode == .files }
        (window as? AppWindow)?.pageRefreshes = { [weak self] in self?.pageRefreshes == true }
        (window as? AppWindow)?.terminalHasKeys = { [weak self] in
            self?.editors.hasKeyFocus == true || self?.drawer.hasKeyFocus == true || self?.boardBrowser.hasKeyFocus == true
        }
        (window as? AppWindow)?.tabTerminalHasKeys = { [weak self] in self?.drawer.hasKeyFocus == true }
        (window as? AppWindow)?.onTogglePanel = { [weak self] in self?.pageCommand("toggle-panel") }
        (window as? AppWindow)?.onPalette = { [weak self] in
            guard let self else { return }
            if self.editors.hasKeyFocus { self.editors.openPalette(web: self.web) }
            else { self.window.makeFirstResponder(self.web); self.web.evaluateJavaScript(EditorKeys.paletteScript, completionHandler: nil) }
        }
        configuration.userContentController.add(self, name: "paseoWorld")
        web.navigationDelegate = self
        web.uiDelegate = self
        window.delegate = self
        scene.emit = { [weak self] message in self?.send(message) }
        // The map's loop stalled and was restarted: the page posts the world again, in case it was missed.
        atlasView.onRecover = { [weak self] why in
            self?.send(["type": "stalled", "why": why])
            self?.reportState()
        }
        atlasView.onRebuild = { [weak self] old in self?.rebuildAtlasView(old) }
        drawer.server = { [weak self] in self?.serverURL ?? options.url }
        editors.server = { [weak self] in self?.serverURL ?? options.url }
        editors.tell = { [weak self] in self?.send($0, as: "paseo:editor") }
        editors.runInPage = { [weak self] in self?.web.evaluateJavaScript($0, completionHandler: nil) }
        boardBrowser.server = { [weak self] in self?.serverURL ?? options.url }
        boardBrowser.tell = { [weak self] in self?.send($0, as: "paseo:browser") }
        boardBrowser.pageView = web
        boardBrowser.drawsWhileCovered = AtlasView.ignoreOcclusion
        modeBar.onSelect = { [weak self] mode in self?.show(mode) }
        modeBar.enabled = enabledModes
        modeBar.onAction = { [weak self] action, view in
            if action == "settings" { self?.toggleSettings() } else { self?.barAction(action, view) }
        }
        placeModeBar()
        // Where the user left it, across launches and app restarts.
        if options.info == nil, let saved = UserDefaults.standard.string(forKey: "mode").flatMap(Mode.init(rawValue:)), saved != .command {
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
            enabledModes = Set(Mode.tabs.filter { $0.drawnByPage && body[$0.rawValue] as? Bool == true }).union(Mode.alwaysShown)
            modeBar.enabled = enabledModes
            if mode.drawnByPage && !enabledModes.contains(mode) { show(.command) }
            else if mode != .settings, let saved = UserDefaults.standard.string(forKey: "mode").flatMap(Mode.init(rawValue:)),
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
                    // The page mounted another world (the Dungeon Board or the Atlas): its scene takes the view's place.
                    self.adopt(kind: body["scene"] as? String ?? "atlas")
                    self.scene.setArt(frames: frames, tiles: tiles, constants: body["constants"] as? [String: Any] ?? [:],
                                      reduced: body["reduced"] as? Bool ?? false)
                    self.layoutAtlas()
                }
            }
        case "scene":
            decoding.async { [weak self] in
                var images: [String: CGImage] = [:]
                for list in ["pieces", "banners", "streamers", "images"] {
                    for item in body[list] as? [[String: Any]] ?? [] {
                        if let key = item["key"] as? String, let png = item["png"] as? String, let image = Textures.image(dataURL: png) { images[key] = image }
                    }
                }
                DispatchQueue.main.async { self?.scene.setScene(body, images: images); self?.reportState(); self?.revealWhenDrawn() }
            }
        case "agents":
            decoding.async { [weak self] in
                // The Dungeon Board's HUD comes with their agents.
                var images: [String: CGImage] = [:]
                for item in (body["hud"] as? [String: [String: Any]] ?? [:]).values {
                    if let key = item["key"] as? String, let png = item["png"] as? String, let image = Textures.image(dataURL: png) { images[key] = image }
                }
                DispatchQueue.main.async { self?.scene.setAgents(body, images: images); self?.reportState() }
            }
        default:
            // Everything else is cheap and keeps its order behind any pending decode.
            decoding.async { DispatchQueue.main.async { [weak self] in self?.handle(type, body) } }
        }
    }

    private func handle(_ type: String, _ body: [String: Any]) {
        let point = CGPoint(x: body["x"] as? Double ?? 0, y: body["y"] as? Double ?? 0)
        switch type {
        case "mode":
            // The page asks which side shows (it draws GitHub, Activity, Files and Settings itself, over the map).
            sendMode()
        case "activity":
            // Activity's unread count, for its tab.
            modeBar.activityUnread = max(0, body["unread"] as? Int ?? 0)
        case "update":
            // The page asks for the version and whether updates can be checked for.
            send(Updater.event, as: "paseo:update")
        case "barState":
            // What the top bar's tools show: who needs you, usage, What's new, the panel's state.
            modeBar.apply(body)
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
        // The Dungeon Board's dialogue box: the robot it talks to (null when it closes) and the map's bottom it covers.
        case "talk": scene.talk(id: body["id"] as? String, inset: CGFloat(body["inset"] as? Double ?? 0))
        case "command": scene.command(body["name"] as? String ?? "")
        case "input": scene.setInput(body["enabled"] as? Bool ?? true)
        case "motion": scene.setMotion(reduced: body["reduced"] as? Bool ?? false)
        case "mapStyle":
            // The page's map style, for View → Map Style.
            mapStyle = body["style"] as? String ?? mapStyle
        case "workspace":
            let w = body["workspace"] as? [String: Any]
            let selected = w.flatMap { w in
                (w["id"] as? String).map { TerminalWorkspace(id: $0, host: w["host"] as? String ?? "", name: w["name"] as? String ?? $0) }
            }
            drawer.show(selected)
        case "editor":
            // The Files page's shown tab's editor terminal and its viewer's frame (or none).
            editors.place(EditorPlacement(body), filesShows: mode == .files, web: web)
        case "editorFocus": if mode == .files { editors.focus() }
        case "editorClose": if let request = EditorCloseRequest(body) { editors.close(request, window: window) }
        case "editorForget": editors.forget(body["terminals"] as? [String] ?? [])
        case "browser":
            // The Dungeon Board's browser: whose shows, and the box the page drew for it (or none).
            boardBrowser.place(BrowserPlacement(body), commandShows: mode == .command)
        case "browserDo": boardBrowser.perform(body)
        // Settings → Map: agents' browser tools open and drive tabs here.
        case "browserHost": boardBrowser.setHosting(body["enabled"] as? Bool ?? false)
        case "browserState": boardBrowser.publish()
        case "terminalFont":
            // Settings → Terminal: it asks for the font, the line height and spacing and the installed
            // monospaced families, and sets them (`set`), for every terminal at once.
            if let change = body["set"] as? [String: Any] { setTerminalFont(drawer.font.applying(change, families: TerminalFonts.families())) }
            else { sendTerminalFont(families: true) }
        case "revealFile":
            if let path = body["path"] as? String, path.hasPrefix("/"), !path.hasPrefix("//"),
               !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            }
        case "openLink":
            // A link clicked in the chat: a new Conquer tab, in the map's place. A Linear issue opens
            // in Linear's desktop app when it's installed; a GitHub pull request goes to the page for
            // its tab, unless the page sent it `direct`.
            if let text = body["url"] as? String, let url = URL(string: text), url.scheme?.hasPrefix("http") == true {
                if LinearLink.openInApp(url) { break }
                if body["direct"] as? Bool == true || !routeLink(url) { openInApp(url) }
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
            case "terminal-unsplit": if mode == .terminal { drawer.unsplit() }
            case "terminal-bigger": zoomTerminals(1)
            case "terminal-smaller": zoomTerminals(-1)
            case "terminal-actual": zoomTerminals(0)
            case "conquer": show(.conquer)
            case "mode-next": show(nextMode)
            case "github": show(.github)
            case "activity": show(.activity)
            case "files": show(.files)
            case "terminal-tab": show(.terminal)
            case "settings": show(.settings)
            case "settings-close": if mode == .settings { show(beforeSettings) }
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
        case "pageStatus":
            // The page's side of the map's watchdog: when it last had data and posted it, its live connection.
            pageWorld = body.filter { $0.key != "type" }
            return
        case "log":
            // The page's watchdog says what it did (posting the world again).
            Log.line("page: \(body["text"] as? String ?? "")")
            return
        case "detach":
            // The page unmounted its world (it is reloading or navigating).
            atlasView.isHidden = true
            atlasView.isPaused = true
            boardBrowser.place(.nothing)
        default: break
        }
        if type != "detach", atlasView.isHidden, scene.hasArt { atlasView.isHidden = false; atlasView.govern() }
        if AtlasScene.debug { Log.line("\(type) \(body)") }
        if type != "pointer" && type != "wheel" && type != "editor" && type != "browser" { reportState() }
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

    /// The map's rectangle in `content`, where Conquer and the Terminal tab go.
    private var mapInContent: CGRect {
        viewport == nil ? content.bounds : content.convert(atlasView.frame, from: command)
    }

    /// The page mounted the world `kind`: unless the scene is already that kind, a fresh scene of
    /// it takes the old one's place, in a fresh view (a scene shows in one view at a time).
    private func adopt(kind: String) {
        guard kind != scene.kind else { return }
        let old = atlasView
        let next = makeMapScene(kind: kind, size: scene.size)
        next.emit = { [weak self] message in self?.send(message) }
        old.retire()
        // One map at a time: the old scene's halos go with it.
        SpriteGlow.clear()
        let view = old.successor(scene: next)
        command.replaceSubview(old, with: view)
        atlasView = view
        scene = next
        Log.line("map: the \(kind) world")
        view.govern()
    }

    /// A wedged SpriteKit view gives its place to a fresh one showing the same scene.
    private func rebuildAtlasView(_ old: AtlasView) {
        guard old === atlasView, old.superview === command else { return }
        // The old view lets the scene go first: a scene shows in one view at a time.
        old.retire()
        let next = old.successor()
        command.replaceSubview(old, with: next)
        atlasView = next
        next.govern()
        Log.line("map: a fresh view took its place")
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
        placeTerminalTab()
        editors.place(nil, filesShows: mode == .files, web: web)
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
        atlasView.isHidden = true
        webView.load(URLRequest(url: options.url))
    }

    /// Links that open a new window (PRs, issues) go to the default browser: web and
    /// mail links only, never `file:` or another app's URL scheme. A Linear issue opens in
    /// Linear's desktop app, else in Conquer.
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
        // The Terminal tab's view is layer-backed: its layer tree draws it.
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
            // The page's area, from the window's bottom-left origin.
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
                // Over the map, in its place.
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

    /// Switch the map's place between the map, the browser and the pages (⌘` steps through them),
    /// which the page draws over its map; the panels stay, and ⌘B (the page's
    /// panel toggle) gives the browser the width.
    /// The side not shown keeps running: the map's page and Conquer's tabs stay live.
    func show(_ next: Mode) {
        guard !next.drawnByPage || enabledModes.contains(next) else { return }
        guard next != mode else { return }
        if next == .settings { beforeSettings = mode }
        if next == .terminal { beforeTerminal = mode }
        let leftTerminal = mode == .terminal
        mode = next
        modeBar.mode = next
        atlasView.covered = next != .command
        placeConquer()
        if leftTerminal { leaveTerminalTab() }
        if next == .terminal { enterTerminalTab() }
        // A file's editor shows only with Files (the page says where once it draws it again).
        editors.place(nil, filesShows: next == .files, web: web)
        // An agent's browser shows only over the map.
        boardBrowser.place(commandShows: next == .command)
        sendMode()
        if next == .conquer {
            conquer.start()
            conquer.focusPage()
        } else if next != .terminal {
            window.makeFirstResponder(web)
        }
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

    /// Tell the page which side shows, so it draws GitHub, Activity, Files or Settings in the map's place.
    /// Asks the page for one of its commands (`web/src/appCommands.ts`), as its palette does.
    /// ⌘R is the page's refresh (View → Refresh Page): GitHub, Files or Activity shows and no terminal has the keyboard.
    var pageRefreshes: Bool { AppKeys.pageRefreshes(mode, terminalHasKeys: editors.hasKeyFocus || drawer.hasKeyFocus) }

    func pageCommand(_ name: String) {
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('paseo:command', { detail: '\(name)' }))", completionHandler: nil)
    }
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

    /// A link the page opens in a new window: the default browser, but a Linear page (with no Linear
    /// app to take it) in Conquer, as the chat's links are.
    private func openOutside(_ url: URL) {
        if LinearLink.appURL(for: url) != nil { openInApp(url) } else { NSWorkspace.shared.open(url) }
    }

    /// Open `url` in a new Conquer tab (a link from the chat), in the map's
    /// place, once its tabs and cookies are in.
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

    /// The terminals' text size (⌘+, ⌘−, ⌘0): the Terminal tab's and the Files page's editors'.
    func zoomTerminals(_ step: CGFloat) {
        drawer.zoom(step)
        editors.setFont(drawer.font)
        sendTerminalFont()
    }

    /// The terminals' font (Settings → Terminal), for the Terminal tab's and the Files page's editors'.
    func setTerminalFont(_ font: TerminalFontSettings) {
        drawer.apply(font)
        editors.setFont(font)
        sendTerminalFont()
    }

    /// Tell the page the terminals' font (`paseo:terminal-font`), with the installed monospaced families when asked.
    func sendTerminalFont(families: Bool = false) {
        var message = drawer.font.json
        message["defaults"] = TerminalFontSettings.standard.json
        message["ranges"] = ["size": [TerminalFontSettings.sizes.lowerBound, TerminalFontSettings.sizes.upperBound],
                             "lineHeight": [0, TerminalFontSettings.maxLineHeight],
                             "letterSpacing": [TerminalFontSettings.letterSpacings.lowerBound, TerminalFontSettings.letterSpacings.upperBound]]
        if families { message["families"] = TerminalFonts.families() }
        send(message, as: "paseo:terminal-font")
    }

    /// ⌃` (View → Show Terminal): the Terminal tab, from anywhere; in it, back to the side before it.
    @objc func toggleTerminal() {
        show(mode == .terminal ? (beforeTerminal == .terminal ? .command : beforeTerminal) : .terminal)
    }

    /// The Terminal tab: its terminals, tabs and splits in the map's place, as Conquer lies. Opening it
    /// with no terminal in the workspace starts one; hidden, it stops asking the daemon.
    private func enterTerminalTab() {
        drawer.isHidden = false
        placeTerminalTab()
        drawer.setActive(true)
        drawer.opened()
    }

    private func leaveTerminalTab() {
        drawer.setActive(false)
        drawer.isHidden = true
    }

    /// Where the Terminal tab's view is (checks): over the map while the tab shows, else hidden.
    func terminalPlace() -> [String: Any] {
        ["in": drawer.superview === content && !drawer.isHidden ? "map" : "hidden",
         "frame": NSStringFromRect(drawer.frame), "mapRect": NSStringFromRect(mapInContent)]
    }

    /// The Terminal tab lies exactly over the page's map, as Conquer does (⌘B gives it the window's width).
    private func placeTerminalTab() {
        guard !drawer.isHidden else { return }
        drawer.frame = mapInContent
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

/// A view that takes no events of its own: those reach what lies under it.
final class PassThroughView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}
