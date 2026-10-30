import Foundation

/// Keeps the app's own Paseo Command server running: the detached launcher
/// that `npm run app:start` uses (`scripts/app-server.mjs`), started if it
/// isn't. It outlives the app on purpose: local browsers and the
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
            // A server already answering is used as it is, whichever checkout started it.
            let result = Self.answers(port) ? .success(()) : Self.run(["start", "--port", String(port)], in: root)
            DispatchQueue.main.async {
                let callbacks = self.starting
                self.starting = []
                callbacks.forEach { $0(result) }
            }
        }
    }

    /// For Restart app: restart the server if its own code changed since it started
    /// (`app-server.mjs refresh`; a new page build needs no restart), or start
    /// it if it isn't running. Calls back on the main queue.
    func refresh(port: Int, _ done: @escaping (Result<Void, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async { [root] in
            let result = Self.run(["refresh", "--port", String(port)], in: root)
            DispatchQueue.main.async { done(result) }
        }
    }

    /// Whether anything answers HTTP on the port, within a couple of seconds.
    private static func answers(_ port: Int) -> Bool {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
        request.timeoutInterval = 2
        let done = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            ok = response is HTTPURLResponse
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 3)
        return ok
    }

    /// The user's shell environment, captured once (see `ShellEnvironment`); the
    /// app's own if the shell fails, so the usual Node install places are still tried.
    private static let environment: [String: String] = {
        if let env = ShellEnvironment.capture() { return env }
        Log.line("server: the login shell's environment could not be read; using the app's")
        return ProcessInfo.processInfo.environment
    }()

    /// `node scripts/app-server.mjs <args>` with the user's shell environment, so
    /// their Node, PATH and keys apply even when the app is opened from Finder.
    private static func run(_ args: [String], in root: URL) -> Result<Void, Error> {
        var env = environment
        env.removeValue(forKey: "PASEO_COMMAND_RESOLVING_ENVIRONMENT")
        guard let node = ShellEnvironment.node(in: env) else {
            return .failure(Failure(errorDescription: "Node.js was not found. Install Node.js 20.19 or later (nodejs.org, Homebrew, nvm, fnm, Volta, mise or asdf), then reopen Paseo Command."))
        }
        env["PATH"] = ([(node as NSString).deletingLastPathComponent] + (env["PATH"] ?? "").split(separator: ":").map(String.init)).joined(separator: ":")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = ["scripts/app-server.mjs"] + args
        process.environment = env
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
