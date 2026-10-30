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
        do { try process.run() } catch { return nil }
        let timer = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        timer.cancel()
        return parse(data)
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
