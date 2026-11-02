enum Log { static func line(_ text: String) {} }

// detectsMissingBundleParts: the bundle itself, its Node or its server.
let app = URL(fileURLWithPath: "/tmp/ws/native/build/Paseo Command Dev.app")
let node = app.path + "/Contents/Resources/node/node", server = app.path + "/Contents/Resources/server/server.mjs"
assert(BundleHome.missing(in: app, exists: { _ in true }) == nil)
assert(BundleHome.missing(in: app, exists: { _ in false }) == app.path)
assert(BundleHome.missing(in: app, exists: { $0 != node }) == node)
assert(BundleHome.missing(in: app, exists: { $0 != server }) == server)

// devReplacementIsTheMainCheckoutsBuild: never another workspace's, nor itself.
let main = URL(fileURLWithPath: "/Users/example/paseo-command/native/build/Paseo Command Dev.app")
let other = URL(fileURLWithPath: "/tmp/other-ws/native/build/Paseo Command Dev.app")
assert(BundleHome.replacement(for: app, isRelease: false, mainCheckout: "/Users/example/paseo-command", registered: [other], whole: { _ in true }) == main)
assert(BundleHome.replacement(for: app, isRelease: false, mainCheckout: "/Users/example/paseo-command", registered: [other], whole: { $0 != main }) == nil)
assert(BundleHome.replacement(for: app, isRelease: false, mainCheckout: nil, registered: [other], whole: { _ in true }) == nil)
assert(BundleHome.replacement(for: main, isRelease: false, mainCheckout: "/Users/example/paseo-command/", registered: [], whole: { _ in true }) == nil)

// releaseReplacementPrefersApplications, then Launch Services' whole copies.
let release = URL(fileURLWithPath: "/Volumes/Old/Paseo Command.app")
let apps = URL(fileURLWithPath: "/Applications/Paseo Command.app"), home = URL(fileURLWithPath: "/Users/example/Applications/Paseo Command.app")
let elsewhere = URL(fileURLWithPath: "/Users/example/Desktop/Paseo Command.app")
assert(BundleHome.replacement(for: release, isRelease: true, mainCheckout: nil, registered: [elsewhere], home: "/Users/example", whole: { _ in true }) == apps)
assert(BundleHome.replacement(for: release, isRelease: true, mainCheckout: nil, registered: [elsewhere], home: "/Users/example", whole: { $0 != apps }) == home)
assert(BundleHome.replacement(for: release, isRelease: true, mainCheckout: nil, registered: [release, elsewhere], home: "/Users/example", whole: { $0 == release || $0 == elsewhere }) == elsewhere)
assert(BundleHome.replacement(for: apps, isRelease: true, mainCheckout: nil, registered: [apps], home: "/Users/example", whole: { $0 == apps }) == nil)

// namesTheMissingCopy
assert(BundleHome.Gone(app: app).localizedDescription.contains(app.path))
print("Native bundle home checks passed.")
