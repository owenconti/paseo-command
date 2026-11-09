// Where each map's hover report says its card goes: the hovered thing's (or its PR medallion's) top centre,
// `x`, `y`, and its bottom edge, `bottom`, in the surface's points, which the page uses to put a card that has
// no room above it beneath the thing instead. The Atlas (Islands; the Overworld shares its formula) here;
// the Dungeon Board's are in DungeonSceneTests. Drawn in a transparent window that takes no clicks.
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
let view = AtlasView(frame: window.contentView!.bounds, scene: atlas)
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

print("MapHover: ok")
