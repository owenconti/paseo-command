import Foundation

/// The old checkout launcher's server (`scripts/app-server.mjs`, `npm run app:dev`'s
/// Vite, or `service.ts`'s launch agent running either) holding the app's port.
struct OldServer: Equatable {
    let pid: Int32
    let checkout: URL
    /// `com.paseo-command.serve`'s plist, when it runs this checkout (it would start
    /// the server again).
    let launchAgent: URL?
}

/// Stop the old server, then copy its data: in that order, so nothing is copied
/// while the old server may still write it.
struct HandOver {
    let stop: () throws -> Void
    let copy: () -> [String]
    func run() throws -> [String] {
        try stop()
        return copy()
    }
}

/// Handing over from a Paseo Command run from a checkout, before the app was
/// self-contained. Only a listener whose command line is the old launcher's is
/// ever stopped, and its data is copied, never moved.
enum OldInstall {
    static let agentLabel = "com.paseo-command.serve"
    /// What `<checkout>/.paseo-command/` held that the app's data folder now holds.
    static let dataFiles = ["secrets.json", "games.json", "forks.json", "archived-subagents.json"]

    /// The old server listening on `port`, nil when the listener is anything else.
    static func find(port: Int, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> OldServer? {
        let pids = (run("/usr/sbin/lsof", ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]) ?? "")
            .split(separator: "\n").compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
        for pid in pids {
            guard let checkout = command(of: pid).flatMap(checkoutFromCommand) else { continue }
            return OldServer(pid: pid, checkout: checkout, launchAgent: launchAgent(for: checkout, home: home))
        }
        return nil
    }

    /// The checkout an old launcher's command line runs from: the path before its
    /// `/scripts/app-server.mjs` or `/web/node_modules/.bin/vite`.
    static func checkoutFromCommand(_ command: String) -> URL? {
        for marker in ["/scripts/app-server.mjs", "/web/node_modules/.bin/vite"] {
            guard let range = command.range(of: marker) else { continue }
            // The path is the word before the marker (checkout paths with spaces aren't recognised).
            let path = command[..<range.lowerBound].split(separator: " ").last.map(String.init) ?? ""
            guard path.hasPrefix("/") else { continue }
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return nil
    }

    /// `~/Library/LaunchAgents/com.paseo-command.serve.plist` when it runs `checkout`.
    static func launchAgent(for checkout: URL, home: URL) -> URL? {
        let plist = home.appendingPathComponent("Library/LaunchAgents/\(agentLabel).plist")
        guard let data = try? Data(contentsOf: plist),
              let agent = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any],
              let folder = agent["WorkingDirectory"] as? String,
              URL(fileURLWithPath: folder).standardizedFileURL.path == checkout.standardizedFileURL.path else { return nil }
        return plist
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
    }

    /// Unload its launch agent (moved to `<data>/old-launch-agent.plist`, kept),
    /// then SIGTERM the server and wait up to five seconds for it to go.
    static func stop(_ server: OldServer, data: URL = AppFlavor.dataFolder) throws {
        if let plist = server.launchAgent {
            _ = run("/bin/launchctl", ["bootout", "gui/\(getuid())", plist.path])
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
            let kept = data.appendingPathComponent("old-launch-agent.plist")
            try? FileManager.default.removeItem(at: kept)
            try FileManager.default.moveItem(at: plist, to: kept)
            Log.line("old server: unloaded its launch agent; kept it as \(kept.path)")
        }
        // Still the old launcher (not a reused pid)? Booting out the agent may already have ended it.
        if command(of: server.pid).flatMap(checkoutFromCommand) != nil {
            kill(server.pid, SIGTERM)
            Log.line("old server: stopping process \(server.pid) from \(server.checkout.path)")
        }
        let deadline = Date() + 5
        while kill(server.pid, 0) == 0 && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        if kill(server.pid, 0) == 0 {
            throw Failure(errorDescription: "The older Paseo Command server (process \(server.pid)) didn’t stop. Stop it with npm run app:stop in \(server.checkout.path) and reopen Paseo Command.")
        }
    }

    /// Copy the checkout's data files into a data folder that has none of them yet,
    /// once (`migrated-from.json` records it). Returns the names copied.
    static func copyData(from checkout: URL, to data: URL) -> [String] {
        let fm = FileManager.default
        let marker = data.appendingPathComponent("migrated-from.json")
        guard !fm.fileExists(atPath: marker.path),
              !dataFiles.contains(where: { fm.fileExists(atPath: data.appendingPathComponent($0).path) }) else { return [] }
        try? fm.createDirectory(at: data, withIntermediateDirectories: true)
        let source = checkout.appendingPathComponent(".paseo-command", isDirectory: true)
        let copied = dataFiles.filter { name in
            let from = source.appendingPathComponent(name)
            guard fm.fileExists(atPath: from.path) else { return false }
            do { try fm.copyItem(at: from, to: data.appendingPathComponent(name)); return true }
            catch { Log.line("old server: could not copy \(name): \(error.localizedDescription)"); return false }
        }
        let record: [String: Any] = ["checkout": checkout.path, "date": ISO8601DateFormatter().string(from: Date()), "files": copied]
        if let json = try? JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]) {
            try? json.write(to: marker)
        }
        Log.line("old server: copied \(copied.isEmpty ? "no files" : copied.joined(separator: ", ")) from \(source.path)")
        return copied
    }

    private static func command(of pid: Int32) -> String? {
        run("/bin/ps", ["-o", "command=", "-p", String(pid)])?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A tool's standard output, nil when it couldn't run or failed.
    private static func run(_ tool: String, _ arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return process.terminationStatus == 0 ? String(decoding: data, as: UTF8.self) : nil
    }
}
