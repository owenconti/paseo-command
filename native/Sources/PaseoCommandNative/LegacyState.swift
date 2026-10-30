import Foundation

/// The released app has a new bundle id, and with it new preferences and WebKit
/// folders. Once, this carries the old app's Conquer tabs and zooms (preferences),
/// the page's localStorage and the Conquer cookie store (WebKit, HTTPStorages) over
/// to it. It copies; the old app's data is never moved or deleted.
enum LegacyState {
    static let oldBundleID = "local.paseo.command.native"
    private static let doneKey = "legacyStateMigrated"

    /// Not yet migrated (the alert about a running old app is only worth showing then).
    static func pending(defaults: UserDefaults = .standard) -> Bool { !defaults.bool(forKey: doneKey) }

    /// Runs before any web view or preference read. The caller limits it to the
    /// release flavour and to when the old app isn't running; `home`, `defaults`
    /// and the rest are parameters for tests. A folder that fails to copy leaves
    /// nothing behind and the migration unfinished, so the next launch tries again.
    static func migrate(
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        defaults: UserDefaults = .standard,
        oldPreferences: [String: Any]? = UserDefaults.standard.persistentDomain(forName: oldBundleID),
        newBundleID: String = Bundle.main.bundleIdentifier ?? ""
    ) {
        guard pending(defaults: defaults), !newBundleID.isEmpty, newBundleID != oldBundleID else { return }

        // Only missing keys are set, so a retry never overwrites the new app's own.
        if let old = oldPreferences {
            var copied = 0
            for (key, value) in old where defaults.object(forKey: key) == nil {
                defaults.set(value, forKey: key)
                copied += 1
            }
            if copied > 0 { Log.line("carried \(copied) preferences over from \(oldBundleID)") }
        }

        let library = home.appendingPathComponent("Library", isDirectory: true)
        var complete = true
        for (folder, suffix) in [("WebKit", ""), ("HTTPStorages", ""), ("HTTPStorages", ".binarycookies")] {
            let from = library.appendingPathComponent(folder).appendingPathComponent(oldBundleID + suffix)
            let to = library.appendingPathComponent(folder).appendingPathComponent(newBundleID + suffix)
            let fm = FileManager.default
            guard fm.fileExists(atPath: from.path), !fm.fileExists(atPath: to.path) else { continue }
            // Copied beside it, then renamed into place: never a half-copied folder.
            let partial = to.deletingLastPathComponent().appendingPathComponent(to.lastPathComponent + ".migrating")
            do {
                try? fm.removeItem(at: partial)
                try fm.copyItem(at: from, to: partial)
                try fm.moveItem(at: partial, to: to)
                Log.line("copied \(folder)/\(from.lastPathComponent) to \(to.lastPathComponent)")
            } catch {
                try? fm.removeItem(at: partial)
                complete = false
                Log.line("could not copy \(from.path) (will try again next launch): \(error.localizedDescription)")
            }
        }
        if complete { defaults.set(true, forKey: doneKey) }
    }
}
