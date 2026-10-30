let block = Data("Last login: today\n\(ShellEnvironment.marker)PATH=/a:/b\0LINEAR_API_KEY=x=y\0EMPTY=\0\(ShellEnvironment.marker)bye\n".utf8)
let parsed = ShellEnvironment.parse(block)!
assert(parsed["PATH"] == "/a:/b" && parsed["LINEAR_API_KEY"] == "x=y" && parsed["EMPTY"] == "")
assert(ShellEnvironment.parse(Data("no markers".utf8)) == nil)
assert(ShellEnvironment.parse(Data("\(ShellEnvironment.marker)HOME=/h\0\(ShellEnvironment.marker)".utf8)) == nil)

assert(ShellEnvironment.newerVersion("v22.12.0", "v20.19.1"))
assert(ShellEnvironment.newerVersion("v22.12.0", "v22.9.0"))
assert(!ShellEnvironment.newerVersion("v20.0.0", "v20.0.0"))

let installed: Set<String> = ["/h/.nvm/versions/node/v22.12.0/bin/node", "/h/.nvm/versions/node/v20.19.0/bin/node", "/opt/homebrew/bin/node", "/p/node"]
let list: (String) -> [String] = { $0 == "/h/.nvm/versions/node" ? ["v20.19.0", "v22.12.0"] : [] }
assert(ShellEnvironment.node(in: ["PATH": "/x:/p"], home: "/h", isExecutable: installed.contains, list: list) == "/p/node")
assert(ShellEnvironment.node(in: ["PATH": "/usr/bin"], home: "/h", isExecutable: installed.contains, list: list) == "/h/.nvm/versions/node/v22.12.0/bin/node")
assert(ShellEnvironment.node(in: [:], home: "/h", isExecutable: { $0 == "/opt/homebrew/bin/node" }, list: { _ in [] }) == "/opt/homebrew/bin/node")
assert(ShellEnvironment.node(in: [:], home: "/h", isExecutable: { _ in false }, list: { _ in [] }) == nil)

let shell = ShellEnvironment.capture()
assert(shell?["PATH"] != nil, "the user's shell environment could be read")
print("Native shell environment checks passed.")
