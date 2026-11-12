// The Dungeon Board's scene: picking (a robot before its alcove, an alcove before its project, a PR
// medallion before both), hover and its card's place, selection, the camera's limits and fit, the HUD
// in screen space (its At a Glance panel, and room for its title over the vault), the vault's niches picked as tiles, tiles covering their boxes exactly, the frame loop resting with reduced motion,
// the conversation's camera (the robot talked to framed above the page's dialogue box, left where the user looks, the
// board kept in its place, and back after, fitted again when it was), and the view swapping the Atlas's scene for it. Drawn in a transparent window that takes no clicks.
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
        ["f": "pillar", "x": 80.0, "y": 287.0, "w": 24.0, "h": 101.0, "z": -11.0, "e": "w1"],
        ["f": "border", "x": 100.0, "y": 280.0, "w": 220.0, "h": 22.0, "z": -10.9, "tile": "x", "e": "w1"],
    ],
    "images": [] as [[String: Any]],
    "flags": [["ws": "w1", "flag": "ci-green", "f": "pr-ci-green", "x": 100.0, "y": 300.0, "w": 18.0, "h": 18.0, "z": 5.0, "cx": 109.0, "cy": 309.0, "s": 18.0]],
    "lights": [["x": 0.0, "y": 100.0, "c": 0xffb640, "r": 60.0, "flicker": true, "still": 1.0]],
    "thresholds": [
        ["id": "p1", "x": 103.0, "y": 235.0, "w": 194.0, "accents": [["x": 100.0, "y": 143.0, "w": 20.0, "h": 3.0]], "badge": ["x": 180.0, "y": 165.0]],
        // Its second hall (a long project continued on the other side).
        ["id": "p1", "x": -397.0, "y": 235.0, "w": 194.0, "accents": [["x": -400.0, "y": 143.0, "w": 20.0, "h": 3.0]], "badge": ["x": -320.0, "y": 165.0]],
        ["id": "w1", "x": 97.0, "y": 385.0, "w": 226.0, "accents": [["x": 85.0, "y": 378.0, "w": 11.0, "h": 3.0]]],
    ],
    "entities": [
        ["id": "p1", "kind": "project", "x": 100.0, "y": 140.0, "w": 200.0, "h": 90.0],
        ["id": "p1", "kind": "project", "x": -400.0, "y": 140.0, "w": 200.0, "h": 90.0],
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
assert(click(-300, 180) == "p1", "its second hall's wall is the project too")
scene.pointer(phase: "leave", at: .zero)
events = []
scene.pointer(phase: "move", at: screen(-300, 180))
let secondHall = events.last { $0["type"] as? String == "hover" }!
assert(secondHall["id"] as? String == "p1" && abs((secondHall["x"] as! CGFloat) - screen(-300, 140).x) < 0.5, "its card points at the hall under the pointer")
scene.pointer(phase: "leave", at: .zero)
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
// And says where its bottom is, for a card with no room above it (the medallion's: its disc's foot, 18 / 2 + 2 below its centre).
assert(abs((agentHover["bottom"] as! CGFloat) - screen(200, 376).y) < 0.5, "the robot's bottom edge")
assert(abs((flagHover["bottom"] as! CGFloat) - screen(109, 320).y) < 0.5, "the medallion's bottom edge")
// The hovered robot glows along its own silhouette (halo nodes on its body), never a rim round a box.
func glowCount(_ n: SKNode) -> Int { (n.name == "hover-glow" ? 1 : 0) + n.children.reduce(0) { $0 + glowCount($1) } }
func shapeCount(_ n: SKNode) -> Int { (n is SKShapeNode && n.parent?.zPosition == 19 ? 1 : 0) + n.children.reduce(0) { $0 + shapeCount($1) } }
assert(glowCount(scene) >= 2, "a hovered robot glows")
func hoverLights(_ n: SKNode) -> [SKNode] {
    (n.name == "hover-glow" ? [n] : []) + n.children.flatMap { hoverLights($0) }
}
assert(hoverLights(scene).allSatisfy { $0.alpha <= 0.45 }, "hover stays quieter than gold selection and the state lights")
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

// Architectural markers are exact physical spans; they need no view-texture composite or bloom.
func findNode(_ n: SKNode, _ name: String) -> SKNode? { n.name == name ? n : n.children.lazy.compactMap { findNode($0, name) }.first }
scene.pointer(phase: "move", at: screen(300, 360))
assert(named(scene, "hover-threshold") == 0 && named(scene, "hover-capital") == 0, "workspace hover adds no metal rails")
assert(named(scene, "hover-candlelight") == 2, "a hovered alcove fills with candlelight")
let candle = findNode(scene, "hover-candlelight") as! SKSpriteNode
assert(candle.blendMode == .add && candle.zPosition > -12 && candle.zPosition < -11,
       "the light lies over the bay's interior, behind its stone frame and ledge")
assert(glowCount(scene) == 0, "hovering a workspace adds no silhouette glow")
scene.select("w1")
let wsThreshold = findNode(scene, "select-threshold") as! SKSpriteNode
assert(wsThreshold.size.width == 226 && wsThreshold.position.y == -385)
assert(named(scene, "hover-threshold") == 0, "selecting a hovered workspace removes its temporary cue")
assert(named(scene, "hover-candlelight") == 0, "selection clears the hover's candlelight")
assert(named(scene, "select-glow") == 0, "architecture has no selection bloom")
// A medallion on that same workspace can still hover, then return to the selected workspace.
scene.pointer(phase: "move", at: screen(109, 309))
assert(glowCount(scene) >= 2 && named(scene, "select-threshold") == 1)
scene.pointer(phase: "move", at: screen(300, 360))
assert(glowCount(scene) == 0 && named(scene, "hover-threshold") == 0)
scene.select("p1")
let projectThreshold = findNode(scene, "select-threshold") as! SKSpriteNode
assert(projectThreshold.size.width == 194 && projectThreshold.position.y == -235)
assert(named(scene, "select-sign-diamond") == 2 && named(scene, "select-threshold") == 2, "every hall of the project is marked")
assert(named(scene, "hover-candlelight") == 2, "a different workspace can hover while the project stays selected")
scene.pointer(phase: "leave", at: .zero)
assert(named(scene, "hover-threshold") == 0 && named(scene, "select-threshold") == 2)
assert(named(scene, "hover-candlelight") == 0, "leaving puts the candles back")
scene.select(nil)
assert(named(scene, "select-threshold") == 0 && named(scene, "select-sign-diamond") == 0)

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
// working robots use the same calm poses; a running ring still brings back the ambient rate.
scene.setMotion(reduced: false)
scene.setAgents(["rev": 3, "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0", "robot-orange-idle-1"],
    "work": ["robot-orange-work-0"], "busy": false, "ph": 0.3]], "lights": [["x": 0.0, "y": 100.0, "r": 40.0, "still": 1.0]]], images: [:])
assert(!scene.animating && scene.drifting, "only flames and resting robots: the drift rate")
scene.setAgents(["rev": 4, "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0"],
    "work": ["robot-orange-work-0", "robot-orange-work-1"], "busy": true, "ph": 0.3]]], images: [:])
assert(!scene.animating && scene.drifting, "working poses alone need only the drift rate")
// The body never switches to its work-pose frames and moves less than one pixel over a full cycle.
func body(_ n: SKNode) -> SKSpriteNode? {
    if let n = n as? SKSpriteNode, n.zPosition == 10 { return n }
    return n.children.compactMap { body($0) }.first
}
let calmBody = body(scene)!, calmTexture = body(scene)!.texture
var positions: [CGFloat] = []
let start = CACurrentMediaTime()
for i in 0..<80 {
    scene.update(start + Double(i) * 0.2)
    positions.append(calmBody.position.y)
    assert(calmBody.texture === calmTexture, "one idle pose stays calm when its work frames differ")
}
assert(positions.max()! - positions.min()! <= 1.01, "a breath, with no hopping")
scene.setAgents(["rev": 41, "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0,
    "idle": ["robot-orange-idle-0"], "busy": true, "glow": ["w": 50.0, "h": 15.0, "runner": 1.0]]]], images: [:])
assert(scene.animating, "the spinning working ring is preserved")

// The vault: a tile niche over the first gate is picked as its tile (the page opens its first PR), its top kept below the
// HUD's title by the fit; the At a Glance panel shows at the top right.
let zoomBefore = scene.state()["minimumZoom"] as! CGFloat
scene.setScene([
    "rev": 5,
    "bounds": ["x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0],
    "vaultTop": 20.0,
    "sprites": [["f": "wall-brick", "x": -60.0, "y": 20.0, "w": 40.0, "h": 38.0, "z": -44.6, "e": "tile:prs:merged"]],
    "images": [] as [[String: Any]],
    "entities": [
        ["id": "tile:prs:merged", "kind": "tile", "x": -60.0, "y": 20.0, "w": 40.0, "h": 38.0],
        ["id": "a1", "kind": "agent", "x": 180.0, "y": 330.0, "w": 40.0, "h": 46.0],
    ],
], images: [:])
scene.setAgents([
    "rev": 6,
    "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0"], "work": ["robot-orange-work-0"], "busy": false, "ph": 0.3]],
    "hud": ["title": ["key": "hud:title", "w": 300.0, "h": 60.0], "counts": ["key": "hud:counts", "w": 500.0, "h": 50.0],
            "panel": ["key": "hud:glance", "w": 220.0, "h": 420.0]],
], images: ["hud:glance": image(22, 42)])
scene.command("home")
let vaultState = scene.state()
assert((vaultState["hud"] as! [String: Bool])["panel"] == true, "the At a Glance panel shows")
assert((vaultState["minimumZoom"] as! CGFloat) < zoomBefore, "the fit keeps room above the board for the title")
assert(screen(-40, 20).y >= 14 + 60 + 4 - 0.5, "the vault's niches show below the HUD's title")
assert(click(-40, 40) == "tile:prs:merged", "a vault niche is picked as its tile")
scene.pointer(phase: "leave", at: .zero)
events = []
scene.pointer(phase: "move", at: screen(-40, 40))
assert((events.last { $0["type"] as? String == "hover" })?["id"] as? String == "tile:prs:merged", "and hovered, for its card")
scene.pointer(phase: "leave", at: .zero)
// Where the view can't spare its width beside the board, the panel doesn't show (it never lies over the board).
scene.setAgents([
    "rev": 7,
    "robots": [["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0"], "work": ["robot-orange-work-0"], "busy": false, "ph": 0.3]],
    "hud": ["title": ["key": "hud:title", "w": 300.0, "h": 60.0], "counts": ["key": "hud:counts", "w": 500.0, "h": 50.0],
            "panel": ["key": "hud:wide", "w": 400.0, "h": 100.0]],
], images: ["hud:wide": image(40, 10)])
assert((scene.state()["hud"] as! [String: Bool])["panel"] == false, "too wide a panel for the view: hidden")

// A conversation (the page's dialogue box over the map's bottom): the robot talked to is framed above the box, even one on
// the bottom floor, which the box would otherwise cover; the count bar under the box fades; the camera goes back after.
scene.setScene([
    "rev": 8,
    "bounds": ["x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0],
    "sprites": [] as [[String: Any]],
    "images": [] as [[String: Any]],
    "entities": [
        ["id": "a1", "kind": "agent", "x": 180.0, "y": 330.0, "w": 40.0, "h": 46.0],
        ["id": "a2", "kind": "agent", "x": -324.0, "y": 735.0, "w": 48.0, "h": 61.0],
    ],
], images: [:])
let talkRobots: [[String: Any]] = [
    ["id": "a1", "x": 182.0, "y": 332.0, "w": 36.0, "h": 42.0, "idle": ["robot-orange-idle-0"], "work": ["robot-orange-work-0"], "busy": false, "ph": 0.3],
    ["id": "a2", "x": -322.0, "y": 737.0, "w": 44.0, "h": 57.0, "idle": ["robot-orange-idle-0"], "work": ["robot-orange-work-0"], "busy": false, "ph": 0.6],
]
let talkHud: [String: Any] = ["title": ["key": "hud:title", "w": 300.0, "h": 60.0], "counts": ["key": "hud:counts", "w": 500.0, "h": 50.0]]
scene.setAgents(["rev": 9, "robots": talkRobots, "hud": talkHud], images: [:])
scene.command("home")
scene.wheel(at: CGPoint(x: 200, y: 150), dy: -300)
pump(0.1)
func camera() -> (center: CGPoint, zoom: CGFloat) {
    let s = scene.state(), c = s["center"] as! [String: CGFloat]
    return (CGPoint(x: c["x"]!, y: c["y"]!), s["zoom"] as! CGFloat)
}
let before = camera()
/// A board rect on the surface, as `reportHover` converts it.
func onScreen(_ r: CGRect) -> CGRect {
    let (c, z) = camera(), v = view.bounds.size
    return CGRect(x: (r.minX - (c.x - v.width / 2 / z)) * z, y: (r.minY - (c.y - v.height / 2 / z)) * z, width: r.width * z, height: r.height * z)
}
func framed(_ r: CGRect, above inset: CGFloat) -> Bool {
    let s = onScreen(r), v = view.bounds.size
    return s.minX >= -0.5 && s.minY >= -0.5 && s.maxX <= v.width + 0.5 && s.maxY <= v.height - inset + 0.5
}
func talkState() -> [String: Any]? { scene.state()["talk"] as? [String: Any] }
func countsShown() -> Bool { (scene.state()["hud"] as! [String: Bool])["countsShown"]! }
let a1Rect = CGRect(x: 180, y: 330, width: 40, height: 46), a2Rect = CGRect(x: -324, y: 735, width: 48, height: 61)
assert(!framed(a2Rect, above: 150), "the bottom floor's robot lies where the box will be")
assert(countsShown(), "the count bar shows before")
scene.talk(id: "a2", inset: 150)
pump(0.6)
assert(talkState()?["id"] as? String == "a2" && talkState()?["inset"] as? CGFloat == 150, "talking to a2 over a 150 pt box")
assert(framed(a2Rect, above: 150), "the bottom floor's robot is framed above the box")
assert(abs(onScreen(a2Rect).midY - 75) < 1, "in the middle of the view above the box")
assert(camera().zoom >= before.zoom - 0.0001, "framing never zooms out")
assert(!countsShown(), "the count bar fades under the box")
// A new agents post (the HUD drawn again) keeps the count bar hidden.
scene.setAgents(["rev": 10, "robots": talkRobots, "hud": talkHud], images: [:])
assert(!countsShown(), "and stays hidden while talking")
// Another robot: framed in its turn.
scene.talk(id: "a1", inset: 150)
pump(0.6)
assert(talkState()?["id"] as? String == "a1" && framed(a1Rect, above: 150), "the next speaker is framed")
// A taller box: it would cover the robot, so it's framed again above it.
scene.talk(id: "a1", inset: 240)
pump(0.6)
assert(talkState()?["inset"] as? CGFloat == 240 && framed(a1Rect, above: 240), "framed above the taller box")
// The user looks away mid-conversation (a drag): the scene posted again (a fleet update) leaves the camera where they put it.
func talkScene(_ rev: Int, a1 r: CGRect) -> [String: Any] {
    ["rev": rev, "bounds": ["x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0], "sprites": [] as [[String: Any]], "images": [] as [[String: Any]],
     "entities": [["id": "a1", "kind": "agent", "x": Double(r.minX), "y": Double(r.minY), "w": Double(r.width), "h": Double(r.height)],
                  ["id": "a2", "kind": "agent", "x": -324.0, "y": 735.0, "w": 48.0, "h": 61.0]]]
}
func same(_ a: (center: CGPoint, zoom: CGFloat), _ b: (center: CGPoint, zoom: CGFloat)) -> Bool {
    abs(a.center.x - b.center.x) < 0.5 && abs(a.center.y - b.center.y) < 0.5 && abs(a.zoom - b.zoom) < 0.0001
}
scene.pointer(phase: "down", at: CGPoint(x: 200, y: 20))
scene.pointer(phase: "move", at: CGPoint(x: 200, y: 280))
scene.pointer(phase: "up", at: CGPoint(x: 200, y: 280))
assert(!framed(a1Rect, above: 240), "looked away from the speaker")
let lookedAway = camera()
scene.setScene(talkScene(20, a1: a1Rect), images: [:])
pump(0.6)
assert(same(camera(), lookedAway), "a fleet update doesn't pull the camera back to the speaker")
// Framed, it stays framed where the robot now stands.
scene.talk(id: "a1", inset: 150)
pump(0.6)
assert(framed(a1Rect, above: 150), "framed again above the shorter box")
let a1Moved = CGRect(x: -400, y: 120, width: 40, height: 46)
scene.setScene(talkScene(21, a1: a1Moved), images: [:])
pump(0.6)
assert(framed(a1Moved, above: 150), "a moved speaker is framed where it now stands")
scene.setScene(talkScene(22, a1: a1Rect), images: [:])
pump(0.6)
assert(framed(a1Rect, above: 150), "and back")
// Ending it puts the camera back where it was before the first speaker, and the count bar back.
scene.talk(id: nil, inset: 0)
pump(0.6)
assert(scene.state()["talk"] is NSNull, "the conversation ended")
let after = camera()
assert(abs(after.center.x - before.center.x) < 0.5 && abs(after.center.y - before.center.y) < 0.5 && abs(after.zoom - before.zoom) < 0.0001,
       "the camera is back where it was")
assert(countsShown(), "the count bar shows again")
// An id the board doesn't have is no conversation: nothing moves; while talking it ends it.
scene.talk(id: "nobody", inset: 150)
pump(0.1)
assert(scene.state()["talk"] is NSNull && abs(camera().zoom - before.zoom) < 0.0001, "an unknown robot: no conversation")
scene.talk(id: "a2", inset: 150)
pump(0.6)
scene.talk(id: "nobody", inset: 150)
pump(0.6)
assert(scene.state()["talk"] is NSNull && abs(camera().center.y - before.center.y) < 0.5, "an unknown robot ends one")
// The map resized mid-conversation (⌘B): the robot stays framed above the box at once.
scene.talk(id: "a2", inset: 150)
pump(0.6)
view.frame = CGRect(x: 0, y: 0, width: 300, height: 260)
scene.size = view.frame.size
scene.viewportChanged()
assert(framed(a2Rect, above: 150), "still framed above the box in the resized map")
view.frame = CGRect(x: 0, y: 0, width: 400, height: 300)
scene.size = view.frame.size
scene.viewportChanged()
assert(framed(a2Rect, above: 150), "and again at its old size")
// The robot talked to gone from the board: the conversation ends with it.
scene.setScene(["rev": 11, "bounds": ["x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0], "sprites": [] as [[String: Any]],
                "entities": [["id": "a1", "kind": "agent", "x": 180.0, "y": 330.0, "w": 40.0, "h": 46.0]]], images: [:])
assert(scene.state()["talk"] is NSNull, "a gone robot's conversation ends")
pump(0.6)
assert(countsShown(), "and the count bar comes back")

// With the At a Glance panel's room at the right, a board the fit sets by its height and room above it for the vault:
// the board keeps its place as the box's room comes and goes, so a conversation begun and ended at the fit never jumps sideways.
func tallScene(_ rev: Int, height: Double) -> [String: Any] {
    ["rev": rev, "bounds": ["x": -200.0, "y": 0.0, "w": 400.0, "h": height], "vaultTop": 20.0, "sprites": [] as [[String: Any]],
     "images": [] as [[String: Any]], "entities": [["id": "a3", "kind": "agent", "x": 100.0, "y": 300.0, "w": 40.0, "h": 46.0],
                                                    ["id": "a4", "kind": "agent", "x": -100.0, "y": height - 60, "w": 40.0, "h": 46.0]]]
}
scene.setScene(tallScene(30, height: 800), images: [:])
scene.setAgents(["rev": 31, "robots": [] as [[String: Any]], "hud": ["title": ["key": "hud:title", "w": 300.0, "h": 60.0],
    "counts": ["key": "hud:counts", "w": 500.0, "h": 50.0], "panel": ["key": "hud:glance", "w": 220.0, "h": 420.0]]], images: [:])
scene.command("home")
assert((scene.state()["hud"] as! [String: Bool])["panel"] == true, "the panel shows beside the tall board")
let fittedCamera = camera()
scene.talk(id: "a3", inset: 150)
// The way to the speaker's first frame starts where the camera stood.
scene.update(CACurrentMediaTime())
assert(same(camera(), fittedCamera), "a conversation begun at the fit doesn't jump")
// The furthest out while talking keeps the board where the fit had it, sideways.
scene.wheel(at: CGPoint(x: 200, y: 150), dy: 5000)
assert(abs(camera().center.x - fittedCamera.center.x) < 0.5 && camera().zoom < fittedCamera.zoom, "the board keeps its place, further out")
let furthest = camera()
scene.talk(id: nil, inset: 0)
scene.update(CACurrentMediaTime())
assert(same(camera(), furthest), "the way back's first frame doesn't jump")
pump(0.6)
assert(same(camera(), fittedCamera), "and it ends at the fit")
// The whole board shown before it: fitted again after it, though the board grew meanwhile (a new floor).
scene.talk(id: "a3", inset: 150)
pump(0.6)
scene.setScene(tallScene(32, height: 1200), images: [:])
pump(0.1)
scene.talk(id: nil, inset: 0)
pump(0.6)
let grownFit = scene.state()["minimumZoom"] as! CGFloat
assert(abs(camera().zoom - grownFit) < 0.0001 && grownFit < fittedCamera.zoom, "the grown board is fitted again, not cropped")
let refitted = camera()
scene.command("home")
assert(same(camera(), refitted), "exactly as Home fits it")
// A click as the camera starts back (from a speaker on the bottom floor, the view reaching below the board's usual limits):
// the box's room stays, so nothing jumps, and the camera goes on within them.
scene.talk(id: "a4", inset: 240)
pump(0.6)
func usualBottom() -> CGFloat { 1200 + 8 + 74 / grownFit }
assert(camera().center.y + 150 / camera().zoom > usualBottom() + 1, "the view reaches below the board's usual limits")
scene.talk(id: nil, inset: 0)
scene.pointer(phase: "down", at: CGPoint(x: 20, y: 20))
scene.pointer(phase: "up", at: CGPoint(x: 20, y: 20))
let held = camera()
scene.wheel(at: CGPoint(x: 200, y: 150), dy: 0)
assert(same(camera(), held), "a click on the way back doesn't make it jump")
pump(0.6)
assert(abs((scene.state()["minimumZoom"] as! CGFloat) - grownFit) < 0.0001, "the box's room has gone")
assert(camera().center.y + 150 / camera().zoom <= usualBottom() + 0.5, "the camera went on within the usual limits")
let settled = camera()
scene.wheel(at: CGPoint(x: 200, y: 150), dy: 0)
assert(same(camera(), settled), "and stays there")

// The shipped HUD has only a current-state footer: a narrow view uses the compact version at readable size.
scene.setAgents(["rev": 40, "robots": [] as [[String: Any]], "hud": [
    "counts": ["key": "now:full", "w": 600.0, "h": 52.0],
    "countsCompact": ["key": "now:compact", "w": 260.0, "h": 108.0],
]], images: ["now:full": image(60, 5), "now:compact": image(26, 11)])
let nowHud = scene.state()["hud"] as! [String: Bool]
assert(nowHud["title"] == false && nowHud["panel"] == false && nowHud["counts"] == true, "only the current-state footer")
func hudSprites(_ n: SKNode) -> [SKSpriteNode] {
    n.children.flatMap { child -> [SKSpriteNode] in
        if let s = child as? SKSpriteNode, child.parent?.zPosition == 100 { return [s] }
        return hudSprites(child)
    }
}
assert(hudSprites(scene).first?.size == CGSize(width: 260, height: 108), "the compact footer fits without shrinking its type")
scene.command("home")
assert(onScreen(CGRect(x: -200, y: 0, width: 400, height: 1200)).maxY <= 300 - 108 - 24 + 0.5, "the board fits clear of the footer")

// Scenery fills wide and tall viewports without adding fake rooms or changing the camera's board bounds.
let scenery = DungeonScene(size: CGSize(width: 1200, height: 300))
scenery.setArt(frames: ["wall-brick": image(), "terrace-floor": image()], tiles: [:],
               constants: ["sizes": ["wall-brick": [32.0, 32.0], "terrace-floor": [72.0, 60.0]]], reduced: true)
scenery.setScene([
    "bounds": ["x": -200.0, "y": 0.0, "w": 400.0, "h": 600.0],
    "backdrop": [
        ["f": "wall-brick", "x": -178.0, "y": 5.0, "w": 351.0, "h": 595.0, "z": -55.0, "tile": "xy", "ox": 7.0],
        ["f": "terrace-floor", "x": -180.0, "y": 550.0, "w": 360.0, "h": 50.0, "z": -40.0, "tile": "xy", "extendBottom": true],
    ],
], images: [:])
for size in [CGSize(width: 1200, height: 300), CGSize(width: 300, height: 1200)] {
    scenery.size = size
    scenery.viewportChanged()
    let s = scenery.state(), z = s["zoom"] as! CGFloat, c = s["center"] as! [String: CGFloat]
    let visible = CGRect(x: c["x"]! - size.width / 2 / z, y: -c["y"]! - size.height / 2 / z, width: size.width / z, height: size.height / z)
    let background = scenery.children.flatMap(\.children).first { $0.zPosition == -100 }!
    assert(background.children.contains { $0.zPosition < -55 }, "the base masonry stays behind the floor scenery")
    assert(background.calculateAccumulatedFrame().contains(visible), "painted scenery covers every viewport edge")
    let masonry = background.children.first { $0.zPosition == -55 }!.calculateAccumulatedFrame()
    assert(masonry.minX <= visible.minX && masonry.maxX >= visible.maxX, "wall tiles extend both ways, including negative tile offsets")
    let floor = background.children.first { $0.zPosition == -40 }!.calculateAccumulatedFrame()
    assert(floor.minX <= visible.minX && floor.maxX >= visible.maxX && floor.minY <= visible.minY, "the final floor reaches the sides and bottom")
    assert(s["robots"] as! Int == 0 && abs(z - (s["minimumZoom"] as! CGFloat)) < 0.0001, "scenery adds no agents and leaves the whole board fitted")
}

print("DungeonScene: ok")
