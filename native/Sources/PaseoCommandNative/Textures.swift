import AppKit
import ImageIO
import SpriteKit

/// Images from the bridge, and the few shapes SpriteKit draws as textures.
enum Textures {
    /// A `data:image/png;base64,…` URL decoded, off the main thread.
    static func image(dataURL: String) -> CGImage? {
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let source = CGImageSourceCreateWithData(data as CFData, nil)
        else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    /// A texture that keeps detail when zoomed out: the image is padded to a
    /// power-of-two square (mipmaps need one) and the sprite uses the image's
    /// part. `scale` is how many pixels the image has per world pixel.
    static func texture(_ image: CGImage) -> SKTexture {
        let w = image.width, h = image.height
        let side = 1 << Int(ceil(log2(Double(max(w, h, 1)))))
        guard side <= 8192, let ctx = context(side, side) else {
            let t = SKTexture(cgImage: image)
            t.filteringMode = .linear
            return t
        }
        // CG's origin is bottom left: the image sits at the top left of the square.
        ctx.draw(image, in: CGRect(x: 0, y: side - h, width: w, height: h))
        let padded = SKTexture(cgImage: ctx.makeImage()!)
        padded.filteringMode = .linear
        padded.usesMipmaps = true
        let rect = CGRect(x: 0, y: CGFloat(side - h) / CGFloat(side), width: CGFloat(w) / CGFloat(side), height: CGFloat(h) / CGFloat(side))
        let part = SKTexture(rect: rect, in: padded)
        part.filteringMode = .linear
        part.usesMipmaps = true
        return part
    }

    static func context(_ width: Int, _ height: Int) -> CGContext? {
        CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    }

    /// Pixels per world pixel of the generated tile textures.
    static let tileScale: CGFloat = 4

    /// Draw a texture `size` world pixels square, centred on (0, 0), y down.
    static func drawn(size: CGFloat, _ draw: (CGContext) -> Void) -> SKTexture {
        let px = Int(ceil(size * tileScale))
        let ctx = context(px, px)!
        ctx.translateBy(x: CGFloat(px) / 2, y: CGFloat(px) / 2)
        ctx.scaleBy(x: tileScale, y: -tileScale)
        draw(ctx)
        let t = SKTexture(cgImage: ctx.makeImage()!)
        t.filteringMode = .linear
        return t
    }

    static func hexPath(_ r: CGFloat, at c: CGPoint = .zero) -> CGPath {
        let path = CGMutablePath()
        for i in 0..<6 {
            let p = Hex.corner(c, i, r)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }

    static func color(_ rgb: Int, _ alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                blue: CGFloat(rgb & 255) / 255, alpha: alpha)
    }

    /// `dark` under a dark appearance, else `light` (Galaxy and Lake Country's tones).
    static func color(dark: Int, light: Int, in appearance: NSAppearance) -> NSColor {
        color(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light)
    }

    /// An agent's tile: its state's colour over the sand, and a fine light
    /// line inside its border (`agentTiles` in AtlasScene.ts).
    static func tileFill(color rgb: Int, alpha: CGFloat) -> SKTexture {
        let r = Hex.radius
        return drawn(size: r * 2 + 4) { ctx in
            ctx.addPath(hexPath(r - 1))
            ctx.setFillColor(color(rgb, alpha).cgColor)
            ctx.fillPath()
            ctx.addPath(hexPath(r - 10.5))
            ctx.setStrokeColor(color(0xfff8e6, 0.7).cgColor)
            ctx.setLineWidth(1.5)
            ctx.strokePath()
        }
    }

    /// A tile's border, white, to be tinted with its state's colour.
    static let ring: SKTexture = drawn(size: Hex.radius * 2 + 4) { ctx in
        ctx.addPath(hexPath(Hex.radius - 5.5))
        ctx.setStrokeColor(NSColor.white.cgColor)
        ctx.setLineWidth(9)
        ctx.setLineJoin(.miter)
        ctx.strokePath()
    }

    /// A lit lamp's or beacon's glow: six soft discs, white, tinted per light.
    static func glow(reach: CGFloat) -> SKTexture {
        drawn(size: reach * 2 + 2) { ctx in
            for k in stride(from: 6, through: 1, by: -1) {
                let r = reach * CGFloat(k) / 6
                ctx.setFillColor(NSColor(white: 1, alpha: 0.07).cgColor)
                ctx.fillEllipse(in: CGRect(x: -r, y: -r, width: r * 2, height: r * 2))
            }
        }
    }

    /// One white pixel: running lights' segments and other flat shapes.
    static let white: SKTexture = {
        let ctx = context(4, 4)!
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        let t = SKTexture(cgImage: ctx.makeImage()!)
        t.filteringMode = .linear
        return SKTexture(rect: CGRect(x: 0.375, y: 0.375, width: 0.25, height: 0.25), in: t)
    }()

    /// A drone's shadow on the ground.
    static let shadow: SKTexture = drawn(size: 18) { ctx in
        ctx.setFillColor(color(0x1d2a14, 0.28).cgColor)
        ctx.fillEllipse(in: CGRect(x: -8, y: -3, width: 16, height: 6))
    }
}
