import Foundation

/// The environment the user's own terminal would have, for starting the server
/// from an app opened in Finder (whose environment has only the system PATH).
/// As VS Code does, the user's shell runs once as an interactive login shell, so
/// `~/.zprofile`, `~/.zshrc` and version managers (nvm, fnm, Volta, mise, asdf)
/// apply, and prints its environment, so `gh` and keys exported there reach the
/// bundled server (which brings its own Node).
enum ShellEnvironment {
    static let marker = "__PASEO_COMMAND_ENV__"

    /// The shell's environment, or nil if it failed or took over `timeout`.
    static func capture(shell: String = userShell(), timeout: TimeInterval = 10) -> [String: String]? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        process.arguments = ["-i", "-l", "-c", "printf '\(marker)'; /usr/bin/env -0; printf '\(marker)'"]
        var env = ProcessInfo.processInfo.environment
        env["PASEO_COMMAND_RESOLVING_ENVIRONMENT"] = "1"
        process.environment = env
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        // Read as it comes, done at the closing marker or end of output: a child an rc
        // file leaves in the background can hold the pipe open long after the shell exits.
        let lock = NSLock()
        var data = Data()
        let done = DispatchSemaphore(value: 0)
        var finished = false
        output.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            lock.lock(); defer { lock.unlock() }
            guard !finished else { return }
            data.append(chunk)
            if chunk.isEmpty || complete(data) { finished = true; done.signal() }
        }
        do { try process.run() } catch {
            output.fileHandleForReading.readabilityHandler = nil
            return nil
        }
        let inTime = done.wait(timeout: .now() + timeout) == .success
        output.fileHandleForReading.readabilityHandler = nil
        if process.isRunning { process.terminate() }
        guard inTime else { return nil }
        lock.lock(); defer { lock.unlock() }
        return parse(data)
    }

    /// Both markers have arrived.
    private static func complete(_ data: Data) -> Bool {
        let mark = Data(marker.utf8)
        guard let first = data.range(of: mark) else { return false }
        return data.range(of: mark, in: first.upperBound..<data.endIndex) != nil
    }

    /// The `env -0` block between the markers; anything rc files print is ignored.
    static func parse(_ data: Data) -> [String: String]? {
        let text = String(decoding: data, as: UTF8.self)
        guard let start = text.range(of: marker),
              let end = text.range(of: marker, range: start.upperBound..<text.endIndex) else { return nil }
        var env: [String: String] = [:]
        for entry in text[start.upperBound..<end.lowerBound].split(separator: "\0") {
            guard let eq = entry.firstIndex(of: "="), eq != entry.startIndex else { continue }
            env[String(entry[..<eq])] = String(entry[entry.index(after: eq)...])
        }
        return env["PATH"] == nil ? nil : env
    }

    /// The login shell from the user database, as Terminal uses; else zsh.
    static func userShell() -> String {
        if let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell {
            let path = String(cString: shell)
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return "/bin/zsh"
    }
}
