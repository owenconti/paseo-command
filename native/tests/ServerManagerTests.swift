let me = getpid()
assert(ServerManager.classify(health: nil) == .free)
assert(ServerManager.classify(health: Data(#"{"ready":true,"pid":5,"ownerPid":\#(me),"version":"0.2.0"}"#.utf8)) == .ours(pid: 5))
assert(ServerManager.classify(health: Data(#"{"ready":true,"pid":5,"ownerPid":7}"#.utf8)) == .otherHelper(pid: 5, ownerPid: 7))
assert(ServerManager.classify(health: Data("<!doctype html><title>Vite</title>".utf8)) == .foreign)
assert(ServerManager.classify(health: Data()) == .foreign)
assert(ServerManager.classify(health: Data(#"{"ok":true}"#.utf8)) == .foreign)

// resolvesResourcesFromAnyBundlePath
let found = ServerManager.resources(in: URL(fileURLWithPath: "/Volumes/X/Paseo Command.app"))
assert(found.node.path == "/Volumes/X/Paseo Command.app/Contents/Resources/node/node")
assert(found.server.path == "/Volumes/X/Paseo Command.app/Contents/Resources/server/server.mjs")
assert(found.ui.path == "/Volumes/X/Paseo Command.app/Contents/Resources/ui")

// waitsForPortHeldByExitingHelper: a pid that has just exited is dead.
let gone = Process()
gone.executableURL = URL(fileURLWithPath: "/usr/bin/true")
try! gone.run()
gone.waitUntilExit()
assert(ServerManager.shouldWait(for: .otherHelper(pid: 5, ownerPid: gone.processIdentifier)))
assert(!ServerManager.shouldWait(for: .otherHelper(pid: 5, ownerPid: me)))
assert(!ServerManager.shouldWait(for: .foreign))
assert(!ServerManager.shouldWait(for: .free))
// keepsTheShellsNodeSettingsFromTheBundledNode
let env = ServerManager.serverEnvironment(["PATH": "/bin", "GH_TOKEN": "t", "NODE_OPTIONS": "--require /x.js", "NODE_PATH": "/lib",
                                           "PASEO_COMMAND_RESOLVING_ENVIRONMENT": "1"],
                                          data: URL(fileURLWithPath: "/d"), ui: URL(fileURLWithPath: "/u"), port: 4321)
assert(env["PATH"] == "/bin" && env["GH_TOKEN"] == "t", "the shell's own settings pass through")
assert(env["NODE_OPTIONS"] == nil && env["NODE_PATH"] == nil && env["PASEO_COMMAND_RESOLVING_ENVIRONMENT"] == nil)
assert(env["PASEO_COMMAND_DATA"] == "/d" && env["PASEO_NATIVE_UI"] == "/u" && env["PASEO_NATIVE_PORT"] == "4321")
assert(env["PASEO_NATIVE_OWNER_PID"] == String(me))
print("Native server manager checks passed.")
