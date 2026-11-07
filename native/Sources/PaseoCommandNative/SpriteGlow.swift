import AppKit
import CoreImage
import SpriteKit

/// The hover glow the Village map uses, shared by the Dungeon Board and the Overworld: a soft halo following a sprite's
/// own silhouette (behind it) and a faint brightening of the sprite itself, never a box or rim round it.
enum SpriteGlow {
    private static let context = CIContext(options: nil)
    /// Each image's halo: its silhouette in white, spread a little and blurred, with room round it (`pad`, a share of
    /// the image's size). Kept per image (frames and silhouettes are reused); partial tiles come and go with scenes.
    private static var cache: [ObjectIdentifier: (texture: SKTexture, padX: CGFloat, padY: CGFloat)] = [:]
    private static var order: [ObjectIdentifier] = []
    private static var outsides: [ObjectIdentifier: SKTexture] = [:]

    /// The halo outside the silhouette only (for a silhouette already painted into the map beneath, which it mustn't wash).
    static func outsideHalo(_ image: CGImage, key: ObjectIdentifier) -> (texture: SKTexture, padX: CGFloat, padY: CGFloat)? {
        guard let h = halo(image, key: key) else { return nil }
        if let t = outsides[key] { return (t, h.padX, h.padY) }
        let pad = h.padX * CGFloat(image.width)
        let source = CIImage(cgImage: image).transformed(by: CGAffineTransform(translationX: pad, y: h.padY * CGFloat(image.height)))
        let solid = source.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 3),
            "inputBiasVector": CIVector(x: 1, y: 1, z: 1, w: -0.6),
        ]).applyingFilter("CIColorClamp")
        guard let haloImage = h.texture.cgImage() as CGImage? else { return nil }
        let ring = CIImage(cgImage: haloImage).applyingFilter("CISourceOutCompositing", parameters: [kCIInputBackgroundImageKey: solid])
        let box = CGRect(x: 0, y: 0, width: haloImage.width, height: haloImage.height)
        guard let cg = context.createCGImage(ring.cropped(to: box), from: box) else { return nil }
        let t = SKTexture(cgImage: cg)
        t.filteringMode = .linear
        outsides[key] = t
        return (t, h.padX, h.padY)
    }

    /// For a silhouette painted beneath (the Overworld's halls and booths): the halo outside it and a faint lift over it,
    /// `size` and `mid` in the parent's space.
    static func overlay(for image: CGImage, size: CGSize, mid: CGPoint, color: NSColor, strength: CGFloat = 1, name: String) -> [SKNode] {
        let key = ObjectIdentifier(image)
        guard let h = halo(image, key: key), let out = outsideHalo(image, key: key) else { return [] }
        let made = make(h, size: size, mid: mid, color: color, strength: strength, name: name)
        (made[0] as? SKSpriteNode)?.texture = out.texture
        return made
    }

    static func halo(_ image: CGImage, key: ObjectIdentifier? = nil) -> (texture: SKTexture, padX: CGFloat, padY: CGFloat)? {
        let id = key ?? ObjectIdentifier(image)
        if let h = cache[id] { return h }
        let source = CIImage(cgImage: image)
        let white = source.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 3),
            // Faint alpha (soft padding) drops to nothing, so only the silhouette glows.
            "inputBiasVector": CIVector(x: 1, y: 1, z: 1, w: -0.6),
        ]).applyingFilter("CIColorClamp")
        let radius = max(3, CGFloat(max(image.width, image.height)) * 0.05)
        let pad = radius * 2.5
        let box = source.extent.insetBy(dx: -pad, dy: -pad)
        // Spread a little before blurring, so the halo reads beyond the outline.
        let spread = white.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": radius * 0.7])
        let base = CIImage(color: .clear).cropped(to: box)
        let out = spread.composited(over: base).applyingFilter("CIGaussianBlur", parameters: ["inputRadius": radius]).cropped(to: box)
        guard let cg = context.createCGImage(out, from: box) else { return nil }
        let t = SKTexture(cgImage: cg)
        t.filteringMode = .linear
        let h = (t, pad / CGFloat(image.width), pad / CGFloat(image.height))
        cache[id] = h
        order.append(id)
        // A bounded cache: the oldest go first (tiles are many, frames few).
        if order.count > 600 { for old in order.prefix(200) { cache[old] = nil }; order.removeFirst(200) }
        return h
    }

    /// The halo and the lift for an image of `size` centred at `mid` (in its parent's space), tinted `color`.
    static func nodes(for image: CGImage, key: ObjectIdentifier? = nil, size: CGSize, mid: CGPoint, color: NSColor, strength: CGFloat, name: String) -> [SKNode] {
        guard let h = halo(image, key: key) else { return [] }
        return make(h, size: size, mid: mid, color: color, strength: strength, name: name)
    }

    private static func make(_ h: (texture: SKTexture, padX: CGFloat, padY: CGFloat), size: CGSize, mid: CGPoint, color: NSColor, strength: CGFloat, name: String) -> [SKNode] {
        let ring = SKSpriteNode(texture: h.texture, size: CGSize(width: size.width * (1 + 2 * h.padX), height: size.height * (1 + 2 * h.padY)))
        ring.name = name
        ring.position = mid
        ring.color = color
        ring.colorBlendFactor = 1
        ring.blendMode = .add
        ring.alpha = strength
        ring.zPosition = -0.02
        let lift = SKSpriteNode(texture: h.texture, size: ring.size)
        lift.name = name
        lift.position = mid
        lift.color = color
        lift.colorBlendFactor = 1
        lift.blendMode = .add
        lift.alpha = 0.14 * strength
        lift.zPosition = 0.02
        return [ring, lift]
    }

    /// Glow `sprite` (as its children, so they move and sort with it): from its texture's image.
    @discardableResult
    static func glow(_ sprite: SKSpriteNode, color: NSColor, strength: CGFloat = 1, name: String) -> [SKNode] {
        guard let texture = sprite.texture else { return [] }
        // Children sit in the sprite's own space (its size is before any scale), centred by its anchor.
        let size = sprite.size
        let mid = CGPoint(x: size.width * (0.5 - sprite.anchorPoint.x), y: size.height * (0.5 - sprite.anchorPoint.y))
        let key = ObjectIdentifier(texture)
        let image = halo(fromCacheOnly: key) ? nil : texture.cgImage()
        let made = image.map { nodes(for: $0, key: key, size: size, mid: mid, color: color, strength: strength, name: name) }
            ?? nodes(cached: key, size: size, mid: mid, color: color, strength: strength, name: name)
        for n in made { sprite.addChild(n) }
        return made
    }

    private static func halo(fromCacheOnly key: ObjectIdentifier) -> Bool { cache[key] != nil }
    private static func nodes(cached key: ObjectIdentifier, size: CGSize, mid: CGPoint, color: NSColor, strength: CGFloat, name: String) -> [SKNode] {
        guard let h = cache[key] else { return [] }
        return make(h, size: size, mid: mid, color: color, strength: strength, name: name)
    }

    /// Every sprite in `node` (itself, or a tiled container's pieces).
    static func sprites(in node: SKNode) -> [SKSpriteNode] {
        if let s = node as? SKSpriteNode { return [s] }
        return node.children.compactMap { $0 as? SKSpriteNode }
    }

    /// The warm white of a hover, as the Village's.
    static let hoverColor = NSColor(srgbRed: 1, green: 0.957, blue: 0.863, alpha: 1)
}
