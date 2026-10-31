import AppKit
import Foundation

// Fake Music and AppleScript: these checks cannot control the user's player.
var probes = 0
var scripts = 0
let controller = MusicController(isRunning: { probes += 1; return true }, execute: { _ in
    scripts += 1
    return (nil, nil)
})
controller.watch(true)
for command in ["play", "playpause", "next", "previous"] { controller.command(command) }
assert(probes == 0 && scripts == 0, "Music must do nothing before opt-in")
controller.setEnabled(true)
controller.watch(true)
let deadline = Date().addingTimeInterval(2)
while scripts == 0 && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
assert(scripts > 0, "Opt-in starts the fake reader")
controller.setEnabled(false)
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
let stopped = (probes, scripts)
controller.watch(true)
for command in ["play", "playpause", "next", "previous"] { controller.command(command) }
assert(probes == stopped.0 && scripts == stopped.1, "Opt-out stops reads and commands")
print("Music opt-in checks passed.")
