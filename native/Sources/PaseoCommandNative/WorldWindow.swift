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
    let atlasView: AtlasView
    let scene: AtlasScene
    let options: Options
    /// Bridge messages decode their images here, in order, then apply on main.
    private let decoding = DispatchQueue(label: "paseo.world.decode", qos: .userInitiated)
    /// The page's map rectangle, in its CSS pixels (top-left origin).
    private var viewport: CGRect?

    init(options: Options) {
        self.options = options
        let screen = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let size = options.size ?? CGSize(width: min(1440, screen.width - 80), height: min(900, screen.height - 80))
        window = NSWindow(contentRect: CGRect(x: screen.minX + 40, y: screen.maxY - size.height - 40, width: size.width, height: size.height),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Paseo Command"
        window.minSize = NSSize(width: 760, height: 520)
        window.isReleasedWhenClosed = false
        window.backgroundColor = Textures.color(0x1d6884)
        let content = NSView(frame: window.contentView!.bounds)
        content.autoresizingMask = [.width, .height]
        window.contentView = content

        scene = AtlasScene(size: content.bounds.size)
        atlasView = AtlasView(frame: content.bounds, scene: scene)
        atlasView.autoresizingMask = []
        content.addSubview(atlasView)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
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
        // `--web-world` leaves the Atlas to Phaser in the page, for comparison.
        if !options.webWorld { configuration.userContentController.add(self, name: "paseoWorld") }
        else { atlasView.isHidden = true; atlasView.isPaused = true }
        web.navigationDelegate = self
        web.uiDelegate = self
        window.delegate = self
        scene.emit = { [weak self] message in self?.send(message) }
        web.load(URLRequest(url: options.url))
        // Checks read the scene's state from the page; keep it current.
        if options.checks {
            Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.reportState() }
        }
    }

    // MARK: Page → Swift

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
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
                for list in ["pieces", "banners"] {
                    for item in body[list] as? [[String: Any]] ?? [] {
                        if let key = item["key"] as? String, let png = item["png"] as? String, let image = Textures.image(dataURL: png) { images[key] = image }
                    }
                }
                DispatchQueue.main.async { self?.scene.setScene(body, images: images); self?.reportState() }
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
        case "detach":
            // The page switched to the Galaxy (drawn by Phaser) or reloaded.
            atlasView.isHidden = true
            atlasView.isPaused = true
        default: break
        }
        if type != "detach", atlasView.isHidden, scene.hasArt { atlasView.isHidden = false; atlasView.govern() }
        if AtlasScene.debug { Log.line("\(type) \(body)") }
        if type != "pointer" && type != "wheel" { reportState() }
    }

    /// Lay the SpriteKit view exactly under the page's map surface.
    private func layoutAtlas() {
        guard let viewport, viewport.width > 0, viewport.height > 0 else { return }
        let frame = CGRect(x: viewport.minX, y: web.bounds.height - viewport.maxY, width: viewport.width, height: viewport.height)
        let resized = atlasView.frame.size != frame.size
        atlasView.frame = frame
        atlasView.isHidden = !scene.hasArt
        if resized { scene.size = frame.size; scene.viewportChanged() }
        atlasView.govern()
    }

    func windowDidResize(_ notification: Notification) {
        // The page reports its map's new rectangle; until it does, keep the old one.
        layoutAtlas()
    }

    // MARK: Swift → page

    func send(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('paseo:world',{detail:\(json)}))", completionHandler: nil)
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

    /// A scripted drag across the map (for measurements): pointer and mouse
    /// events on the map surface, as a hand would make them, for `seconds`.
    func scriptedPan(seconds: Double) {
        let js = """
        (() => {
          const surface = document.querySelector('.atlas-world-surface');
          if (!surface) return 'no map';
          const target = surface.querySelector('canvas') || surface;
          const r = target.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const send = (type, x, y, buttons) => {
            const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons, view: window };
            const pointer = { pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' }[type];
            target.dispatchEvent(new PointerEvent(type, { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            target.dispatchEvent(new MouseEvent(pointer, o));
          };
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
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.line("page failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Log.line("page failed to load: \(error.localizedDescription)")
        let html = "<body style='font:15px -apple-system;color:#f2e1b2;background:#182420;padding:40px'><h2>Paseo Command isn’t reachable</h2><p>\(options.url.absoluteString) did not answer. Start the app server (<code>npm run app:start</code>) and reload (⌘R).</p></body>"
        webView.loadHTMLString(html, baseURL: nil)
    }

    /// The web content process ended (crash or memory pressure): load again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.line("web content process ended; reloading")
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
        let bounds = web.bounds
        let scale = window.backingScaleFactor
        var world: CGImage?
        if !atlasView.isHidden, let texture = atlasView.texture(from: scene) { world = texture.cgImage() }
        web.takeSnapshot(with: nil) { [weak self] page, error in
            guard let self else { return }
            let width = Int(bounds.width * scale), height = Int(bounds.height * scale)
            guard let ctx = Textures.context(width, height) else { return }
            ctx.scaleBy(x: scale, y: scale)
            ctx.setFillColor(Textures.color(0x1d6884).cgColor)
            ctx.fill(bounds)
            if let world { ctx.draw(world, in: self.atlasView.frame) }
            if let page, let image = page.cgImage(forProposedRect: nil, context: nil, hints: nil) { ctx.draw(image, in: bounds) }
            guard let image = ctx.makeImage(),
                  let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)
            else { return }
            CGImageDestinationAddImage(destination, image, nil)
            CGImageDestinationFinalize(destination)
            Log.line("snapshot \(path)\(error.map { " (\($0))" } ?? "")")
        }
    }

    func reload() { web.reload() }

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
