import Foundation

/// The environment the user's own terminal would have, for starting the server
/// from an app opened in Finder (whose environment has only the system PATH).
/// As VS Code does, the user's shell runs once as an interactive login shell, so
/// `~/.zprofile`, `~/.zshrc` and version managers (nvm, fnm, Volta, mise, asdf)
/// apply, and prints its environment; Node is then found on that PATH, else in
/// the usual install places.
enum ShellEnvironment {
    static let marker = "__PASEO_COMMAND_ENV__"

    /// The shell's environment, or nil if it failed or took over `timeout`.
    static func capture(timeout: TimeInterval = 10) -> [String: String]? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: userShell())
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

    /// `node` on the environment's PATH, else the newest in the usual install places.
    static func node(in env: [String: String], home: String = NSHomeDirectory(),
                     isExecutable: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
                     list: (String) -> [String] = { (try? FileManager.default.contentsOfDirectory(atPath: $0)) ?? [] }) -> String? {
        var dirs = (env["PATH"] ?? "").split(separator: ":").map(String.init)
        for manager in ["\(home)/.nvm/versions/node", "\(home)/.local/share/fnm/node-versions",
                        "\(home)/Library/Application Support/fnm/node-versions", "\(home)/.local/share/mise/installs/node",
                        "\(home)/.asdf/installs/nodejs"] {
            for version in list(manager).sorted(by: newerVersion) {
                dirs.append("\(manager)/\(version)/bin")
                dirs.append("\(manager)/\(version)/installation/bin")
            }
        }
        dirs += ["\(home)/.volta/bin", "\(home)/.local/share/mise/shims", "\(home)/.asdf/shims",
                 "/opt/homebrew/bin", "/usr/local/bin"]
        return dirs.lazy.map { "\($0)/node" }.first(where: isExecutable)
    }

    /// Whether version folder `a` (`v22.12.0`, `22.12.0`) is newer than `b`.
    static func newerVersion(_ a: String, _ b: String) -> Bool {
        func parts(_ s: String) -> [Int] {
            s.drop(while: { !$0.isNumber }).split(separator: ".").map { Int($0.prefix(while: \.isNumber)) ?? 0 }
        }
        return parts(b).lexicographicallyPrecedes(parts(a))
    }
}
