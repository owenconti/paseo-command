import AppKit

/// Whether the running copy's bundle is still on disk, and where another copy is
/// when it isn't. A copy keeps running from memory after its bundle is deleted or
/// moved (an archived workspace's build, an app dragged to the Trash), but can't
/// start its server again or relaunch.
enum BundleHome {
    /// The copy's bundle, its Node or its server that is gone: nil while all are there.
    static func missing(in app: URL, exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }) -> String? {
        let found = ServerManager.resources(in: app)
        return [app.path, found.node.path, found.server.path].first { !exists($0) }
    }

    /// The error a start or restart reports for a missing bundle.
    struct Gone: LocalizedError {
        /// Where the copy was.
        let app: URL
        var errorDescription: String? {
            "This copy of \(AppFlavor.name) was deleted or moved from \(app.path), so it can’t restart."
        }
    }

    /// Another whole copy to open in place of `app`: a dev copy's is its main checkout's
    /// build (never another workspace's); the release's is in /Applications or
    /// ~/Applications, else wherever Launch Services has it (`registered`).
    static func replacement(for app: URL, isRelease: Bool, mainCheckout: String?, registered: [URL],
                            home: String = NSHomeDirectory(), whole: (URL) -> Bool) -> URL? {
        let candidates: [URL]
        if isRelease {
            candidates = ["/Applications", home + "/Applications"].map { URL(fileURLWithPath: $0).appendingPathComponent("Paseo Command.app") } + registered
        } else {
            candidates = mainCheckout.map { [URL(fileURLWithPath: $0).appendingPathComponent("native/build/Paseo Command Dev.app")] } ?? []
        }
        let own = app.standardizedFileURL.path
        return candidates.first { $0.standardizedFileURL.path != own && whole($0) }
    }

    /// This copy's replacement, from its Info.plist (read at launch, so known even
    /// with the bundle gone) and Launch Services.
    static func replacement() -> URL? {
        let registered = Bundle.main.bundleIdentifier.map { NSWorkspace.shared.urlsForApplications(withBundleIdentifier: $0) } ?? []
        return replacement(for: Bundle.main.bundleURL, isRelease: AppFlavor.isRelease, mainCheckout: AppFlavor.mainCheckout,
                           registered: registered, whole: { missing(in: $0) == nil })
    }
}
