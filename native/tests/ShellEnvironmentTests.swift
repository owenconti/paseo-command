let block = Data("Last login: today\n\(ShellEnvironment.marker)PATH=/a:/b\0LINEAR_API_KEY=x=y\0EMPTY=\0\(ShellEnvironment.marker)bye\n".utf8)
let parsed = ShellEnvironment.parse(block)!
assert(parsed["PATH"] == "/a:/b" && parsed["LINEAR_API_KEY"] == "x=y" && parsed["EMPTY"] == "")
assert(ShellEnvironment.parse(Data("no markers".utf8)) == nil)
assert(ShellEnvironment.parse(Data("\(ShellEnvironment.marker)HOME=/h\0\(ShellEnvironment.marker)".utf8)) == nil)

// startsWithAppEnvironmentWhenShellFails: a shell that can't start, or hangs, gives
// nil within the timeout (the server then gets the app's own environment).
var started = Date()
assert(ShellEnvironment.capture(shell: "/bin/sh -c 'sleep 30'", timeout: 1) == nil)
assert(Date().timeIntervalSince(started) < 2)
let hang = FileManager.default.temporaryDirectory.appendingPathComponent("paseo-hanging-shell-\(getpid())")
try! "#!/bin/sh\nsleep 30\n".write(to: hang, atomically: true, encoding: .utf8)
try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hang.path)
started = Date()
assert(ShellEnvironment.capture(shell: hang.path, timeout: 1) == nil)
assert(Date().timeIntervalSince(started) < 2, "a hanging shell is given up on")
try? FileManager.default.removeItem(at: hang)

let shell = ShellEnvironment.capture()
assert(shell?["PATH"] != nil, "the user's shell environment could be read")
print("Native shell environment checks passed.")
