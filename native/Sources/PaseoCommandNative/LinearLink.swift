import AppKit

/// Linear's links (the chat, Conquer pages, the header's issue chip, Activity's Linear items) open in
/// Linear's desktop app when it's installed: Linear documents `linear://` followed by the rest of the
/// page's address as opening that page in the app. Launch Services says whether an app handles the
/// scheme; nothing is ever installed, and no other app is launched. Without it, they open as other
/// links do (Conquer).
enum LinearLink {
    /// The desktop app's address for a linear.app issue or project page
    /// (`https://linear.app/<workspace>/issue/<KEY>…` → `linear://<workspace>/issue/<KEY>…`); nil for
    /// any other address, Linear's own other pages too (its docs, settings, sign in).
    static func appURL(for url: URL) -> URL? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host?.lowercased() == "linear.app",
              url.user == nil, url.password == nil, url.port == nil else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        func matches(_ text: String, _ pattern: String) -> Bool {
            text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
        }
        guard parts.count >= 3, matches(parts[0], "^[a-z0-9][a-z0-9-]{0,63}$") else { return nil }
        let page = parts[1] == "issue" && matches(parts[2], "^[a-z][a-z0-9]{0,9}-[0-9]{1,7}$")
            || parts[1] == "project" && matches(parts[2], "^[A-Za-z0-9-]{1,200}$")
        guard page, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        c.scheme = "linear"
        c.host = parts[0]
        c.percentEncodedPath = "/" + c.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true).dropFirst().joined(separator: "/")
        return c.url
    }

    /// Opens a Linear link in Linear's desktop app, when it's installed; false (nothing done) otherwise.
    static func openInApp(_ url: URL) -> Bool {
        guard let app = appURL(for: url), NSWorkspace.shared.urlForApplication(toOpen: app) != nil else { return false }
        NSWorkspace.shared.open(app)
        return true
    }
}
