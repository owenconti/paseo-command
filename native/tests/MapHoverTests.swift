// Where each map's hover report says its card goes: the hovered thing's (or its PR medallion's) top centre,
// `x`, `y`, and its bottom edge, `bottom`, in the surface's points, which the page uses to put a card that has
// no room above it beneath the thing instead. The Atlas (Islands; the Overworld shares its formula) and the
// Village here; the Dungeon Board's are in DungeonSceneTests. Drawn in a transparent window that takes no clicks.
import AppKit
import SpriteKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
AtlasView.ignoreOcclusion = true

func image(_ w: Int = 4, _ h: Int = 4) -> CGImage {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.6, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}
let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.borderless], backing: .buffered, defer: false)
window.alphaValue = 0
window.ignoresMouseEvents = true
let atlas = AtlasScene(size: CGSize(width: 400, height: 300))
var view = AtlasView(frame: window.contentView!.bounds, scene: atlas)
window.contentView!.addSubview(view)
window.orderFrontRegardless()
var events: [[String: Any]] = []

/// The surface point over a world point, at the scene's camera now (the view is 400 × 300).
func screen(_ scene: MapScene, _ x: CGFloat, _ y: CGFloat) -> CGPoint {
    let s = scene.state(), z = s["zoom"] as! CGFloat, c = s["center"] as! [String: CGFloat]
    return CGPoint(x: (x - c["x"]!) * z + 200, y: (y - c["y"]!) * z + 150)
}
/// The last hover report after the pointer moves to a world point.
func hover(_ scene: MapScene, _ x: CGFloat, _ y: CGFloat) -> [String: Any] {
    events = []
    scene.pointer(phase: "move", at: screen(scene, x, y))
    return events.last { $0["type"] as? String == "hover" }!
}
func near(_ value: Any?, _ expected: CGFloat) -> Bool { abs((value as! CGFloat) - expected) < 0.5 }

// The Atlas: an entity's card points at its `at` box (centred on its x, y), a PR medallion's at its frame's box.
atlas.emit = { events.append($0) }
atlas.setArt(frames: ["dot": image()], tiles: ["water": image(), "glints": image(), "clouds": image()], constants: [:], reduced: false)
view.govern()
atlas.setScene([
    "rev": 1,
    "bounds": ["x": -300.0, "y": -300.0, "width": 600.0, "height": 600.0],
    // A 20-wide square medallion centred at (200, 50): its box runs from y 40 to 60.
    "prFlags": [["frame": "dot", "width": 20.0, "x": 200.0, "y": 50.0, "depth": 5.0, "flag": "ci-green", "workspace": "w1"]],
    // The workspace's cell at the origin; its box 120 × 100 centred at (0, 10), so from y −40 to 60.
    "entities": [["id": "w1", "kind": "workspace", "cells": [[0, 0]], "at": ["x": 0.0, "y": 10.0, "width": 120.0, "height": 100.0]]],
], images: [:])
do {
    let h = hover(atlas, 0, 0)
    assert(h["id"] as? String == "w1" && h["flag"] == nil, "the workspace's cell is hovered")
    assert(near(h["x"], screen(atlas, 0, 0).x) && near(h["y"], screen(atlas, 0, -40).y), "its card points at its box's top centre")
    assert(near(h["bottom"], screen(atlas, 0, 60).y), "and says where its box's bottom is")
    let f = hover(atlas, 200, 50)
    assert(f["id"] as? String == "w1" && f["flag"] as? String == "ci-green", "the medallion is hovered")
    assert(near(f["x"], screen(atlas, 200, 0).x) && near(f["y"], screen(atlas, 0, 40).y), "its card points at the medallion's top")
    assert(near(f["bottom"], screen(atlas, 0, 60).y), "and says where the medallion's bottom is")
    // Closer in, the same world edges at the new zoom.
    let fitZoom = atlas.state()["zoom"] as! CGFloat
    atlas.wheel(at: CGPoint(x: 200, y: 150), dy: -600)
    assert((atlas.state()["zoom"] as! CGFloat) > fitZoom * 1.2, "the wheel zooms in")
    atlas.pointer(phase: "leave", at: .zero)
    let zoomed = hover(atlas, 0, 0)
    assert(near(zoomed["y"], screen(atlas, 0, -40).y) && near(zoomed["bottom"], screen(atlas, 0, 60).y), "both follow the zoom")
    atlas.pointer(phase: "leave", at: .zero)
}

// The Village: an entity's card points at its rect, a medallion's at its disc (`s` / 2 + 2 round its centre).
let village = makeMapScene(kind: "village", size: CGSize(width: 400, height: 300))
view.retire()
let next = view.successor(scene: village)
window.contentView!.replaceSubview(view, with: next)
view = next
village.emit = { events.append($0) }
let names = ["grass", "dot", "pr-ci-green"]
village.setArt(frames: Dictionary(uniqueKeysWithValues: names.map { ($0, image(8, 8)) }), tiles: [:],
               constants: ["sizes": Dictionary(uniqueKeysWithValues: names.map { ($0, [32.0, 32.0]) }), "maxZoom": 3.0], reduced: false)
view.govern()
village.setScene([
    "rev": 1,
    "bounds": ["x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0],
    "sprites": [["f": "grass", "x": -500.0, "y": 0.0, "w": 1000.0, "h": 800.0, "z": -60.0, "tile": "xy"]],
    "images": [] as [[String: Any]],
    "flags": [["ws": "w1", "flag": "ci-green", "f": "pr-ci-green", "x": 100.0, "y": 300.0, "w": 18.0, "h": 18.0, "z": 5.0, "cx": 109.0, "cy": 309.0, "s": 18.0]],
    "lights": [] as [[String: Any]],
    "entities": [
        ["id": "w1", "kind": "workspace", "x": 80.0, "y": 280.0, "w": 260.0, "h": 110.0],
        ["id": "a1", "kind": "agent", "x": 180.0, "y": 330.0, "w": 40.0, "h": 46.0],
    ],
], images: [:])
do {
    let a = hover(village, 200, 350)
    assert(a["id"] as? String == "a1" && a["flag"] == nil, "the robot is hovered")
    assert(near(a["x"], screen(village, 200, 0).x) && near(a["y"], screen(village, 0, 330).y), "its card points at the robot's top")
    assert(near(a["bottom"], screen(village, 0, 376).y), "and says where the robot's bottom is (330 + 46)")
    let f = hover(village, 109, 309)
    assert(f["id"] as? String == "w1" && f["flag"] as? String == "ci-green", "the medallion is hovered")
    assert(near(f["y"], screen(village, 0, 298).y), "its card points at the medallion's top (309 − 11)")
    assert(near(f["bottom"], screen(village, 0, 320).y), "and says where the medallion's bottom is (309 + 11)")
    village.pointer(phase: "leave", at: .zero)
    let w = hover(village, 300, 290)
    assert(w["id"] as? String == "w1" && near(w["y"], screen(village, 0, 280).y) && near(w["bottom"], screen(village, 0, 390).y),
           "a bay's card spans its rect (280 to 390)")
}

print("MapHover: ok")
