import Foundation

let fm = FileManager.default
let root = fm.temporaryDirectory.appendingPathComponent("legacy-state-\(UUID().uuidString)", isDirectory: true)
defer { try? fm.removeItem(at: root) }
let newID = "test.new.\(UUID().uuidString)"

func write(_ text: String, to url: URL) {
    try! fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! text.write(to: url, atomically: true, encoding: .utf8)
}
func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
func fresh(_ name: String) -> (home: URL, defaults: UserDefaults) {
    (root.appendingPathComponent(name, isDirectory: true), UserDefaults(suiteName: "test.\(UUID().uuidString)")!)
}
func library(_ home: URL, _ folder: String, _ id: String) -> URL {
    home.appendingPathComponent("Library/\(folder)/\(id)", isDirectory: true)
}

// Defaults: missing keys are copied, set ones are untouched, the flag is set.
do {
    let (home, defaults) = fresh("defaults")
    let old: [String: Any] = ["conquerState": "old", "sidebarWidth": 1.5]
    defaults.set("new", forKey: "conquerState")
    LegacyState.migrate(home: home, defaults: defaults, oldPreferences: old, newBundleID: newID)
    assert(defaults.string(forKey: "conquerState") == "new")
    assert(defaults.double(forKey: "sidebarWidth") == 1.5)
    assert(defaults.bool(forKey: "legacyStateMigrated"))
}

// Folders: copied when missing, left alone when present, the old ones kept.
do {
    let (home, defaults) = fresh("folders")
    for folder in ["WebKit", "HTTPStorages"] {
        write("old-\(folder)", to: library(home, folder, LegacyState.oldBundleID).appendingPathComponent("a/b.txt"))
    }
    write("cookies", to: home.appendingPathComponent("Library/HTTPStorages/\(LegacyState.oldBundleID).binarycookies"))
    write("keep", to: library(home, "HTTPStorages", newID).appendingPathComponent("a/b.txt"))
    LegacyState.migrate(home: home, defaults: defaults, oldPreferences: nil, newBundleID: newID)
    assert(read(library(home, "WebKit", newID).appendingPathComponent("a/b.txt")) == "old-WebKit")
    assert(read(library(home, "HTTPStorages", newID).appendingPathComponent("a/b.txt")) == "keep")
    assert(read(home.appendingPathComponent("Library/HTTPStorages/\(newID).binarycookies")) == "cookies")
    for folder in ["WebKit", "HTTPStorages"] {
        assert(read(library(home, folder, LegacyState.oldBundleID).appendingPathComponent("a/b.txt")) == "old-\(folder)", "old \(folder) kept")
    }

    // A second call does nothing, even with new data to copy.
    write("late", to: library(home, "WebKit", newID).appendingPathComponent("c.txt"))
    try! fm.removeItem(at: library(home, "WebKit", newID))
    LegacyState.migrate(home: home, defaults: defaults, oldPreferences: ["later": 1], newBundleID: newID)
    assert(defaults.object(forKey: "later") == nil)
    assert(!fm.fileExists(atPath: library(home, "WebKit", newID).path))
}

// Nothing to migrate is fine.
do {
    let (home, defaults) = fresh("empty")
    LegacyState.migrate(home: home, defaults: defaults, oldPreferences: nil, newBundleID: newID)
    assert(defaults.bool(forKey: "legacyStateMigrated"))
    assert(!fm.fileExists(atPath: library(home, "WebKit", newID).path))
}
// A failed folder copy leaves no target or partial and no flag; the next launch retries.
do {
    let (home, defaults) = fresh("partial")
    let old = library(home, "WebKit", LegacyState.oldBundleID)
    write("first", to: old.appendingPathComponent("a.txt"))
    write("locked", to: old.appendingPathComponent("z/locked.txt"))
    write("cookies", to: home.appendingPathComponent("Library/HTTPStorages/\(LegacyState.oldBundleID).binarycookies"))
    let locked = old.appendingPathComponent("z/locked.txt")
    try! fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: locked.path)
    LegacyState.migrate(home: home, defaults: defaults, oldPreferences: ["kept": 1], newBundleID: newID)
    let target = library(home, "WebKit", newID)
    assert(!fm.fileExists(atPath: target.path), "no half-copied WebKit folder")
    assert(!fm.fileExists(atPath: target.path + ".migrating"), "the partial copy is removed")
    assert(!defaults.bool(forKey: "legacyStateMigrated"), "not marked done")
    assert(read(home.appendingPathComponent("Library/HTTPStorages/\(newID).binarycookies")) == "cookies", "the rest still copies")
    assert(defaults.integer(forKey: "kept") == 1)

    // Next launch: the folder copies and the migration is done.
    try! fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: locked.path)
    defaults.set(2, forKey: "kept")
    LegacyState.migrate(home: home, defaults: defaults, oldPreferences: ["kept": 1], newBundleID: newID)
    assert(read(target.appendingPathComponent("z/locked.txt")) == "locked")
    assert(defaults.integer(forKey: "kept") == 2, "a retry keeps the new app's own values")
    assert(defaults.bool(forKey: "legacyStateMigrated"))
}
print("Legacy state checks passed.")
