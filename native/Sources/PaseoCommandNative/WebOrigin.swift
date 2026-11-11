import Foundation

/// Match scheme, host and effective port; only the configured app origin may
/// navigate the privileged web view or send messages through its native bridge.
enum WebOrigin {
    static func matches(scheme: String, host: String, port: Int, to expected: URL) -> Bool {
        guard let expectedScheme = expected.scheme?.lowercased(),
              ["http", "https"].contains(expectedScheme),
              scheme.lowercased() == expectedScheme,
              host.lowercased() == expected.host?.lowercased() else { return false }
        let defaultPort = expectedScheme == "https" ? 443 : 80
        return (port == 0 ? defaultPort : port) == (expected.port ?? defaultPort)
    }

    /// A frame's inline document: an `<iframe srcdoc>` the page itself wrote (a visual reply's sandboxed
    /// page). It loads nothing from anywhere, so it may load; a frame going to any other address is not this.
    static func inlineFrame(_ url: URL?, mainFrame: Bool) -> Bool {
        !mainFrame && url?.absoluteString == "about:srcdoc"
    }

    static func matches(_ url: URL?, to expected: URL) -> Bool {
        guard let url, let scheme = url.scheme, let host = url.host else { return false }
        return matches(scheme: scheme, host: host, port: url.port ?? 0, to: expected)
    }
}
