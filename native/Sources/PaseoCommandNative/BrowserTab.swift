import AppKit
import WebKit

/// One page of an agent's browser (`BoardBrowser`). A tab can be unloaded (one from the last launch not
/// yet shown): it keeps its address, title and
/// icon, and makes its web view the first time it is shown.
final class BrowserTab: NSObject {
    private(set) var web: WKWebView?
    /// Where a pinned tab belongs (Back to Pinned Page returns there); nil when it isn't pinned.
    var home: URL?
    var favicon: NSImage?
    var faviconURL: URL?
    var onChange: (() -> Void)?
    private var savedURL: URL?
    private var savedTitle: String?
    private var watches: [NSKeyValueObservation] = []

    init(web: WKWebView) {
        super.init()
        attach(web)
    }

    init(url: URL?, title: String?) {
        savedURL = url
        savedTitle = title
        super.init()
    }

    var isPinned: Bool { home != nil }
    var url: URL? { web?.url ?? savedURL }
    var title: String {
        if let t = web?.title, !t.isEmpty { return t }
        if let t = savedTitle, !t.isEmpty, web?.url == nil || web?.url == savedURL { return t }
        return url?.host ?? "New Tab"
    }
    var isLoading: Bool { web?.isLoading ?? false }

    /// Its web view, made (and its address loaded) the first time it is needed;
    /// `prepare` sets it up before anything loads.
    func load(_ configuration: WKWebViewConfiguration, prepare: (WKWebView) -> Void) -> WKWebView {
        if let web { return web }
        let web = TabWebView(frame: .zero, configuration: configuration)
        attach(web)
        prepare(web)
        if let savedURL { web.load(URLRequest(url: savedURL)) }
        return web
    }

    /// Let its page go (a closed pinned tab): it keeps its place, address and title.
    func unload() {
        guard let web else { return }
        savedURL = web.url ?? savedURL
        savedTitle = title
        watches = []
        web.stopLoading()
        web.removeFromSuperview()
        self.web = nil
        onChange?()
    }

    private func attach(_ web: WKWebView) {
        web.isInspectable = true
        web.allowsBackForwardNavigationGestures = true
        web.allowsMagnification = true
        self.web = web
        let changed = { [weak self] in self?.onChange?() }
        watches = [
            web.observe(\.title) { _, _ in changed() },
            web.observe(\.url) { _, _ in changed() },
            web.observe(\.canGoBack) { _, _ in changed() },
            web.observe(\.canGoForward) { _, _ in changed() },
            web.observe(\.isLoading) { _, _ in changed() },
        ]
    }

    // MARK: Saved between launches

    func saved() -> [String: Any] {
        var d: [String: Any] = ["title": title]
        if let url, url.scheme?.hasPrefix("http") == true { d["url"] = url.absoluteString }
        if let home { d["home"] = home.absoluteString }
        if let faviconURL { d["icon"] = faviconURL.absoluteString }
        return d
    }

    static func restored(_ d: [String: Any]) -> BrowserTab {
        let tab = BrowserTab(url: (d["url"] as? String).flatMap(URL.init(string:)), title: d["title"] as? String)
        tab.home = (d["home"] as? String).flatMap(URL.init(string:))
        tab.faviconURL = (d["icon"] as? String).flatMap(URL.init(string:))
        return tab
    }
}


/// An agent's browser tab's web view: its context menu's "Open Link in New Window" says New Tab, as that's what it does
/// (`createWebViewWith` makes a tab), and opens it behind the tab it was in, as browsers do (`fromMenu`); nothing is
/// downloaded, so the download items go.
final class TabWebView: WKWebView {
    /// A context menu's choice is under way: the tab it opens stays behind.
    private(set) var fromMenu = false

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        for item in menu.items {
            switch item.identifier?.rawValue {
            case "WKMenuItemIdentifierOpenLinkInNewWindow": item.title = "Open Link in New Tab"
            case "WKMenuItemIdentifierOpenImageInNewWindow": item.title = "Open Image in New Tab"
            case "WKMenuItemIdentifierOpenFrameInNewWindow": item.title = "Open Frame in New Tab"
            case "WKMenuItemIdentifierDownloadLinkedFile", "WKMenuItemIdentifierDownloadImage", "WKMenuItemIdentifierDownloadMedia":
                item.isHidden = true
            default: break
            }
        }
        fromMenu = true
    }

    override func didCloseMenu(_ menu: NSMenu, with event: NSEvent?) {
        super.didCloseMenu(menu, with: event)
        // The item's action comes just after the menu closes.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.fromMenu = false }
    }
}
