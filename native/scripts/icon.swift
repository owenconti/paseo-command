// Draws the app icon from the Atlas's own art: Claude's orange robot (the
// teal robot re-enamelled as `art.ts` does) on a running agent's sand tile,
// over the sea. Writes native/AppIcon.icns.
//
//   swift native/scripts/icon.swift   (from the repository root)
import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let robots = NSImage(contentsOf: root.appendingPathComponent("rendering/src/assets/robots.png"))!
var robotsRect = CGRect(origin: .zero, size: robots.size)
let sheet = robots.cgImage(forProposedRect: &robotsRect, context: nil, hints: nil)!

/// The teal robot, top-left quarter of the sheet, recoloured to Claude's orange.
func orangeRobot() -> CGImage {
    let w = sheet.width / 2, h = sheet.height / 2
    let teal = sheet.cropping(to: CGRect(x: 0, y: 0, width: w, height: h))!
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(teal, in: CGRect(x: 0, y: 0, width: w, height: h))
    let p = ctx.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)
    for i in stride(from: 0, to: w * h * 4, by: 4) {
        let a = Double(p[i + 3]) / 255
        if a == 0 { continue }
        let r = Double(p[i]) / 255 / a, g = Double(p[i + 1]) / 255 / a, b = Double(p[i + 2]) / 255 / a
        let mx = max(r, g, b), mn = min(r, g, b), l = (mx + mn) / 2, d = mx - mn
        if d < 0.06 { continue }
        let s = d / (1 - abs(2 * l - 1))
        var hue = mx == r ? ((g - b) / d).truncatingRemainder(dividingBy: 6) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4
        hue = (hue * 60 + 360).truncatingRemainder(dividingBy: 360)
        if hue < 150 || hue > 220 || s < 0.15 { continue }
        // ROBOT_PAINT orange: hue 18, saturation ×0.62, lightness + 0.12.
        let nl = min(1, l + 0.12), ns = min(1, s * 0.62)
        let c = (1 - abs(2 * nl - 1)) * ns, x = c * (1 - abs((18.0 / 60).truncatingRemainder(dividingBy: 2) - 1)), m = nl - c / 2
        p[i] = UInt8(min(255, (c + m) * 255 * a)); p[i + 1] = UInt8(min(255, (x + m) * 255 * a)); p[i + 2] = UInt8(min(255, m * 255 * a))
    }
    // Trimmed to its silhouette.
    var minX = w, minY = h, maxX = 0, maxY = 0
    for y in 0..<h { for x in 0..<w where p[(y * w + x) * 4 + 3] > 90 {
        minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
    } }
    return ctx.makeImage()!.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1))!
}
let robot = orangeRobot()

func color(_ hex: Int, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func hex(_ c: CGPoint, _ r: CGFloat) -> CGPath {
    let path = CGMutablePath()
    for i in 0..<6 {
        let a = Double(i) * .pi / 3 + .pi / 2
        let p = CGPoint(x: c.x + CGFloat(cos(a)) * r, y: c.y + CGFloat(sin(a)) * r)
        i == 0 ? path.move(to: p) : path.addLine(to: p)
    }
    path.closeSubpath()
    return path
}

func draw(_ size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    // The sea, in macOS's icon grid (824 pt square, 185 pt corners).
    let square = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 185, cornerHeight: 185, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: color(0x000000, 0.35))
    ctx.addPath(square); ctx.setFillColor(color(0x1d6884)); ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(square); ctx.clip()
    let sea = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [color(0x2e8aa6), color(0x15506a)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(sea, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
    let centre = CGPoint(x: 512, y: 500)
    // Shallows and foam round the tile, then its earthen bank.
    ctx.addPath(hex(centre, 380)); ctx.setFillColor(color(0x76cec4, 0.35)); ctx.fillPath()
    ctx.addPath(hex(centre, 342)); ctx.setFillColor(color(0xe4f4ee, 0.8)); ctx.fillPath()
    ctx.addPath(hex(CGPoint(x: centre.x, y: centre.y - 14), 326)); ctx.setFillColor(color(0x4a381e)); ctx.fillPath()
    // A running agent's sand tile: green wash and border, with its light.
    ctx.addPath(hex(centre, 326)); ctx.setFillColor(color(0xede0bd)); ctx.fillPath()
    ctx.addPath(hex(centre, 320)); ctx.setFillColor(color(0x3fbf86, 0.42)); ctx.fillPath()
    ctx.addPath(hex(centre, 300)); ctx.setStrokeColor(color(0x3fbf86, 0.95)); ctx.setLineWidth(36); ctx.strokePath()
    ctx.addPath(hex(centre, 262)); ctx.setStrokeColor(color(0xfff8e6, 0.7)); ctx.setLineWidth(6); ctx.strokePath()
    ctx.restoreGState()
    // The robot, with a soft shadow on the sand.
    let rw: CGFloat = 430, rh = rw * CGFloat(robot.height) / CGFloat(robot.width)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 22, color: color(0x1d2a14, 0.45))
    ctx.draw(robot, in: CGRect(x: centre.x - rw / 2, y: centre.y - rh / 2, width: rw, height: rh))
    ctx.restoreGState()
    return ctx.makeImage()!
}

let iconset = root.appendingPathComponent("native/build/AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        let rep = NSBitmapImageRep(cgImage: draw(base * scale))
        try rep.representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent(name))
    }
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", root.appendingPathComponent("native/AppIcon.icns").path]
try task.run(); task.waitUntilExit()
print("native/AppIcon.icns")
