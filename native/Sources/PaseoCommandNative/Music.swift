import AppKit
import Foundation

/// The map's Apple Music bar (`web/src/MusicBar.tsx`): Music's current track,
/// read by AppleScript about once a second while the page watches and the
/// window shows, and its play, pause and skip commands. The page posts
/// `paseoMusic` messages and hears `paseo:music` events.
final class MusicController {
    static let bundleID = "com.apple.Music"
    /// Hands each reading to the page.
    var send: ([String: Any]) -> Void = { _ in }
    /// Whether the window is on screen; nothing is read while it isn't.
    var visible: () -> Bool = { true }

    private let queue = DispatchQueue(label: "paseo.music", qos: .utility)
    private var timer: Timer?
    private var last: [String: Any] = [:]
    /// The track whose artwork was last sent, and that artwork (a data URL).
    private var artTrack: String?
    private var art: String?

    /// The page's bar mounted (or went away).
    func watch(_ on: Bool) {
        timer?.invalidate()
        timer = nil
        guard on else { return }
        last = [:]
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, self.visible() else { return }
            self.poll()
        }
    }

    func command(_ name: String) {
        switch name {
        case "playpause", "next", "previous":
            let verb = ["playpause": "playpause", "next": "next track", "previous": "previous track"][name]!
            guard running else { return launchAndPlay() }
            queue.async { [weak self] in
                _ = Self.run("tell application \"Music\" to \(verb)")
                DispatchQueue.main.async { self?.poll() }
            }
        case "play":
            launchAndPlay()
        default: break
        }
    }

    private var running: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).isEmpty
    }

    /// Open Music behind this window, never taking focus, then resume playback.
    private func launchAndPlay() {
        guard !running, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.bundleID) else {
            queue.async { [weak self] in
                _ = Self.run("tell application \"Music\" to play")
                DispatchQueue.main.async { self?.poll() }
            }
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        publish(["state": "launching"])
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { [weak self] _, _ in
            // Music answers scripting a moment after it launches.
            self?.queue.asyncAfter(deadline: .now() + 1.5) {
                _ = Self.run("tell application \"Music\" to play")
                DispatchQueue.main.async { self?.poll() }
            }
        }
    }

    private func poll() {
        // Asking a closed Music would launch it: check without scripting it.
        guard running else { return publish(["state": "closed"]) }
        queue.async { [weak self] in
            guard let self else { return }
            let reading = self.read()
            DispatchQueue.main.async { self.publish(reading) }
        }
    }

    /// Runs on `queue`: the player state and current track, with its artwork when the track changed.
    private func read() -> [String: Any] {
        let script = """
        tell application "Music"
            set s to player state as string
            if s is "stopped" then return {s}
            try
                set t to current track
                return {s, name of t, artist of t, persistent ID of t}
            on error
                return {s}
            end try
        end tell
        """
        let result = Self.run(script)
        guard let list = result.descriptor else {
            // -1743: the user hasn't allowed this app to control Music.
            return ["state": result.error == -1743 ? "denied" : "closed"]
        }
        let items = (0..<list.numberOfItems).map { list.atIndex($0 + 1)?.stringValue ?? "" }
        var reading: [String: Any] = ["state": items.first ?? "stopped"]
        guard items.count >= 4 else { return reading }
        reading["title"] = items[1]
        reading["artist"] = items[2]
        let id = items[3]
        if id != artTrack {
            artTrack = id
            art = Self.run("tell application \"Music\" to get raw data of artwork 1 of current track").descriptor
                .flatMap { Self.thumbnail($0.data) }
        }
        if let art { reading["art"] = art }
        return reading
    }

    private func publish(_ reading: [String: Any]) {
        guard !NSDictionary(dictionary: reading).isEqual(to: last) else { return }
        last = reading
        send(reading)
    }

    private static func run(_ source: String) -> (descriptor: NSAppleEventDescriptor?, error: Int?) {
        var error: NSDictionary?
        let descriptor = NSAppleScript(source: source)?.executeAndReturnError(&error)
        return (error == nil ? descriptor : nil, error?[NSAppleScript.errorNumber] as? Int)
    }

    /// Album art as a small JPEG data URL for the bar's 36pt thumbnail.
    private static func thumbnail(_ data: Data) -> String? {
        guard let image = NSImage(data: data) else { return nil }
        let side = 96
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        NSGraphicsContext.restoreGraphicsState()
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }
}
