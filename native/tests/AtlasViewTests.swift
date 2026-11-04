// The map's frame loop: the scheduler's resume paths, and the watchdog finding each way the loop
// can stop (a paused view or scene, a missed visibility change, a wedged display link) and mending it.
// Drawn in a transparent window that takes no clicks; the scene has a scrap of art so the sea drifts.
import AppKit
import SpriteKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
AtlasView.ignoreOcclusion = true

func image() -> CGImage {
    let ctx = CGContext(data: nil, width: 4, height: 4, bitsPerComponent: 8, bytesPerRow: 16,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.6, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
    return ctx.makeImage()!
}
let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 240, height: 160), styleMask: [.borderless], backing: .buffered, defer: false)
window.alphaValue = 0
window.ignoresMouseEvents = true
let scene = AtlasScene(size: CGSize(width: 240, height: 160))
var view = AtlasView(frame: window.contentView!.bounds, scene: scene)
window.contentView!.addSubview(view)
window.orderFrontRegardless()
scene.setArt(frames: ["dot": image()], tiles: ["water": image(), "glints": image(), "clouds": image()], constants: [:], reduced: false)
view.govern()

func pump(_ seconds: Double) { RunLoop.main.run(until: Date() + seconds) }
/// Frames drawn over `seconds`.
func frames(over seconds: Double = 0.8) -> Int {
    let before = scene.framesDrawn
    pump(seconds)
    return scene.framesDrawn - before
}
let later = { CACurrentMediaTime() + 60 }
/// The main thread busy a few frames, as under load: the display link's next frame waits in the main queue.
func busy() { usleep(60_000) }

// It draws while the sea drifts, rests while covered (Conquer, a page in its place) or hidden, and resumes after.
assert(frames() > 5, "draws at its ambient rate")
assert(view.stall() == nil)
view.covered = true
pump(0.3)
assert(view.isPaused && frames() == 0, "rests while covered")
assert(view.stall() == nil, "a covered map isn't stalled")
view.covered = false
assert(!view.isPaused && frames() > 5, "resumes when uncovered")
view.isHidden = true
view.govern()
assert(view.isPaused && frames() == 0, "rests while hidden")
view.isHidden = false
view.govern()
assert(frames() > 5, "resumes when shown")

// A missed visibility change: the watchdog takes the window's word on the second look.
view.missOcclusion()
assert(view.isPaused && view.stall() != nil)
view.watch()
assert(view.recoveries == 0, "one look isn't enough")
view.watch()
assert(view.recoveries == 1 && !view.isPaused, "the second restarts it")
assert(frames() > 5)

// The view paused, or the scene alone paused (it draws but nothing moves), behind the scheduler's back.
view.isPaused = true
assert(view.stall() == "the view was paused while the map should draw")
view.watch(); view.watch()
assert(view.recoveries == 2 && frames() > 5)
scene.isPaused = true
assert(view.stall() == "the scene was paused under a running view")
view.watch(); view.watch()
assert(view.recoveries == 3 && !scene.isPaused && frames() > 5)

// Each recovery asks the page to post its world again.
var asked: [String] = []
view.onRecover = { asked.append($0) }

// SpriteKit's CVDisplayLink stopped: no frames (not even one queued before the stop); restarting the loop brings them back.
busy()
view.wedgeDisplayLink("cv")
assert(frames() == 0, "a stopped display link draws nothing")
assert(view.stall(now: later())?.hasPrefix("no frame for") == true)
view.watch(now: later()); view.watch(now: later())
assert(view.recoveries == 4 && asked.count == 1, "restarted, and the page asked to post again")
assert(frames() > 5, "restarting the loop mends a stopped display link")

// A display change restarts the link of its own accord.
busy()
view.wedgeDisplayLink("cv")
assert(frames() == 0)
NotificationCenter.default.post(name: NSApplication.didChangeScreenParametersNotification, object: app)
assert(frames(over: 1.2) > 5, "the displays changing restarts the display link")

// The display link's callback left "in progress": every frame is skipped, and only a fresh view mends it.
var rebuilt: AtlasView?
view.onRebuild = { old in
    old.retire()
    let next = old.successor()
    old.superview!.replaceSubview(old, with: next)
    next.govern()
    rebuilt = next
}
busy()
view.wedgeDisplayLink("link")
assert(frames() == 0, "a wedged display link draws nothing")
view.watch(now: later()); view.watch(now: later())
assert(view.recoveries == 5 && rebuilt == nil, "first it restarts the loop")
assert(frames() == 0, "which doesn't mend this")
view.watch(now: later()); view.watch(now: later())
assert(rebuilt != nil, "then a fresh view takes its place")
let old = view
view = rebuilt!
assert(old.superview == nil && old.scene == nil && view.scene === scene, "the scene moves to the fresh view")
assert(view.recoveries == 6 && asked.count == 3, "the fresh view keeps the account")
assert(frames() > 5, "and draws")
old.watch(now: later()); old.watch(now: later())
assert(view.recoveries == 6, "the retired view watches no more")
assert(view.stall() == nil)

// Idle stays cheap: nothing moving (reduced motion) draws the change and rests.
scene.setMotion(reduced: true)
pump(0.4)
assert(view.isPaused && frames() == 0 && view.stall() == nil, "rests when nothing moves")
scene.setMotion(reduced: false)
assert(frames() > 5)

print("Atlas view checks passed.")
