import Foundation

let fm = FileManager.default
let root = fm.temporaryDirectory.appendingPathComponent("old-install-\(UUID().uuidString)", isDirectory: true)
defer { try? fm.removeItem(at: root) }
func write(_ text: String, to url: URL) {
    try! fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! text.write(to: url, atomically: true, encoding: .utf8)
}
func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
let names = ["secrets.json", "games.json", "forks.json", "archived-subagents.json"]

// recognisesTheOldLauncherAndVite (an injected folder check: only this checkout is one)
let ours: (URL) -> Bool = { $0.path == "/Users/example/dev/paseo-command" }
assert(OldInstall.checkoutFromCommand(#"/usr/local/bin/node /Users/example/dev/paseo-command/scripts/app-server.mjs --serve {"token":"t","port":4310}"#, isCheckout: ours)?.path
       == "/Users/example/dev/paseo-command")
assert(OldInstall.checkoutFromCommand("node /Users/example/dev/paseo-command/web/node_modules/.bin/vite preview", isCheckout: ours)?.path
       == "/Users/example/dev/paseo-command")
assert(OldInstall.checkoutFromCommand("/Applications/Other.app/Contents/MacOS/Other --port 4310", isCheckout: { _ in true }) == nil)
assert(OldInstall.checkoutFromCommand("node /Users/example/dev/other/web/node_modules/.bin/vite preview", isCheckout: ours) == nil,
       "another project's vite is never the old launcher")
// A checkout path with spaces.
let spaced: (URL) -> Bool = { $0.path == "/Users/example/Code Projects/paseo-command" }
assert(OldInstall.checkoutFromCommand("/usr/local/bin/node /Users/example/Code Projects/paseo-command/scripts/app-server.mjs --serve {}", isCheckout: spaced)?.path
       == "/Users/example/Code Projects/paseo-command")

// acceptsOnlyAPaseoCommandCheckout: package.json's name and the launcher decide.
func project(_ name: String, launcher: Bool) -> URL {
    let folder = root.appendingPathComponent("project \(UUID().uuidString)", isDirectory: true)
    write(#"{"name":"\#(name)","private":true}"#, to: folder.appendingPathComponent("package.json"))
    if launcher { write("// launcher", to: folder.appendingPathComponent("scripts/app-server.mjs")) }
    return folder
}
do {
    let real = project("paseo-command", launcher: true)
    assert(OldInstall.isCheckout(real))
    assert(OldInstall.checkoutFromCommand("node \(real.path)/web/node_modules/.bin/vite")?.path == real.path, "found with spaces in its path")
    let other = project("some-other-app", launcher: true)
    assert(!OldInstall.isCheckout(other))
    assert(OldInstall.checkoutFromCommand("node \(other.path)/web/node_modules/.bin/vite") == nil)
    assert(!OldInstall.isCheckout(project("paseo-command", launcher: false)))
    assert(!OldInstall.isCheckout(root.appendingPathComponent("missing")))
}

// copiesTheFourFilesOnce
do {
    let checkout = root.appendingPathComponent("checkout", isDirectory: true)
    let data = root.appendingPathComponent("data", isDirectory: true)
    for name in names { write("old-\(name)", to: checkout.appendingPathComponent(".paseo-command/\(name)")) }
    write("unrelated", to: checkout.appendingPathComponent(".paseo-command/other.json"))
    let copied = OldInstall.copyData(from: checkout, to: data)
    assert(Set(copied) == Set(names))
    for name in names {
        assert(read(data.appendingPathComponent(name)) == "old-\(name)")
        assert(read(checkout.appendingPathComponent(".paseo-command/\(name)")) == "old-\(name)", "the source stays")
    }
    assert(!fm.fileExists(atPath: data.appendingPathComponent("other.json").path))
    let marker = try! JSONSerialization.jsonObject(with: Data(contentsOf: data.appendingPathComponent("migrated-from.json"))) as! [String: Any]
    assert(marker["checkout"] as? String == checkout.path)
    assert(Set(marker["files"] as? [String] ?? []) == Set(names))
    assert(marker["date"] is String)
    // A second call (say, a later checkout server) changes nothing.
    write("changed", to: checkout.appendingPathComponent(".paseo-command/games.json"))
    try! fm.removeItem(at: data.appendingPathComponent("games.json"))
    assert(OldInstall.copyData(from: checkout, to: data).isEmpty)
    assert(!fm.fileExists(atPath: data.appendingPathComponent("games.json").path))
}

// copiesNothingIntoADataFolderInUse
do {
    let checkout = root.appendingPathComponent("checkout2", isDirectory: true)
    let data = root.appendingPathComponent("data2", isDirectory: true)
    for name in names { write("old-\(name)", to: checkout.appendingPathComponent(".paseo-command/\(name)")) }
    write("mine", to: data.appendingPathComponent("games.json"))
    assert(OldInstall.copyData(from: checkout, to: data).isEmpty)
    assert(read(data.appendingPathComponent("games.json")) == "mine")
    assert(!fm.fileExists(atPath: data.appendingPathComponent("secrets.json").path))
    assert(!fm.fileExists(atPath: data.appendingPathComponent("migrated-from.json").path))
}

// copiesOnlyAfterOldServerStopped
do {
    var order: [String] = []
    let copied = try! HandOver(stop: { order.append("stop") }, copy: { order.append("copyData"); return ["games.json"] }).run()
    assert(order == ["stop", "copyData"])
    assert(copied == ["games.json"])
    struct Stuck: Error {}
    order = []
    assert((try? HandOver(stop: { order.append("stop"); throw Stuck() }, copy: { order.append("copyData"); return [] }).run()) == nil)
    assert(order == ["stop"], "nothing is copied while the old server may still be writing")
}

// findsTheCheckoutsLaunchAgentOnly
let checkout = URL(fileURLWithPath: "/Users/example/dev/paseo-command")
assert(OldInstall.launchAgent(for: checkout, home: root.appendingPathComponent("home", isDirectory: true)) == nil)
do {
    let home = root.appendingPathComponent("home2", isDirectory: true)
    let plist = home.appendingPathComponent("Library/LaunchAgents/com.paseo-command.serve.plist")
    let agent: [String: Any] = ["Label": "com.paseo-command.serve", "WorkingDirectory": "/Users/example/dev/paseo-command"]
    try! fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! PropertyListSerialization.data(fromPropertyList: agent, format: .xml, options: 0).write(to: plist)
    assert(OldInstall.launchAgent(for: checkout, home: home)?.path == plist.path)
    assert(OldInstall.launchAgent(for: URL(fileURLWithPath: "/Users/example/dev/other"), home: home) == nil, "another checkout's agent is left alone")
}
print("Native old install checks passed.")
