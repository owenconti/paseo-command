import AppKit
#if canImport(Sparkle)
import Sparkle
#endif

/// The released app's updates, by Sparkle: it checks the GitHub feed hourly and
/// downloads a new version quietly; the mode bar then says "Update ready" and the
/// palette's Restart app installs it, coming back at the same page and place.
/// Without Restart app, it installs when the app quits. Dev copies have none.
/// Sparkle's part is kept apart, so the restore rule is testable without it.
final class Updater: NSObject {
    /// Nil in the dev flavour: dev copies update by being rebuilt.
    static let shared: Updater? = AppFlavor.isRelease ? Updater() : nil
    /// The downloaded version waiting to install.
    private(set) var pendingVersion: String? { didSet { onChange?() } }
    var onChange: (() -> Void)?
    /// The window's frame and page now, saved for the updated copy (set by the app).
    var currentPage: (() -> (frame: NSRect, url: URL)?)?
    private var installBlock: (() -> Void)?
    /// The `SPUStandardUpdaterController`, kept for the updater's lifetime.
    private var controller: AnyObject?

    static let restoreKey = "restorePage"

    private override init() {
        super.init()
        #if canImport(Sparkle)
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
        Log.line("updates: Sparkle started, \(AppFlavor.version) installed")
        #endif
    }

    /// Install the downloaded update now: Sparkle quits, replaces and relaunches the
    /// app, which reads `restorePage` back. False when nothing is waiting.
    func installNow() -> Bool {
        guard let installBlock else { return false }
        if let page = currentPage?() {
            UserDefaults.standard.set(["url": page.url.absoluteString, "frame": NSStringFromRect(page.frame)], forKey: Updater.restoreKey)
        }
        installBlock()
        return true
    }

    /// The page an updated copy comes back at: the saved one, if it is our own origin.
    static func restoreURL(saved: String?, port: Int) -> URL? {
        guard let saved, let url = URL(string: saved),
              WebOrigin.matches(url, to: URL(string: "http://127.0.0.1:\(port)/")!) else { return nil }
        return url
    }

    /// The page and frame saved by `installNow`, read once at launch and cleared.
    static func takeRestorePage(port: Int, defaults: UserDefaults = .standard) -> (url: URL, frame: NSRect?)? {
        let saved = defaults.dictionary(forKey: restoreKey)
        defaults.removeObject(forKey: restoreKey)
        guard let url = restoreURL(saved: saved?["url"] as? String, port: port) else { return nil }
        return (url, (saved?["frame"] as? String).map(NSRectFromString))
    }

    /// The page's `paseo:update` event: this version, and the one waiting (dev copies: none).
    static var event: [String: Any] {
        ["installed": AppFlavor.version, "pending": shared?.pendingVersion.map { $0 as Any } ?? NSNull()]
    }
}

#if canImport(Sparkle)
extension Updater: SPUUpdaterDelegate {
    /// A downloaded update waits for the app to quit; keep Sparkle's handle so
    /// Restart app can install it at once.
    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        Log.line("updates: \(item.displayVersionString) ready to install")
        installBlock = immediateInstallHandler
        pendingVersion = item.displayVersionString
        return true
    }
}
#endif
