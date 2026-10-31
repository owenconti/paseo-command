import AppKit

/// Runs the app's own server: the bundle's Node running the bundle's `server.mjs`,
/// wherever the app is installed. It lives and dies with the app: stopped when the
/// app quits or restarts, and gone by itself within a second if the app dies
/// (`PASEO_NATIVE_OWNER_PID`). Its output is appended to `<data>/logs/server.log`.
final class ServerManager {
    struct Resources { let node, server, ui: URL }

    /// Where the bundle at `app` keeps Node, the server and its page.
    static func resources(in app: URL) -> Resources {
        let res = app.appendingPathComponent("Contents/Resources", isDirectory: true)
        return Resources(node: res.appendingPathComponent("node/node"),
                         server: res.appendingPathComponent("server/server.mjs"),
                         ui: res.appendingPathComponent("ui", isDirectory: true))
    }

    /// Who holds the port, by its `/__native/health` reply.
    enum PortOwner: Equatable {
        case free
        case ours(pid: Int32)
        /// Another app's bundled server.
        case otherHelper(pid: Int32, ownerPid: Int32)
        /// Something that isn't a bundled server (a Vite preview, another program).
        case foreign
    }

    /// `health` is the reply's body, nil when nothing answered.
    static func classify(health: Data?) -> PortOwner {
        guard let health else { return .free }
        guard let json = (try? JSONSerialization.jsonObject(with: health)) as? [String: Any],
              json["ready"] as? Bool == true,
              let pid = (json["pid"] as? NSNumber)?.int32Value,
              let owner = (json["ownerPid"] as? NSNumber)?.int32Value else { return .foreign }
        return owner == getpid() ? .ours(pid: pid) : .otherHelper(pid: pid, ownerPid: owner)
    }

    /// Whether a bundled server holding the port is about to let it go: its app has
    /// died (the server follows), or is this app's copy that Restart app is replacing.
    static func shouldWait(for owner: PortOwner) -> Bool {
        guard case .otherHelper(_, let ownerPid) = owner else { return false }
        if kill(ownerPid, 0) != 0 && errno == ESRCH { return true }
        return NSRunningApplication(processIdentifier: ownerPid)?.bundleURL == Bundle.main.bundleURL
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
    }

    /// Asks whether to stop an old checkout server holding the port (on main;
    /// answers once). Without it the port reads as another program's.
    var confirmHandOver: ((OldServer, @escaping (Bool) -> Void) -> Void)?

    private let resources: Resources
    private let lock = NSLock()
    private var running: Process?
    private var starting: [(Result<Void, Error>) -> Void] = []

    /// Nil when the bundle carries no server (`swift run`).
    init?(bundle: Bundle = .main) {
        let found = Self.resources(in: bundle.bundleURL)
        guard FileManager.default.isExecutableFile(atPath: found.node.path),
              FileManager.default.fileExists(atPath: found.server.path) else { return nil }
        resources = found
    }

    /// Start the server on `port` unless ours is already up; calls back on the
    /// main queue. Concurrent requests share one start.
    func ensure(port: Int, _ done: @escaping (Result<Void, Error>) -> Void) {
        starting.append(done)
        guard starting.count == 1 else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let result = self.bringUp(port)
            DispatchQueue.main.async {
                let callbacks = self.starting
                self.starting = []
                callbacks.forEach { $0(result) }
            }
        }
    }

    /// SIGTERM our server and wait for it to go, killing it after `timeout`
    /// so the port is free for whatever comes next.
    func stop(timeout: TimeInterval = 5) {
        guard let process = lock.withLock({ running }), process.isRunning else { return }
        process.terminate()
        let deadline = Date() + timeout
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning {
            Log.line("server: still running \(timeout)s after SIGTERM; killing it")
            kill(process.processIdentifier, SIGKILL)
            process.waitUntilExit()
        }
        lock.withLock { running = nil }
    }

    private func bringUp(_ port: Int) -> Result<Void, Error> {
        var owner = Self.classify(health: Self.health(port))
        let waited = Self.shouldWait(for: owner)
        if waited {
            Log.line("server: port \(port) is held by a server that is going away; waiting")
            let deadline = Date() + 10
            while owner != .free && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.25)
                owner = Self.classify(health: Self.health(port))
            }
        }
        switch owner {
        case .ours: return .success(())
        case .otherHelper(_, let ownerPid) where !waited:
            return .failure(Failure(errorDescription: "Port \(port) is used by another copy of Paseo Command (process \(ownerPid)). Quit it and reopen \(AppFlavor.name)."))
        case .foreign:
            if let old = OldInstall.find(port: port), let handedOver = handOver(from: old) {
                if case .failure = handedOver { return handedOver }
                return start(port)
            }
            return .failure(Failure(errorDescription: "Port \(port) is used by another program. Quit it and reopen \(AppFlavor.name)."))
        default: return start(port)
        }
    }

    /// With the user's yes, stop the old checkout server and copy its data in;
    /// nil when there's no one to ask.
    private func handOver(from old: OldServer) -> Result<Void, Error>? {
        guard let confirm = confirmHandOver else { return nil }
        Log.line("server: port is held by an older server from \(old.checkout.path) (process \(old.pid))")
        let answered = DispatchSemaphore(value: 0)
        var accepted = false
        DispatchQueue.main.async { confirm(old) { accepted = $0; answered.signal() } }
        answered.wait()
        guard accepted else { return .failure(Failure(errorDescription: "The older Paseo Command server from \(old.checkout.path) is still running.")) }
        let data = AppFlavor.dataFolder
        return Result {
            _ = try HandOver(stop: { try OldInstall.stop(old, data: data) },
                             copy: { OldInstall.copyData(from: old.checkout, to: data) }).run()
        }
    }

    /// Launch the server and wait until its health says it is ours.
    private func start(_ port: Int) -> Result<Void, Error> {
        let data = AppFlavor.dataFolder
        let logURL = data.appendingPathComponent("logs/server.log")
        let log: FileHandle
        let from: UInt64
        do {
            try FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            log = try FileHandle(forWritingTo: logURL)
            from = try log.seekToEnd()
        } catch { return .failure(error) }
        defer { try? log.close() }
        log.write(Data("--- \(Date()) starting \(AppFlavor.version) on port \(port)\n".utf8))
        let process = Process()
        process.executableURL = resources.node
        process.arguments = [resources.server.path]
        process.environment = Self.serverEnvironment(Self.environment, data: data, ui: resources.ui, port: port)
        process.currentDirectoryURL = data
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = log
        process.standardError = log
        do { try process.run() } catch { return .failure(error) }
        lock.withLock { running = process }
        Log.line("server: started \(resources.server.path) (process \(process.processIdentifier)) on port \(port)")
        let deadline = Date() + 30
        while process.isRunning && Date() < deadline {
            if case .ours = Self.classify(health: Self.health(port)) { return .success(()) }
            Thread.sleep(forTimeInterval: 0.25)
        }
        if process.isRunning { stop() }
        return .failure(Failure(errorDescription: Self.reason(in: logURL, from: from)
            ?? "The server didn’t answer within 30 seconds. See \(logURL.path)."))
    }

    /// Why the server failed, from what it logged since `offset`: its
    /// `startup-error`, else its last lines.
    private static func reason(in log: URL, from offset: UInt64) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: log) else { return nil }
        defer { try? handle.close() }
        try? handle.seek(toOffset: offset)
        let lines = String(decoding: handle.readDataToEndOfFile(), as: UTF8.self).split(separator: "\n").dropFirst()
        for line in lines.reversed() {
            if let json = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
               json["event"] as? String == "startup-error", let error = json["error"] as? String { return error }
        }
        return lines.isEmpty ? nil : lines.suffix(20).joined(separator: "\n")
    }

    /// The port's `/__native/health` body, nil when nothing answers HTTP there.
    private static func health(_ port: Int) -> Data? {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/__native/health")!)
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let done = DispatchSemaphore(value: 0)
        var body: Data?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if response is HTTPURLResponse { body = data ?? Data() }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 3)
        return body
    }

    /// What the bundled server runs with: the shell's environment, less the Node
    /// settings meant for the user's own Node (`NODE_OPTIONS` can preload modules or
    /// change flags; `NODE_PATH`, resolution), plus where the app keeps things.
    static func serverEnvironment(_ base: [String: String], data: URL, ui: URL, port: Int) -> [String: String] {
        var env = base
        for key in ["PASEO_COMMAND_RESOLVING_ENVIRONMENT", "NODE_OPTIONS", "NODE_PATH"] { env.removeValue(forKey: key) }
        env["PASEO_COMMAND_DATA"] = data.path
        env["PASEO_NATIVE_UI"] = ui.path
        env["PASEO_NATIVE_PORT"] = String(port)
        env["PASEO_NATIVE_OWNER_PID"] = String(getpid())
        env["PASEO_COMMAND_VERSION"] = AppFlavor.version
        return env
    }

    /// The user's shell environment, captured once (see `ShellEnvironment`), so
    /// `gh` and keys from their profile reach the server even when the app is opened
    /// from Finder; the app's own if the shell fails.
    private static let environment: [String: String] = {
        if let env = ShellEnvironment.capture() { return env }
        Log.line("server: the login shell's environment could not be read; using the app's")
        return ProcessInfo.processInfo.environment
    }()
}
