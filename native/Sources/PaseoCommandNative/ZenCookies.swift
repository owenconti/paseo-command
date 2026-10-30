import Foundation
import SQLite3
import WebKit

/// Signs Conquer in as Zen Browser is: its cookies, read from the profile
/// Zen opens (`cookies.sqlite`, Firefox's own store, which keeps them in the
/// clear), are copied into Conquer's cookie store. Only the default space's
/// (no container) and unpartitioned cookies that haven't expired; Zen's files
/// are copied first and only the copy is opened, so Zen is never written to.
enum ZenCookies {
    static let root = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/zen")

    /// The profile Zen opens: its install's default, else the profile marked default.
    static func profile() -> URL? {
        for (file, key) in [("installs.ini", "Default="), ("profiles.ini", "Path=")] {
            guard let text = try? String(contentsOf: root.appendingPathComponent(file), encoding: .utf8) else { continue }
            if file == "installs.ini" {
                if let line = text.split(separator: "\n").first(where: { $0.hasPrefix(key) }) {
                    return root.appendingPathComponent(String(line.dropFirst(key.count)))
                }
            } else {
                // The [Profile…] section that says Default=1.
                for section in text.components(separatedBy: "\n[") where section.contains("\nDefault=1") {
                    if let line = section.split(separator: "\n").first(where: { $0.hasPrefix(key) }) {
                        return root.appendingPathComponent(String(line.dropFirst(key.count)))
                    }
                }
            }
        }
        return nil
    }

    /// Zen's live cookies, read from a copy of its store (and its write-ahead log).
    static func read() throws -> [HTTPCookie] {
        guard let profile = profile() else { throw Failure("Zen Browser’s profile wasn’t found") }
        let source = profile.appendingPathComponent("cookies.sqlite")
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("paseo-zen-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: copy, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: copy) }
        let db = copy.appendingPathComponent("cookies.sqlite")
        try FileManager.default.copyItem(at: source, to: db)
        for suffix in ["-wal", "-shm"] {
            let extra = URL(fileURLWithPath: source.path + suffix)
            if FileManager.default.fileExists(atPath: extra.path) {
                try? FileManager.default.copyItem(at: extra, to: URL(fileURLWithPath: db.path + suffix))
            }
        }
        var handle: OpaquePointer?
        guard sqlite3_open_v2(db.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
            sqlite3_close(handle)
            throw Failure("Zen’s cookie store couldn’t be opened")
        }
        defer { sqlite3_close(handle) }
        let sql = """
        SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies
        WHERE originAttributes = '' AND expiry > ?
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else {
            throw Failure("Zen’s cookie store couldn’t be read")
        }
        defer { sqlite3_finalize(statement) }
        // Zen keeps expiry in milliseconds.
        let now = Date().timeIntervalSince1970
        sqlite3_bind_int64(statement, 1, Int64(now * 1000))
        func text(_ i: Int32) -> String { sqlite3_column_text(statement, i).map { String(cString: $0) } ?? "" }
        var cookies: [HTTPCookie] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: text(0), .value: text(1), .domain: text(2), .path: text(3),
                .expires: Date(timeIntervalSince1970: Double(sqlite3_column_int64(statement, 4)) / 1000),
            ]
            if sqlite3_column_int(statement, 5) != 0 { properties[.secure] = "TRUE" }
            if sqlite3_column_int(statement, 6) != 0 { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
            // 1 lax, 2 strict; 0 is none, and anything else unset: no policy either way.
            switch sqlite3_column_int(statement, 7) {
            case 2: properties[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteStrict
            case 1: properties[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteLax
            default: break
            }
            if let cookie = HTTPCookie(properties: properties) { cookies.append(cookie) }
        }
        return cookies
    }

    /// Copy Zen's cookies into `store`; `done` gets how many, or why none.
    static func load(into store: WKHTTPCookieStore, done: @escaping (Result<Int, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try read() }
            DispatchQueue.main.async {
                guard case .success(let cookies) = result else { return done(result.map(\.count)) }
                let group = DispatchGroup()
                for cookie in cookies {
                    group.enter()
                    store.setCookie(cookie) { group.leave() }
                }
                group.notify(queue: .main) { done(.success(cookies.count)) }
            }
        }
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }
}
