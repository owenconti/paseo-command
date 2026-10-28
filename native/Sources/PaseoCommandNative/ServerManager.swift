import Foundation

/// Keeps the app's own Paseo Command server running: the detached launcher
/// that `npm run app:start` uses (`scripts/app-server.mjs`), started if it
/// isn't. It outlives the app on purpose: browsers on other devices and the
/// agents' `npm run app:update` use the same server.
final class ServerManager {
    /// The repository: the bundle lives in `<root>/native/build/`, unless
    /// `PASEO_COMMAND_ROOT` says otherwise.
    let root: URL
    private var starting: [(Result<Void, Error>) -> Void] = []

    init?(bundle: URL = Bundle.main.bundleURL) {
        let root = ProcessInfo.processInfo.environment["PASEO_COMMAND_ROOT"].map { URL(fileURLWithPath: $0) }
            ?? bundle.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("scripts/app-server.mjs").path) else { return nil }
        self.root = root
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
    }

    /// Start the server on `port` unless it is already up; calls back on the
    /// main queue. Concurrent requests share one start.
    func ensure(port: Int, _ done: @escaping (Result<Void, Error>) -> Void) {
        starting.append(done)
        guard starting.count == 1 else { return }
        DispatchQueue.global(qos: .userInitiated).async { [root] in
            let result = Self.run(["start", "--port", String(port)], in: root)
            DispatchQueue.main.async {
                let callbacks = self.starting
                self.starting = []
                callbacks.forEach { $0(result) }
            }
        }
    }

    /// `node scripts/app-server.mjs <args>` through a login shell, so the
    /// user's own PATH (and their Node) applies even when launched from Finder.
    private static func run(_ args: [String], in root: URL) -> Result<Void, Error> {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "exec node scripts/app-server.mjs \(args.joined(separator: " "))"]
        process.currentDirectoryURL = root
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        do {
            try process.run()
        } catch {
            return .failure(error)
        }
        let text = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        process.waitUntilExit()
        Log.line("server: \(text.split(separator: "\n").first ?? "")")
        return process.terminationStatus == 0 ? .success(()) : .failure(Failure(errorDescription: text.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
}
