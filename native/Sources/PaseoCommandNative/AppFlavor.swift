import Foundation

/// Which copy of the app this is, from the keys `bundle.sh` writes into its
/// Info.plist: the released app, or a dev copy built from the checkout for checks,
/// with a port and data folder of its own so it never touches the released one's.
/// A bundle without the keys (`swift run`) is a dev copy.
enum AppFlavor {
    private static func info(_ key: String) -> String? { Bundle.main.object(forInfoDictionaryKey: key) as? String }
    static var isRelease: Bool { info("PaseoCommandFlavor") == "release" }
    static var port: Int { info("PaseoCommandPort").flatMap(Int.init) ?? (isRelease ? 4310 : 4321) }
    /// A check copy's (`--info`) own throwaway data folder, so checks never write the data of
    /// the copy you run, which may be this very dev build.
    static var checkData: URL?
    /// `~/Library/Application Support/<app name>/`: the server's data and logs.
    static var dataFolder: URL {
        if let checkData { return checkData }
        let name = info("PaseoCommandFlavor") == nil ? nil : info("CFBundleName")
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(name ?? "Paseo Command Dev", isDirectory: true)
    }
    static var version: String { info("CFBundleShortVersionString") ?? "dev" }
}
