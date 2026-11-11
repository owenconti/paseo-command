import AppKit
import UniformTypeIdentifiers
import WebKit

/// The browser attached to each agent on the Dungeon Board: its own tabs, shown over the board above
/// the agent's dialogue box, in a box the page draws (`web/src/worldChat/BoardBrowser.tsx`) and whose
/// frame it reports, as the Files page does for its editor terminals (`EditorEmbed.swift`). The page
/// draws the tabs and the address bar; this owns the web views and what they load.
///
/// Agents open and drive tabs with Paseo's own `browser_*` tools: while Settings → Map has it on, the
/// app holds a socket to its server (`/api/browser-host`, `web/server/browserHost.ts`), which registers
/// it on each daemon as a browser host and relays the daemons' requests. A request names its agent, so
/// a tab an agent opens is that agent's. Commands run in `BrowserAutomation.swift`'s script.
///
/// Its pages have a cookie store of their own: not Conquer's, so an agent never acts with the user's
/// logins there. A tab of an agent on another host never loads this Mac's own addresses (`BrowserPolicy`).
final class AgentTab: NSObject {
    let id: String
    let page: BrowserTab
    /// The host of the agent it belongs to ("local" or a server id), and that agent.
    let host: String
    let agent: String
    var workspace: String?
    /// The size its page has while it isn't shown (`browser_resize`); shown, it has the board's box.
    var viewport = CGSize(width: 1280, height: 800)
    /// Console messages, newest last, for `browser_logs`.
    var console: [[String: Any]] = []
    /// Dialogs the page raised that nobody was shown, for the next answer about this tab.
    var dialogs: [[String: Any]] = []
    /// Tool calls running on it now: a dialog raised meanwhile is answered for the agent.
    var busy = 0
    /// Why its page didn't load, until it loads something.
    var failure: String?
    fileprivate var waiters: [Int: (String?) -> Void] = [:]

    init(id: String = UUID().uuidString.lowercased(), page: BrowserTab, host: String, agent: String, workspace: String?) {
        self.id = id
        self.page = page
        self.host = host
        self.agent = agent
        self.workspace = workspace
    }

    var remote: Bool { host != "local" }
    var address: String { page.url?.absoluteString ?? "about:blank" }

    func info(active: Bool) -> [String: Any] {
        var out: [String: Any] = ["browserId": id, "url": address, "title": page.title, "isActive": active, "isLoading": page.isLoading,
                                  "canGoBack": page.web?.canGoBack ?? false, "canGoForward": page.web?.canGoForward ?? false]
        if let workspace { out["workspaceId"] = workspace }
        return out
    }
}

/// One agent's browser: its tabs, in order, and the one that shows.
final class AgentBrowser {
    let host: String
    let agent: String
    var workspace: String?
    var tabs: [AgentTab] = []
    var current: AgentTab?
    var used = Date()

    init(host: String, agent: String, workspace: String?) {
        self.host = host
        self.agent = agent
        self.workspace = workspace
    }

    static func key(_ host: String, _ agent: String) -> String { "\(host)|\(agent)" }
    var key: String { Self.key(host, agent) }
}

/// Where the page shows an agent's browser: the agent, its box in the page (CSS pixels, top-left origin),
/// whether a dialog of the page's covers it, and the page's own things lying over the box (a menu, a hint),
/// which show through.
struct BrowserPlacement: Equatable {
    var host: String
    var agent: String?
    var workspace: String?
    var rect: CGRect
    var covered: Bool
    var holes: [CGRect]

    static let nothing = BrowserPlacement(host: "local", agent: nil, workspace: nil, rect: .zero, covered: false, holes: [])

    init(host: String, agent: String?, workspace: String?, rect: CGRect, covered: Bool, holes: [CGRect]) {
        self.host = host
        self.agent = agent
        self.workspace = workspace
        self.rect = rect
        self.covered = covered
        self.holes = holes
    }

    /// From the page's `browser` message (`postBrowserPlacement` in `web/src/worldChat/browserBridge.ts`).
    init(_ body: [String: Any]) {
        let rect = { (d: [String: Any]) -> CGRect in
            let n = { (key: String) in CGFloat((d[key] as? NSNumber)?.doubleValue ?? 0) }
            return CGRect(x: n("x"), y: n("y"), width: max(0, n("width")), height: max(0, n("height")))
        }
        let text = { (key: String) in (body[key] as? String).flatMap { $0.isEmpty || $0.count > 400 ? nil : $0 } }
        self.init(host: text("host") ?? "local", agent: text("agent"), workspace: text("workspace"), rect: rect(body),
                  covered: body["covered"] as? Bool ?? false,
                  holes: (body["holes"] as? [[String: Any]] ?? []).prefix(12).map(rect).filter { $0.width > 0 && $0.height > 0 })
    }

    var key: String? { agent.map { AgentBrowser.key(host, $0) } }
    func visible(commandShows: Bool) -> Bool { agent != nil && commandShows && !covered && rect.width >= 80 && rect.height >= 60 }
}

/// The view the shown tab's page stands in, over the page's box. The page's own things lying over the
/// box (`holes`) are cut out of it: they show, and take their clicks.
final class BrowserStage: NSView {
    private(set) var holes: [CGRect] = []
    private var masked = CGRect.null
    /// A key the browser takes while its page has the keyboard (⌘R, ⌘[, ⌘], ⌘L, ⌘T, ⌘W): true when taken.
    var onKey: ((NSEvent) -> Bool)?

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.white.cgColor
    }
    required init?(coder: NSCoder) { fatalError() }

    /// The holes, in this view's coordinates (the page's, from the box's corner).
    func cut(_ next: [CGRect]) {
        let inside = next.map { $0.intersection(bounds) }.filter { !$0.isNull && $0.width > 0 && $0.height > 0 }
        guard inside != holes || masked != bounds else { return }
        holes = inside
        masked = bounds
        guard !inside.isEmpty else { layer?.mask = nil; return }
        let path = CGMutablePath()
        path.addRect(bounds)
        for hole in inside { path.addRect(hole) }
        let mask = CAShapeLayer()
        mask.frame = bounds
        mask.fillRule = .evenOdd
        mask.path = path
        layer?.mask = mask
    }

    override func layout() {
        super.layout()
        if !holes.isEmpty, masked != bounds { cut(holes) }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        if holes.contains(where: { $0.contains(local) }) { return nil }
        return super.hitTest(point)
    }

    var hasKeyFocus: Bool {
        guard !isHidden, let responder = window?.firstResponder as? NSView else { return false }
        return responder === self || responder.isDescendant(of: self)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if hasKeyFocus, onKey?(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
}

final class BoardBrowser: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, URLSessionWebSocketDelegate {
    static let maxTabs = 12
    static let maxBrowsers = 40
    private static let store = UUID(uuidString: "7E2D9C41-0B6A-4F58-8C3D-5A1E9B7F2D64")!
    private static let defaultsKey = "boardBrowserState"

    let stage = BrowserStage(frame: .zero)
    /// Tabs that aren't shown keep their pages here: in the window, so they draw and can be read and
    /// photographed, under everything, and transparent.
    let parking = NSView(frame: CGRect(x: 0, y: 0, width: 1280, height: 800))
    private(set) var browsers: [String: AgentBrowser] = [:]
    private(set) var placement = BrowserPlacement.nothing
    private var commandShows = true
    /// Tabs and logins come back on the next launch (checks keep theirs to themselves).
    private let persistent: Bool
    private let dataStore: WKWebsiteDataStore
    private var localConfiguration: WKWebViewConfiguration?
    private var remoteConfiguration: WKWebViewConfiguration?
    private var rules: WKContentRuleList?
    private var rulesWaiting: [() -> Void] = []
    private var rulesFailed = false

    /// The app's server, and a way to tell the page (`paseo:browser`).
    var server: () -> URL = { URL(string: "http://127.0.0.1:4321/")! }
    var tell: ([String: Any]) -> Void = { _ in }
    /// The page's own view (the keyboard goes back to it), for frames and focus.
    weak var pageView: NSView?
    /// Check runs draw while the window is covered (`--ignore-occlusion`): its pages do too.
    var drawsWhileCovered = false

    // Hosting: the socket to the app's server, which registers the app on each daemon.
    private(set) var hosting = false
    private var socket: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var connected = false
    private var hostStates: [[String: Any]] = []
    private var retries = 0
    private var retry: DispatchWorkItem?
    private var waiterIds = 0
    private var publishing = false
    private var saving: DispatchWorkItem?
    /// What the last few requests were and how they went (checks).
    private(set) var handled: [[String: Any]] = []

    init(persistent: Bool) {
        self.persistent = persistent
        dataStore = persistent ? WKWebsiteDataStore(forIdentifier: Self.store) : .nonPersistent()
        super.init()
        stage.isHidden = true
        stage.onKey = { [weak self] event in self?.key(event) ?? false }
        parking.alphaValue = 0
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "paseo-remote-agent-loopback", encodedContentRuleList: BrowserPolicy.loopbackRules) { [weak self] list, error in
            guard let self else { return }
            self.rules = list
            self.rulesFailed = list == nil
            if let error { Log.line("browser: the loopback rules didn't compile: \(error.localizedDescription)") }
            let waiting = self.rulesWaiting
            self.rulesWaiting = []
            waiting.forEach { $0() }
        }
        if persistent { restore() }
    }

    // MARK: Pages

    private func configuration(remote: Bool) -> WKWebViewConfiguration {
        if let made = remote ? remoteConfiguration : localConfiguration { return made }
        let c = WKWebViewConfiguration()
        c.websiteDataStore = dataStore
        c.preferences.setValue(true, forKey: "developerExtrasEnabled")
        c.preferences.javaScriptCanOpenWindowsAutomatically = true
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        c.applicationNameForUserAgent = "Version/\(major >= 26 ? major : 18).0 Safari/605.1.15"
        c.userContentController.addUserScript(WKUserScript(source: BrowserScript.console, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        c.userContentController.add(WeakMessages(self), name: "paseoBrowserLog")
        if remote, let rules { c.userContentController.add(rules) }
        if remote { remoteConfiguration = c } else { localConfiguration = c }
        return c
    }

    /// Run once pages of agents on other hosts can be made: their rules are compiled (or couldn't be,
    /// and their pages are refused instead).
    private func whenReady(remote: Bool, _ run: @escaping () -> Void) {
        if !remote || rules != nil || rulesFailed { run() } else { rulesWaiting.append(run) }
    }

    /// A tab's web view, made and set in place the first time it is needed.
    @discardableResult
    private func live(_ tab: AgentTab) -> WKWebView? {
        if let web = tab.page.web { return web }
        // Without its rules a remote agent's page could load this Mac's addresses: it gets no page.
        if tab.remote, rules == nil { tab.failure = "This Mac couldn't set up the browser for agents on other hosts."; return nil }
        let web = tab.page.load(configuration(remote: tab.remote)) { web in
            web.navigationDelegate = self
            web.uiDelegate = self
            let occlusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
            if drawsWhileCovered, web.responds(to: occlusion) { web.perform(occlusion, with: false) }
        }
        seat(tab)
        return web
    }

    /// Put a tab's page where it belongs: in the stage if it is the shown browser's current tab, else parked.
    private func seat(_ tab: AgentTab) {
        guard let web = tab.page.web else { return }
        let shows = shownTab === tab
        let home: NSView = shows ? stage : parking
        if web.superview !== home {
            let hadKeys = (web.window?.firstResponder as? NSView).map { $0 === web || $0.isDescendant(of: web) } ?? false
            web.removeFromSuperview()
            home.addSubview(web)
            if hadKeys, !shows, let pageView { pageView.window?.makeFirstResponder(pageView) }
        }
        if shows {
            web.autoresizingMask = [.width, .height]
            if web.frame != stage.bounds { web.frame = stage.bounds }
        } else {
            web.autoresizingMask = []
            let frame = CGRect(origin: .zero, size: tab.viewport)
            if web.frame != frame { web.frame = frame }
        }
    }

    private var shownBrowser: AgentBrowser? { placement.key.flatMap { browsers[$0] } }
    /// The tab whose page is in the stage: the placed browser's current one, while the box shows and it loaded.
    private var shownTab: AgentTab? {
        guard placement.visible(commandShows: commandShows), let tab = shownBrowser?.current, tab.failure == nil else { return nil }
        return tab
    }

    private func browser(_ host: String, _ agent: String, workspace: String?) -> AgentBrowser {
        let key = AgentBrowser.key(host, agent)
        if let held = browsers[key] {
            if let workspace { held.workspace = workspace }
            return held
        }
        let made = AgentBrowser(host: host, agent: agent, workspace: workspace)
        browsers[key] = made
        return made
    }

    private func find(_ id: String?) -> (AgentBrowser, AgentTab)? {
        guard let id else { return nil }
        for browser in browsers.values { if let tab = browser.tabs.first(where: { $0.id == id }) { return (browser, tab) } }
        return nil
    }

    /// Open a tab in an agent's browser. `select`: it becomes the one that shows.
    @discardableResult
    func open(host: String, agent: String, workspace: String?, url: URL?, select: Bool) -> AgentTab {
        let browser = browser(host, agent, workspace: workspace)
        let tab = AgentTab(page: BrowserTab(url: url, title: nil), host: host, agent: agent, workspace: workspace ?? browser.workspace)
        tab.page.onChange = { [weak self] in self?.changed() }
        browser.tabs.append(tab)
        browser.used = Date()
        if select || browser.current == nil { browser.current = tab }
        whenReady(remote: tab.remote) { [weak self] in
            guard let self, self.find(tab.id) != nil else { return }
            self.live(tab)
            self.arrange()
        }
        trim()
        changed()
        return tab
    }

    func close(_ tab: AgentTab) {
        guard let (browser, _) = find(tab.id), let at = browser.tabs.firstIndex(where: { $0 === tab }) else { return }
        browser.tabs.remove(at: at)
        if browser.current === tab { browser.current = browser.tabs.isEmpty ? nil : browser.tabs[min(at, browser.tabs.count - 1)] }
        resolve(tab, "The tab was closed.")
        let hadKeys = stage.hasKeyFocus
        tab.page.onChange = nil
        tab.page.unload()
        if browser.tabs.isEmpty { browsers[browser.key] = nil }
        arrange()
        if hadKeys, shownTab == nil, let pageView { pageView.window?.makeFirstResponder(pageView) }
        changed()
    }

    /// Keep to the most recently used browsers.
    private func trim() {
        guard browsers.count > Self.maxBrowsers else { return }
        for browser in browsers.values.sorted(by: { $0.used < $1.used }).prefix(browsers.count - Self.maxBrowsers) where browser.key != placement.key {
            for tab in browser.tabs { tab.page.onChange = nil; tab.page.unload() }
            browsers[browser.key] = nil
        }
    }

    // MARK: Where it shows

    /// Follow the page: its box and whose browser is in it, and whether the map's side shows.
    func place(_ next: BrowserPlacement? = nil, commandShows: Bool? = nil) {
        if let next { placement = next }
        if let commandShows { self.commandShows = commandShows }
        arrange()
    }

    private func arrange() {
        let tab = shownTab
        if let tab, let pageView, let parent = stage.superview {
            let frame = EditorStage.frame(of: placement.rect, in: pageView, to: parent).integral
            if stage.frame != frame { stage.frame = frame }
            live(tab)
            if stage.isHidden { stage.isHidden = false }
            stage.cut(placement.holes.map { $0.offsetBy(dx: -placement.rect.minX, dy: -placement.rect.minY) })
        } else if !stage.isHidden {
            let hadKeys = stage.hasKeyFocus
            stage.isHidden = true
            if hadKeys, let pageView { pageView.window?.makeFirstResponder(pageView) }
        }
        for browser in browsers.values { for tab in browser.tabs { seat(tab) } }
    }

    var hasKeyFocus: Bool { stage.hasKeyFocus }

    /// Give the shown page the keyboard.
    func focus() {
        guard let web = shownTab?.page.web else { return }
        web.window?.makeFirstResponder(web)
    }

    /// Keys the browser takes while its page has the keyboard; the rest are the page's, or the app's.
    private func key(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, event.modifierFlags.intersection([.command, .shift, .control, .option]) == .command,
              let key = event.charactersIgnoringModifiers?.lowercased(), let tab = shownTab else { return false }
        switch key {
        case "r": tab.page.web?.reload()
        case "[": tab.page.web?.goBack()
        case "]": tab.page.web?.goForward()
        case "l": tell(["type": "key", "action": "address"])
        case "t": tell(["type": "key", "action": "new"])
        case "w": close(tab)
        default: return false
        }
        return true
    }

    // MARK: The page's commands

    /// `browserDo` from the page: the tab strip and address bar it draws.
    func perform(_ body: [String: Any]) {
        guard let action = body["action"] as? String else { return }
        let host = (body["host"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "local"
        let tab = find(body["tab"] as? String)?.1
        switch action {
        case "open":
            guard let agent = body["agent"] as? String, !agent.isEmpty, agent.count <= 400 else { return }
            var url: URL?
            if let typed = body["url"] as? String, !typed.isEmpty {
                guard let destination = BrowserPolicy.destination(typed) else { return refuse("That isn't a web address.") }
                if let why = BrowserPolicy.refusal(destination, host: host) { return refuse(why) }
                url = destination
            }
            if (browsers[AgentBrowser.key(host, agent)]?.tabs.count ?? 0) >= Self.maxTabs { return refuse("This agent's browser has \(Self.maxTabs) tabs open. Close one first.") }
            open(host: host, agent: agent, workspace: body["workspace"] as? String, url: url, select: true)
        case "navigate":
            guard let tab, let typed = body["url"] as? String else { return }
            guard let destination = BrowserPolicy.destination(typed) else { return refuse("That isn't a web address.") }
            if let why = BrowserPolicy.refusal(destination, host: tab.host) { return refuse(why) }
            tab.failure = nil
            if live(tab) == nil { return refuse(tab.failure ?? "The page couldn't open.") }
            tab.page.web?.load(URLRequest(url: destination))
            arrange()
        case "back": tab?.page.web?.goBack()
        case "forward": tab?.page.web?.goForward()
        case "reload":
            guard let tab else { return }
            if tab.failure != nil, let url = tab.page.url { tab.failure = nil; live(tab)?.load(URLRequest(url: url)); arrange() } else { tab.page.web?.reload() }
        case "stop": tab?.page.web?.stopLoading()
        case "close": if let tab { close(tab) }
        case "select":
            guard let tab, let (browser, _) = find(tab.id) else { return }
            browser.current = tab
            browser.used = Date()
            arrange()
        case "focus": focus()
        default: return
        }
        changed()
    }

    private func refuse(_ message: String) { tell(["type": "refused", "message": message]) }

    // MARK: State

    private func changed() {
        if !publishing {
            publishing = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.publishing = false
                self.tell(self.pageState())
            }
        }
        guard persistent else { return }
        saving?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.save() }
        saving = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
    }

    /// Tell the page how things stand now (it asked, or it loaded).
    func publish() { tell(pageState()) }

    private func pageState() -> [String: Any] {
        var out: [String: Any] = [:]
        for browser in browsers.values {
            out[browser.key] = [
                "host": browser.host, "agent": browser.agent, "current": browser.current?.id ?? "",
                "tabs": browser.tabs.map { tab -> [String: Any] in
                    var d: [String: Any] = ["id": tab.id, "url": tab.page.url?.absoluteString ?? "", "title": tab.page.title, "loading": tab.page.isLoading,
                                            "back": tab.page.web?.canGoBack ?? false, "forward": tab.page.web?.canGoForward ?? false]
                    if let failure = tab.failure { d["error"] = failure }
                    return d
                },
            ]
        }
        return ["type": "state", "browsers": out, "hosting": ["enabled": hosting, "connected": connected, "hosts": hostStates]]
    }

    /// For `--info` (checks).
    func state() -> [String: Any] {
        ["browsers": browsers.values.sorted { $0.key < $1.key }.map { browser -> [String: Any] in
            ["key": browser.key, "current": browser.current?.id ?? "", "workspace": browser.workspace ?? "",
             "tabs": browser.tabs.map { ["id": $0.id, "url": $0.address, "title": $0.page.title, "loaded": $0.page.web != nil, "loading": $0.page.isLoading,
                                         "in": $0.page.web?.superview === stage ? "stage" : $0.page.web?.superview === parking ? "parking" : "none",
                                         "error": $0.failure ?? "", "console": $0.console.count] as [String: Any] }]
        },
         "shown": shownTab?.id ?? "", "placed": placement.key ?? "", "stageHidden": stage.isHidden, "stageFrame": NSStringFromRect(stage.frame),
         "holes": stage.holes.map { NSStringFromRect($0) }, "keys": hasKeyFocus,
         "hosting": ["enabled": hosting, "connected": connected, "hosts": hostStates], "handled": handled]
    }

    private func save() {
        let kept = browsers.values.filter { !$0.tabs.isEmpty }.map { browser -> [String: Any] in
            ["host": browser.host, "agent": browser.agent, "workspace": browser.workspace ?? "", "current": browser.current?.id ?? "",
             "used": browser.used.timeIntervalSince1970,
             "tabs": browser.tabs.compactMap { tab -> [String: Any]? in
                 guard let url = tab.page.url, ["http", "https"].contains(url.scheme ?? "") else { return nil }
                 return ["id": tab.id, "url": url.absoluteString, "title": tab.page.title, "workspace": tab.workspace ?? ""]
             }]
        }
        UserDefaults.standard.set(["browsers": kept], forKey: Self.defaultsKey)
    }

    /// Last launch's tabs, unloaded: each makes its page when it is shown or an agent uses it.
    private func restore() {
        let saved = (UserDefaults.standard.dictionary(forKey: Self.defaultsKey)?["browsers"] as? [[String: Any]]) ?? []
        for entry in saved.prefix(Self.maxBrowsers) {
            guard let host = entry["host"] as? String, let agent = entry["agent"] as? String, !host.isEmpty, !agent.isEmpty else { continue }
            let text = { (d: [String: Any], key: String) in (d[key] as? String).flatMap { $0.isEmpty ? nil : $0 } }
            let browser = AgentBrowser(host: host, agent: agent, workspace: text(entry, "workspace"))
            browser.used = Date(timeIntervalSince1970: entry["used"] as? Double ?? 0)
            for t in (entry["tabs"] as? [[String: Any]] ?? []).prefix(Self.maxTabs) {
                guard let id = text(t, "id"), UUID(uuidString: id) != nil, let url = text(t, "url").flatMap(URL.init(string:)),
                      BrowserPolicy.refusal(url, host: host) == nil else { continue }
                let tab = AgentTab(id: id, page: BrowserTab(url: url, title: text(t, "title")), host: host, agent: agent, workspace: text(t, "workspace") ?? browser.workspace)
                tab.page.onChange = { [weak self] in self?.changed() }
                browser.tabs.append(tab)
            }
            guard !browser.tabs.isEmpty else { continue }
            browser.current = browser.tabs.first { $0.id == entry["current"] as? String } ?? browser.tabs.first
            browsers[browser.key] = browser
        }
    }

    // MARK: Hosting

    /// Settings → Map: agents' browser tools open and drive tabs here. Off, the socket closes and the
    /// daemons are told nothing; the tabs stay.
    func setHosting(_ on: Bool) {
        guard on != hosting else { return }
        hosting = on
        retries = 0
        if on { connect() } else { disconnect() }
        changed()
    }

    private func connect() {
        retry?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        let base = server()
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.scheme = base.scheme == "https" ? "wss" : "ws"
        components.path = "/api/browser-host"
        components.query = nil
        var request = URLRequest(url: components.url!)
        // The server takes the socket from its own page's origin only.
        request.setValue("\(base.scheme ?? "http")://\(base.host ?? "127.0.0.1")\(base.port.map { ":\($0)" } ?? "")", forHTTPHeaderField: "Origin")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 16 * 1024 * 1024
        socket = task
        task.resume()
        receive(task)
    }

    private func disconnect() {
        retry?.cancel()
        let task = socket
        socket = nil
        connected = false
        hostStates = []
        task?.cancel(with: .normalClosure, reason: nil)
    }

    private func dropped(_ task: URLSessionWebSocketTask) {
        guard task === socket else { return }
        socket = nil
        connected = false
        hostStates = []
        changed()
        guard hosting else { return }
        retries += 1
        let work = DispatchWorkItem { [weak self] in if self?.hosting == true, self?.socket == nil { self?.connect() } }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + min(15, Double(retries) * 2), execute: work)
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self, weak task] result in
            guard let self, let task, task === self.socket else { return }
            switch result {
            case .success(.string(let text)):
                if let message = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] { self.received(message) }
                self.receive(task)
            case .success: self.receive(task)
            case .failure: self.dropped(task)
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === socket else { return }
        connected = true
        retries = 0
        post(["type": "hello", "commands": BrowserRequest.commands])
        changed()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        dropped(webSocketTask)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let task = task as? URLSessionWebSocketTask { dropped(task) }
    }

    private func post(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) else { return }
        socket?.send(.string(text)) { _ in }
    }

    private func received(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "hosts":
            hostStates = (message["hosts"] as? [[String: Any]] ?? []).map { host in
                var out: [String: Any] = ["host": host["host"] as? String ?? "", "state": host["state"] as? String ?? ""]
                if let error = host["error"] as? String { out["error"] = String(error.prefix(300)) }
                return out
            }
            changed()
        case "request":
            guard let request = BrowserRequest(message) else {
                // Still answered, so the agent's call doesn't hang until the daemon gives up on it.
                if let id = (message["request"] as? [String: Any])?["requestId"] as? String {
                    post(["type": "response", "payload": ["requestId": id, "ok": false,
                                                           "error": ["code": "browser_unsupported", "message": "Paseo Command's browser doesn't run that.", "retryable": false]]])
                }
                return
            }
            execute(request) { [weak self] answer in self?.post(answer) }
        default: break
        }
    }

    // MARK: Agents' commands

    private typealias Done = (Result<[String: Any], BrowserFailure>) -> Void

    /// Run one of an agent's browser tool calls; `answer` gets the relay's response message.
    func execute(_ request: BrowserRequest, answer: @escaping ([String: Any]) -> Void) {
        let tab = request.tab.flatMap { tab(for: request, id: $0) }
        tab?.busy += 1
        var answered = false
        let done: Done = { [weak self] result in
            guard !answered else { return }
            answered = true
            tab?.busy -= 1
            let dialogs = tab?.dialogs ?? []
            tab?.dialogs = []
            var note: [String: Any] = ["command": request.command, "host": request.host, "agent": request.agent ?? ""]
            switch result {
            case .success(let value):
                note["ok"] = true
                answer(request.done(value, dialogs: dialogs))
            case .failure(let failure):
                note["ok"] = false
                note["error"] = failure.code
                note["message"] = failure.message
                answer(request.failed(failure, dialogs: dialogs))
            }
            self?.handled = Array(((self?.handled ?? []) + [note]).suffix(20))
        }
        switch request.command {
        case "list_tabs":
            let tabs = browsers.values.filter { $0.host == request.host }.sorted { $0.used > $1.used }.flatMap { browser in
                browser.tabs.filter { request.workspace == nil || $0.workspace == nil || $0.workspace == request.workspace }
                    .map { $0.info(active: browser.current === $0) }
            }
            done(.success(["tabs": tabs]))
        case "new_tab": newTab(request, done)
        default:
            guard let tab else { return done(.failure(.noTab(request.tab))) }
            whenReady(remote: tab.remote) { [weak self] in
                guard let self else { return }
                guard self.find(tab.id) != nil else { return done(.failure(BrowserFailure("browser_tab_closed", "That browser tab was closed."))) }
                guard self.live(tab) != nil else { return done(.failure(.denied(tab.failure ?? "The page couldn't open."))) }
                self.run(request, on: tab, done)
            }
        }
    }

    /// The tab a request names, if it is one its agent may use: on its host, in its workspace.
    private func tab(for request: BrowserRequest, id: String) -> AgentTab? {
        guard let (_, tab) = find(id), tab.host == request.host else { return nil }
        if let asked = request.workspace, let has = tab.workspace, asked != has { return nil }
        return tab
    }

    private func newTab(_ request: BrowserRequest, _ done: @escaping Done) {
        guard let agent = request.agent else { return done(.failure(.unknown("browser_new_tab needs the agent that asks."))) }
        var url: URL?
        if let text = request.string("url") {
            guard let asked = URL(string: text) else { return done(.failure(.unknown("\(text) isn't a web address."))) }
            if let why = BrowserPolicy.refusal(asked, host: request.host) { return done(.failure(.denied(why))) }
            url = asked
        }
        if (browsers[AgentBrowser.key(request.host, agent)]?.tabs.count ?? 0) >= Self.maxTabs {
            return done(.failure(.unknown("This agent's browser already has \(Self.maxTabs) tabs open. Close one with browser_close_tab, or reuse one with browser_navigate.")))
        }
        let tab = open(host: request.host, agent: agent, workspace: request.workspace, url: url, select: false)
        tell(["type": "opened", "host": request.host, "agent": agent, "tab": tab.id])
        let result: [String: Any] = ["browserId": tab.id, "workspaceId": request.workspace ?? tab.workspace ?? "workspace", "url": url?.absoluteString ?? "about:blank"]
        guard url != nil else { return done(.success(result)) }
        // Answered once its page is in (or has had its time), so what the agent does next finds it.
        whenReady(remote: tab.remote) { [weak self] in
            self?.loaded(tab, within: 8) { _ in done(.success(result)) }
        }
    }

    private func run(_ request: BrowserRequest, on tab: AgentTab, _ done: @escaping Done) {
        guard let web = tab.page.web else { return done(.failure(.unknown("The page isn't loaded."))) }
        let id: [String: Any] = ["browserId": tab.id]
        let ref = request.string("ref")
        let withRef = { (extra: [String: Any]) -> [String: Any] in
            var out = id.merging(extra) { a, _ in a }
            if let ref { out["ref"] = ref }
            return out
        }
        /// An action on the page, then a moment for what it set off (a navigation, a render).
        let act = { [weak self] (name: String, args: [String: Any], result: @escaping ([String: Any]) -> [String: Any]) in
            guard let self else { return }
            self.settle(tab, within: 6) {
                self.script(tab, name, args) { outcome in
                    switch outcome {
                    case .failure(let failure): done(.failure(failure))
                    case .success(let value):
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { self.settle(tab, within: 6) { done(.success(result(value))) } }
                    }
                }
            }
        }
        let point = { (value: [String: Any]) -> [String: Any] in value.filter { ["x", "y"].contains($0.key) } }
        switch request.command {
        case "navigate":
            guard let text = request.string("url"), let url = URL(string: text) else { return done(.failure(.unknown("browser_navigate needs a web address."))) }
            if let why = BrowserPolicy.refusal(url, host: tab.host) { return done(.failure(.denied(why))) }
            tab.failure = nil
            web.load(URLRequest(url: url))
            arrange()
            loaded(tab, within: 12) { error in
                if let error { return done(.failure(.unknown("\(text) didn't load: \(error)"))) }
                done(.success(id.merging(["url": tab.address]) { a, _ in a }))
            }
        case "back", "forward":
            let back = request.command == "back"
            guard back ? web.canGoBack : web.canGoForward else { return done(.failure(.unknown("There is no page to go \(back ? "back" : "forward") to."))) }
            if back { web.goBack() } else { web.goForward() }
            loaded(tab, within: 6) { _ in done(.success(id)) }
        case "reload":
            web.reload()
            loaded(tab, within: 12) { _ in done(.success(id)) }
        case "close_tab":
            close(tab)
            done(.success(id))
        case "resize":
            guard let width = request.number("width"), let height = request.number("height") else { return done(.failure(.unknown("browser_resize needs a width and a height."))) }
            tab.viewport = CGSize(width: min(4000, max(200, width)), height: min(4000, max(200, height)))
            seat(tab)
            done(.success(id.merging(["width": Int(tab.viewport.width), "height": Int(tab.viewport.height)]) { a, _ in a }))
        case "snapshot":
            settle(tab, within: 6) { [weak self] in
                self?.script(tab, "snapshot", [:]) { outcome in
                    done(outcome.map { value in
                        var out = id.merging(value) { a, _ in a }
                        out["format"] = "aria-yaml"
                        if let workspace = tab.workspace { out["workspaceId"] = workspace }
                        return out
                    })
                }
            }
        case "click":
            act("click", ["ref": ref ?? "", "button": request.string("button") ?? "left", "doubleClick": request.flag("doubleClick"),
                          "modifiers": request.args["modifiers"] as? [String] ?? []]) { withRef(point($0)) }
        case "fill": act("fill", ["ref": ref ?? "", "value": request.string("value") ?? ""]) { _ in withRef([:]) }
        case "type":
            var args: [String: Any] = ["text": request.string("text") ?? ""]
            if let ref { args["ref"] = ref }
            act("type", args) { withRef(point($0)) }
        case "keypress":
            guard let spec = request.string("key"), let key = BrowserKey(spec) else {
                return done(.failure(.unknown("\(request.string("key") ?? "That") isn't a key. Name one as Enter, Tab, Escape, ArrowDown, a, or with modifiers: Control+A, Meta+K, Shift+Tab.")))
            }
            var args: [String: Any] = ["key": key.key, "modifiers": key.modifiers]
            if let ref { args["ref"] = ref }
            act("keypress", args) { withRef(point($0).merging(["key": spec]) { a, _ in a }) }
        case "select": act("select", ["ref": ref ?? "", "value": request.string("value") ?? ""]) { withRef(["value": $0["value"] as? String ?? request.string("value") ?? ""]) }
        case "hover": act("hover", ["ref": ref ?? ""]) { withRef(point($0)) }
        case "drag":
            let source = request.string("sourceRef") ?? "", target = request.string("targetRef") ?? ""
            act("drag", ["sourceRef": source, "targetRef": target]) { value in
                id.merging(["sourceRef": source, "targetRef": target]) { a, _ in a }.merging(value.filter { $0.key.hasSuffix("X") || $0.key.hasSuffix("Y") }) { a, _ in a }
            }
        case "scroll":
            let dx = request.number("deltaX") ?? 0, dy = request.number("deltaY") ?? 0
            var args: [String: Any] = ["deltaX": dx, "deltaY": dy]
            if let ref { args["ref"] = ref }
            act("scroll", args) { withRef(point($0).merging(["deltaX": dx, "deltaY": dy]) { a, _ in a }) }
        case "wait": wait(request, tab, done)
        case "logs":
            let max = min(200, max(1, Int(request.number("maxEntries") ?? 50)))
            script(tab, "network", ["max": max]) { outcome in
                let network = (try? outcome.get())?["list"] as? [[String: Any]] ?? []
                done(.success(id.merging(["console": Array(tab.console.suffix(max)), "network": network]) { a, _ in a }))
            }
        case "evaluate": evaluate(request, tab, web, done)
        case "screenshot": screenshot(tab, web, fullPage: request.flag("fullPage")) { done($0.map { id.merging($0) { a, _ in a } }) }
        case "upload": upload(request, tab, done)
        default: done(.failure(BrowserFailure("browser_unsupported", "Paseo Command's browser doesn't run \(request.command).")))
        }
    }

    /// Run one of the page script's actions; its value (a list comes back under `list`).
    private func script(_ tab: AgentTab, _ name: String, _ args: [String: Any], _ done: @escaping Done) {
        guard let web = tab.page.web else { return done(.failure(.unknown("The page isn't loaded."))) }
        web.callAsyncJavaScript(BrowserScript.call(name), arguments: ["args": args], in: nil, in: .page) { result in
            switch result {
            case .failure(let error):
                done(.failure(.unknown("The page couldn't do that: \((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)")))
            case .success(let value):
                guard let answer = value as? [String: Any] else { return done(.failure(.unknown("The page didn't answer."))) }
                if answer["ok"] as? Bool == true {
                    if let dictionary = answer["value"] as? [String: Any] { done(.success(dictionary)) }
                    else if let list = answer["value"] as? [Any] { done(.success(["list": list])) }
                    else if let flag = answer["value"] as? Bool { done(.success(["flag": flag])) }
                    else { done(.success([:])) }
                } else {
                    done(.failure(BrowserFailure(answer["code"] as? String ?? "browser_unknown_error", answer["message"] as? String ?? "")))
                }
            }
        }
    }

    private func wait(_ request: BrowserRequest, _ tab: AgentTab, _ done: @escaping Done) {
        let text = request.string("text"), url = request.string("url")
        let deadline = Date().addingTimeInterval(min(30, max(0.1, (request.number("timeoutMs") ?? 5000) / 1000)))
        func look() {
            guard find(tab.id) != nil else { return done(.failure(BrowserFailure("browser_tab_closed", "That browser tab was closed."))) }
            let again = {
                guard Date() < deadline else {
                    return done(.failure(BrowserFailure("browser_timeout", "The page didn't \(url != nil ? "reach an address with “\(url ?? "")”" : "show “\(text ?? "")”") in time. It is at \(tab.address).")))
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { look() }
            }
            if let url {
                if tab.address.contains(url) { return done(.success(["browserId": tab.id, "matched": "url"])) }
                return again()
            }
            script(tab, "has", ["text": text ?? ""]) { outcome in
                if (try? outcome.get())?["flag"] as? Bool == true { done(.success(["browserId": tab.id, "matched": "text"])) } else { again() }
            }
        }
        look()
    }

    private func evaluate(_ request: BrowserRequest, _ tab: AgentTab, _ web: WKWebView, _ done: @escaping Done) {
        guard let function = request.string("function") else { return done(.failure(.unknown("browser_evaluate needs a function."))) }
        settle(tab, within: 6) {
            web.callAsyncJavaScript(BrowserScript.evaluate, arguments: ["fn": function, "ref": request.string("ref") as Any? ?? NSNull()], in: nil, in: .page) { result in
                switch result {
                case .failure(let error):
                    let info = (error as NSError).userInfo
                    let message = info["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
                    let stale = message.contains("is not in the latest snapshot")
                    done(.failure(BrowserFailure(stale ? "browser_stale_ref" : "browser_unknown_error", stale ? message : "The function threw: \(message)")))
                case .success(let value):
                    let json = value as? String ?? "null"
                    let limit = 100_000
                    done(.success(["browserId": tab.id, "resultJson": json.count > limit ? String(json.prefix(limit)) : json, "truncated": json.count > limit]))
                }
            }
        }
    }

    private func screenshot(_ tab: AgentTab, _ web: WKWebView, fullPage: Bool, _ done: @escaping Done) {
        let take = { (restore: @escaping () -> Void) in
            let configuration = WKSnapshotConfiguration()
            configuration.afterScreenUpdates = true
            web.takeSnapshot(with: configuration) { image, _ in
                restore()
                let size = image?.size ?? .zero
                // One pixel a point: enough to read, and a third of the bytes.
                guard let image, size.width >= 1, size.height >= 1,
                      let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height), bitsPerSample: 8, samplesPerPixel: 4,
                                                    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                      let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
                    return done(.failure(BrowserFailure("screenshot_no_frame", "The page has drawn nothing to photograph yet.", retryable: true)))
                }
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = context
                image.draw(in: CGRect(origin: .zero, size: size))
                NSGraphicsContext.restoreGraphicsState()
                guard let png = bitmap.representation(using: .png, properties: [:]) else {
                    return done(.failure(BrowserFailure("screenshot_no_frame", "The page's picture couldn't be made.")))
                }
                done(.success(["mimeType": "image/png", "dataBase64": png.base64EncodedString(), "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh]))
            }
        }
        settle(tab, within: 6) { [weak self] in
            guard let self, fullPage else { return take {} }
            // The whole page: its view as tall as the page for a moment (the stage clips it), then back.
            self.script(tab, "size", [:]) { outcome in
                let height = ((try? outcome.get())?["height"] as? NSNumber)?.doubleValue ?? 0
                guard height > Double(web.frame.height) + 1 else { return take {} }
                let before = web.frame, mask = web.autoresizingMask
                web.autoresizingMask = []
                web.frame = CGRect(x: before.minX, y: before.minY, width: before.width, height: min(12000, CGFloat(height)))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    take {
                        web.frame = before
                        web.autoresizingMask = mask
                    }
                }
            }
        }
    }

    private func upload(_ request: BrowserRequest, _ tab: AgentTab, _ done: @escaping Done) {
        // The paths are the agent's machine's: only this Mac's own agents name files here.
        guard request.host == "local" else {
            return done(.failure(.denied("This agent runs on another host, and its browser is on the user's Mac: it can't reach this machine's files to upload them.")))
        }
        guard let ref = request.string("ref"), let paths = request.args["filePaths"] as? [String], !paths.isEmpty, paths.count <= 10 else {
            return done(.failure(.unknown("browser_upload needs a ref and one to ten file paths.")))
        }
        var files: [[String: Any]] = []
        var total = 0
        for path in paths {
            let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : request.cwd.map { URL(fileURLWithPath: $0).appendingPathComponent(path) } ?? URL(fileURLWithPath: path)
            var directory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &directory), !directory.boolValue, let data = try? Data(contentsOf: url) else {
                return done(.failure(.unknown("\(path) isn't a file that can be read.")))
            }
            total += data.count
            guard total <= 30 * 1024 * 1024 else { return done(.failure(.unknown("Those files are over 30 MB together."))) }
            files.append(["name": url.lastPathComponent, "type": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                          "base64": data.base64EncodedString()])
        }
        settle(tab, within: 6) { [weak self] in
            self?.script(tab, "upload", ["ref": ref, "files": files]) { outcome in
                done(outcome.map { _ in ["browserId": tab.id, "ref": ref, "filePaths": paths] })
            }
        }
    }

    // MARK: Loading

    /// Call once the tab's page has finished loading (nil), failed (why), or `seconds` have gone (nil).
    private func loaded(_ tab: AgentTab, within seconds: Double, _ done: @escaping (String?) -> Void) {
        waiterIds += 1
        let id = waiterIds
        tab.waiters[id] = done
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak tab] in tab?.waiters.removeValue(forKey: id)?(nil) }
    }

    /// Call once the tab isn't loading (or `seconds` have gone).
    private func settle(_ tab: AgentTab, within seconds: Double, _ done: @escaping () -> Void) {
        guard tab.page.isLoading else { return done() }
        loaded(tab, within: seconds) { _ in done() }
    }

    private func resolve(_ tab: AgentTab, _ error: String?) {
        let waiting = tab.waiters
        tab.waiters = [:]
        for done in waiting.values { done(error) }
    }

    private func tab(of web: WKWebView?) -> AgentTab? {
        guard let web else { return nil }
        for browser in browsers.values { if let tab = browser.tabs.first(where: { $0.page.web === web }) { return tab } }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard let tab = tab(of: webView), tab.failure != nil else { return }
        tab.failure = nil
        arrange()
        changed()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let tab = tab(of: webView) else { return }
        resolve(tab, nil)
        changed()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView, error) }

    private func failed(_ webView: WKWebView, _ error: Error) {
        // Another navigation took its place: not a failure.
        guard let tab = tab(of: webView), (error as NSError).code != NSURLErrorCancelled else { return }
        // A download or a policy that stopped the frame load isn't one either.
        if (error as NSError).domain == "WebKitErrorDomain", [102, 204].contains((error as NSError).code) { return resolve(tab, tab.failure) }
        tab.failure = error.localizedDescription
        resolve(tab, error.localizedDescription)
        arrange()
        changed()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let tab = tab(of: webView) else { return }
        tab.failure = "The page stopped. Reload it."
        resolve(tab, tab.failure)
        arrange()
        changed()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let tab = tab(of: webView) else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""
        // Nil: a new window, which `createWebViewWith` makes a tab of (or doesn't).
        let main = navigationAction.targetFrame?.isMainFrame == true
        if ["about", "blob", "data"].contains(scheme) { return decisionHandler(main && scheme == "data" ? .cancel : .allow) }
        // mailto:, tel:, javascript: and the rest go nowhere.
        guard ["http", "https"].contains(scheme) else { return decisionHandler(.cancel) }
        if BrowserPolicy.refusal(url, host: tab.host) != nil {
            if main {
                tab.failure = "This agent runs on another host, so its browser doesn't open this Mac's own addresses (\(url.host ?? ""))."
                resolve(tab, tab.failure)
                arrange()
                changed()
            }
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // Nothing is downloaded: a file the page can't show stays where it is.
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    /// A page opening a window (a link to a new tab, `window.open`): another tab of the same browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let tab = tab(of: webView), let url = navigationAction.request.url, BrowserPolicy.refusal(url, host: tab.host) == nil,
              (browsers[AgentBrowser.key(tab.host, tab.agent)]?.tabs.count ?? 0) < Self.maxTabs else { return nil }
        // Shown at once when a person clicked; an agent's stays behind the tab it works in.
        open(host: tab.host, agent: tab.agent, workspace: tab.workspace, url: url, select: tab.busy == 0 && shownTab === tab)
        arrange()
        return nil
    }

    // MARK: Dialogs

    private func noted(_ tab: AgentTab, _ type: String, _ message: String, accepted: Bool, text: String? = nil, defaultValue: String? = nil) {
        var entry: [String: Any] = ["type": type, "message": String(message.prefix(2000)), "action": accepted ? "accepted" : "dismissed",
                                    "timestamp": Int(Date().timeIntervalSince1970 * 1000)]
        if let text { entry["promptText"] = text }
        if let defaultValue { entry["defaultValue"] = defaultValue }
        tab.dialogs = Array((tab.dialogs + [entry]).suffix(20))
    }

    /// Ask the person, when the tab is the one on screen and no agent is using it; else nil (answer for them).
    private func ask(_ tab: AgentTab, _ message: String, buttons: [String], field: String? = nil, _ answer: @escaping (Bool, String?) -> Void) -> Bool {
        guard tab.busy == 0, shownTab === tab, let window = stage.window else { return false }
        let alert = NSAlert()
        alert.messageText = tab.page.url?.host ?? "This page"
        alert.informativeText = message
        for title in buttons { alert.addButton(withTitle: title) }
        var input: NSTextField?
        if let field {
            let box = NSTextField(frame: CGRect(x: 0, y: 0, width: 260, height: 24))
            box.stringValue = field
            alert.accessoryView = box
            input = box
        }
        alert.beginSheetModal(for: window) { response in answer(response == .alertFirstButtonReturn, input?.stringValue) }
        return true
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let tab = tab(of: webView) else { return completionHandler() }
        if ask(tab, message, buttons: ["OK"], { _, _ in completionHandler() }) { return }
        noted(tab, "alert", message, accepted: true)
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let tab = tab(of: webView) else { return completionHandler(false) }
        if ask(tab, message, buttons: ["OK", "Cancel"], { ok, _ in completionHandler(ok) }) { return }
        // An agent at work chose what raised it; a page nobody is using is told no.
        let accept = tab.busy > 0
        noted(tab, "confirm", message, accepted: accept)
        completionHandler(accept)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard let tab = tab(of: webView) else { return completionHandler(nil) }
        if ask(tab, prompt, buttons: ["OK", "Cancel"], field: defaultText ?? "", { ok, text in completionHandler(ok ? text ?? "" : nil) }) { return }
        let accept = tab.busy > 0
        noted(tab, "prompt", prompt, accepted: accept, text: accept ? defaultText ?? "" : nil, defaultValue: defaultText)
        completionHandler(accept ? defaultText ?? "" : nil)
    }

    // MARK: Console

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "paseoBrowserLog", let tab = tab(of: message.webView), let body = message.body as? [String: Any] else { return }
        var entry: [String: Any] = ["level": String((body["level"] as? String ?? "log").prefix(20)), "message": String((body["message"] as? String ?? "").prefix(4000)),
                                    "timestamp": (body["at"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970 * 1000]
        if let source = body["source"] as? String, !source.isEmpty { entry["source"] = String(source.prefix(500)) }
        if let line = (body["line"] as? NSNumber)?.intValue, line > 0 { entry["line"] = line }
        tab.console = Array((tab.console + [entry]).suffix(200))
    }
}

/// The content controller keeps its handler alive; this lets the browser go.
private final class WeakMessages: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
