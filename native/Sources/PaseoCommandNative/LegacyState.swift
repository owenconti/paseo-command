import Foundation

/// The released app has a new bundle id, and with it new preferences and WebKit
/// folders. Once, this carries the old app's Conquer tabs and zooms (preferences),
/// the page's localStorage and the Conquer cookie store (WebKit, HTTPStorages) over
/// to it. It copies; the old app's data is never moved or deleted.
enum LegacyState {
    static let oldBundleID = "local.paseo.command.native"
    private static let doneKey = "legacyStateMigrated"

    /// Runs before any web view or preference read. The caller limits it to the
    /// release flavour; `home`, `defaults` and the rest are parameters for tests.
    static func migrate(
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        defaults: UserDefaults = .standard,
        oldPreferences: [String: Any]? = UserDefaults.standard.persistentDomain(forName: oldBundleID),
        newBundleID: String = Bundle.main.bundleIdentifier ?? ""
    ) {
        guard !defaults.bool(forKey: doneKey), !newBundleID.isEmpty, newBundleID != oldBundleID else { return }
        defer { defaults.set(true, forKey: doneKey) }

        if let old = oldPreferences {
            var copied = 0
            for (key, value) in old where defaults.object(forKey: key) == nil {
                defaults.set(value, forKey: key)
                copied += 1
            }
            if copied > 0 { Log.line("carried \(copied) preferences over from \(oldBundleID)") }
        }

        let library = home.appendingPathComponent("Library", isDirectory: true)
        for (folder, suffix) in [("WebKit", ""), ("HTTPStorages", ""), ("HTTPStorages", ".binarycookies")] {
            let from = library.appendingPathComponent(folder).appendingPathComponent(oldBundleID + suffix)
            let to = library.appendingPathComponent(folder).appendingPathComponent(newBundleID + suffix)
            let fm = FileManager.default
            guard fm.fileExists(atPath: from.path), !fm.fileExists(atPath: to.path) else { continue }
            do {
                try fm.copyItem(at: from, to: to)
                Log.line("copied \(folder)/\(from.lastPathComponent) to \(to.lastPathComponent)")
            } catch {
                Log.line("could not copy \(from.path): \(error.localizedDescription)")
            }
        }
    }
}
