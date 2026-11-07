// The Dungeon Board's scene: picking (a robot before its alcove, an alcove before its project, a PR
// medallion before both), hover and its card's place, selection, the camera's limits and fit, the HUD
// in screen space, tiles covering their boxes exactly, the frame loop resting with reduced motion,
// and the view swapping the Atlas's scene for it. Drawn in a transparent window that takes no clicks.
import AppKit
import SpriteKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
AtlasView.ignoreOcclusion = true

func image(_ w: Int = 8, _ h: Int = 8) -> CGImage {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 0.5, green: 0.3, blue: 0.7, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}
let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.borderless], backing: .buffered, defer: false)
window.alphaValue = 0
window.ignoresMouseEvents = true
var view = AtlasView(frame: window.contentView!.bounds, scene: AtlasScene(size: CGSize(width: 400, height: 300)))
window.contentView!.addSubview(view)
window.orderFrontRegardless()
func pump(_ seconds: Double) { RunLoop.main.run(until: Date() + seconds) }

// The page mounts the Dungeon Board: its scene takes the view's place, as `WorldWindow.adopt` does.
let scene = makeMapScene(kind: "dungeon", size: CGSize(width: 400, height: 300))
assert(scene.kind == "dungeon" && scene is DungeonScene)
assert(makeMapScene(kind: "atlas", size: .zero).kind == "atlas", "anything else is the Atlas")
view.retire()
let next = view.successor(scene: scene)
window.contentView!.replaceSubview(view, with: next)
view = next
var events: [[String: Any]] = []
scene.emit = { events.append($0) }

let names = ["wall-brick", "wall-brick-dark", "border", "pillar", "robot-orange-idle-0", "robot-orange-idle-1",
             "robot-orange-work-0", "robot-orange-work-1", "torch-0", "torch-1", "node", "pr-ci-green", "drone-orange-0"]
scene.setArt(frames: Dictionary(uniqueKeysWithValues: names.map { ($0, image()) }), tiles: [:],
             constants: ["sizes": Dictionary(uniqueKeysWithValues: names.map { ($0, [32.0, 32.0]) }), "maxZoom": 3.0], reduced: false)
assert(events.contains { $0["type"] as? String == "ready" }, "ready once it has its art")
view.govern()

// A board 1000 × 800: a project, its alcove, a robot in it, a PR medallion on the alcove's frame.
scene.setScene([
    "rev": 1,
    "bounds": ["x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0],
    "sprites": [
        ["f": "wall-brick", "x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0, "z": -50.0, "tile": "xy", "ox": 7.0, "oy": 3.0],
        ["f": "torch-0", "anim": ["torch-0", "torch-1"], "fps": 8.0, "x": 10.0, "y": 10.0, "w": 16.0, "h": 40.0, "z": -4.0],
    ],
    "images": [] as [[String: Any]],
    "flags": [["ws": "w1", "flag": "ci-green", "f": "pr-ci-green", "x": 100.0, "y": 300.0, "w": 18.0, "h": 18.0, "z": 5.0, "cx": 109.0, "cy": 309.0, "s": 18.0]],
    "lights": [["x": 0.0, "y": 100.0, "c": 0xffb640, "r": 60.0, "flicker": true, "still": 1.0]],
    "entities": [
        ["id": "p1", "kind": "project", "x": 100.0, "y": 140.0, "w": 200.0, "h": 90.0],
        ["id": "w1", "kind": "workspace", "x": 80.0, "y": 280.0, "w": 260.0, "h": 110.0],
        ["id": "a1", "kind": "agent", "x": 180.0, "y": 330.0, "w": 40.0, "h": 46.0],
    ],
], images: [:])
scene.setAgents([
    "rev": 2,
    "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0", "robot-orange-idle-1"],
                "work": ["robot-orange-work-0", "robot-orange-work-1"], "busy": true, "ph": 0.3, "subagents": 1, "drones": [["drone-orange-0"]]]],
    "hud": ["title": ["key": "hud:title", "w": 300.0, "h": 60.0], "counts": ["key": "hud:counts", "w": 500.0, "h": 50.0]],
], images: ["hud:title": image(30, 6), "hud:counts": image(50, 5)])
assert(scene.sceneRevision == 1 && scene.agentsRevision == 2, "revisions applied")

let state = scene.state()
let zoom = state["zoom"] as! CGFloat, minimum = state["minimumZoom"] as! CGFloat
assert(abs(zoom - minimum) < 0.0001, "a new board is fitted")
let hud = state["hud"] as! [String: Bool]
assert(hud["title"] == true && hud["counts"] == true, "the HUD's title and count bar show")

/// The surface point over a world point, at the camera's centre and zoom now.
func screen(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
    let s = scene.state(), z = s["zoom"] as! CGFloat, c = s["center"] as! [String: CGFloat]
    return CGPoint(x: (x - c["x"]!) * z + 200, y: (y - c["y"]!) * z + 150)
}
func click(_ x: CGFloat, _ y: CGFloat) -> String? {
    events = []
    scene.pointer(phase: "down", at: screen(x, y))
    scene.pointer(phase: "up", at: screen(x, y))
    return events.first { $0["type"] as? String == "pick" }?["id"] as? String
}
assert(click(200, 350) == "a1", "a robot is picked before its alcove")
assert(click(300, 360) == "w1", "the alcove around it")
assert(click(250, 180) == "p1", "the project's terrace wall")
assert(click(109, 309) == "w1", "a PR medallion picks its workspace")
assert(click(-400, 700) == nil, "bare stone picks nothing")

// Hover: the medallion's card points at the medallion's top; the robot's at the robot's.
events = []
scene.pointer(phase: "move", at: screen(109, 309))
let flagHover = events.last { $0["type"] as? String == "hover" }!
assert(flagHover["id"] as? String == "w1" && flagHover["flag"] as? String == "ci-green")
scene.pointer(phase: "move", at: screen(200, 350))
let agentHover = events.last { $0["type"] as? String == "hover" }!
assert(agentHover["id"] as? String == "a1" && agentHover["flag"] == nil)
let top = screen(200, 330)
assert(abs((agentHover["y"] as! CGFloat) - top.y) < 0.5, "the card points at the robot's top")
// The hovered robot glows along its own silhouette (halo nodes on its body), never a rim round a box.
func glowCount(_ n: SKNode) -> Int { (n.name == "hover-glow" ? 1 : 0) + n.children.reduce(0) { $0 + glowCount($1) } }
func shapeCount(_ n: SKNode) -> Int { (n is SKShapeNode && n.parent?.zPosition == 19 ? 1 : 0) + n.children.reduce(0) { $0 + shapeCount($1) } }
assert(glowCount(scene) >= 2, "a hovered robot glows")
assert(shapeCount(scene) == 0, "no hover rim")
scene.pointer(phase: "leave", at: .zero)
assert(scene.state()["hovered"] is NSNull)
assert(glowCount(scene) == 0, "the glow goes with the hover")

// Selection draws for a known entity and clears for a gone one.
scene.select("w1")
assert(scene.state()["selected"] as? String == "w1")
// A selected robot glows gold along its body (a halo, a lift and a wider halo), with no rim, wash or box.
scene.select("a1")
func named(_ n: SKNode, _ name: String) -> Int { (n.name == name ? 1 : 0) + n.children.reduce(0) { $0 + named($1, name) } }
func shapes(_ n: SKNode) -> Int { (n is SKShapeNode && (n.parent?.zPosition ?? 0) >= 19 ? 1 : 0) + n.children.reduce(0) { $0 + shapes($1) } }
assert(named(scene, "select-glow") == 3, "a selected robot glows")
assert(shapes(scene) == 0, "no selection rim")
scene.select("gone")
assert(scene.state()["selected"] is NSNull)

// The camera: never out past the fit, never in past its limit, and panned only within the board.
scene.wheel(at: CGPoint(x: 200, y: 150), dy: 2000)
assert(abs((scene.state()["zoom"] as! CGFloat) - minimum) < 0.0001, "no further out than the fit")
for _ in 0..<40 { scene.wheel(at: CGPoint(x: 200, y: 150), dy: -400) }
assert((scene.state()["zoom"] as! CGFloat) <= 3.0001, "no closer than its limit")
scene.pointer(phase: "down", at: CGPoint(x: 200, y: 150))
scene.pointer(phase: "move", at: CGPoint(x: 5000, y: 5000))
scene.pointer(phase: "up", at: CGPoint(x: 5000, y: 5000))
let c = scene.state()["center"] as! [String: CGFloat], z = scene.state()["zoom"] as! CGFloat
assert(c["x"]! - 200 / z >= -500 - 8 - 0.5 && c["y"]! - 150 / z >= -8 - 0.5, "panning stays within the board")
scene.command("home")
assert(abs((scene.state()["zoom"] as! CGFloat) - minimum) < 0.0001, "Home fits again")

// Focus pans to an entity out of view.
for _ in 0..<20 { scene.wheel(at: CGPoint(x: 0, y: 0), dy: -400) }
scene.focus("a1", closer: true)
pump(0.6)
let focused = scene.state()["center"] as! [String: CGFloat]
assert(abs(focused["x"]! - 200) < 40 && abs(focused["y"]! - 353) < 40, "focus brings the robot to the middle")

// It draws while things move, and rests with reduced motion once nothing does.
pump(0.5)
let drawn = scene.framesDrawn
pump(0.6)
assert(scene.framesDrawn - drawn > 5, "torches, robots and the run of light animate")
scene.setMotion(reduced: true)
scene.select(nil)
pump(2)
let rested = scene.framesDrawn
pump(0.6)
assert(scene.framesDrawn - rested <= 1, "nothing moves with reduced motion, so it rests")

// With only the flames' slow flicker and resting robots (steady light, nothing selected), it idles at the drift rate;
// a robot at work brings back the ambient rate.
scene.setMotion(reduced: false)
scene.setAgents(["rev": 3, "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0", "robot-orange-idle-1"],
    "work": ["robot-orange-work-0"], "busy": false, "ph": 0.3]], "lights": [["x": 0.0, "y": 100.0, "r": 40.0, "still": 1.0]]], images: [:])
assert(!scene.animating && scene.drifting, "only flames and resting robots: the drift rate")
scene.setAgents(["rev": 4, "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0"],
    "work": ["robot-orange-work-0", "robot-orange-work-1"], "busy": true, "ph": 0.3]]], images: [:])
assert(scene.animating, "a robot at work: the ambient rate")

print("DungeonScene: ok")
