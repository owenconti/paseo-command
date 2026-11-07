// A robot's state glow is drawn in its state's colour (from numbers as JSON gives them, or literals).
import AppKit
import SpriteKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
AtlasView.ignoreOcclusion = true
func image(_ w: Int, _ h: Int, _ c: CGColor) -> CGImage {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(c); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h)); return ctx.makeImage()!
}
let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.borderless], backing: .buffered, defer: false)
let scene = DungeonScene(size: CGSize(width: 400, height: 300))
let view = AtlasView(frame: window.contentView!.bounds, scene: scene)
window.contentView!.addSubview(view); window.orderFrontRegardless()
scene.setArt(frames: ["robot-0": image(8, 8, CGColor(red: 1, green: 1, blue: 1, alpha: 1)), "wall-brick": image(8, 8, CGColor(gray: 0.3, alpha: 1))], tiles: [:], constants: ["sizes": ["wall-brick": [32.0, 32.0]]], reduced: true)
scene.setScene(["bounds": ["x": -200.0, "y": 0.0, "w": 400.0, "h": 300.0], "sprites": [["f": "wall-brick", "x": -200.0, "y": 0.0, "w": 400.0, "h": 300.0, "z": -50.0, "tile": "xy"]]], images: [:])
scene.setAgents(["robots": [["id": "a", "x": -20.0, "y": 100.0, "w": 40.0, "h": 50.0, "idle": ["robot-0"], "work": ["robot-0"], "busy": false, "glow": ["c": 0x3fbf86, "a": 0.95, "x": 0.0, "y": 148.0, "w": 80.0, "h": 30.0]]]], images: [:])
RunLoop.main.run(until: Date() + 1)
let tex = view.texture(from: scene)!.cgImage()
let rep = NSBitmapImageRep(cgImage: tex)
// Under its feet the state's glow shows in its colour (green for running), not white.
let c = rep.colorAt(x: rep.pixelsWide / 2, y: rep.pixelsHigh / 2 + 3 * rep.pixelsHigh / 300)!
assert(c.greenComponent > c.redComponent + 0.15 && c.greenComponent > c.blueComponent + 0.05, "the state glow is tinted in its state's colour")
print("DungeonGlow: ok")
