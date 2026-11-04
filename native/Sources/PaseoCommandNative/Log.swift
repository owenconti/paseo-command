import Foundation

enum Log {
    /// Where lines are kept as well as standard error (`<data>/logs/native.log`, set at launch),
    /// so an app opened from the Finder leaves its account too. It starts again past `limit`.
    static var file: URL?
    static let limit = 2_000_000
    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        return f
    }()

    static func line(_ text: String) {
        FileHandle.standardError.write("[paseo-native] \(text)\n".data(using: .utf8)!)
        guard let file else { return }
        let data = "\(stamp.string(from: Date())) \(text)\n".data(using: .utf8)!
        let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int ?? 0
        if size + data.count > limit || !FileManager.default.fileExists(atPath: file.path) {
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: file)
        } else if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        }
    }
}
