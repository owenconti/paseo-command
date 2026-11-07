import AppKit
import CoreImage
import SpriteKit

/// The Village map's glow, shared by the Dungeon Board and the Overworld: the hovered or selected thing lights up along
/// its own silhouette (a soft halo behind it and a faint brightening over it), never a box or rim round it. Hover is the
/// Village's warm white; selection its gold, with a second, wider pass, breathing.
enum SpriteGlow {
    /// The Village's hover and selection colours (`VillageScene.drawHover`, `drawSelection`).
    static let hoverColor = Textures.color(0xfff4dc)
    static let selectColor = Textures.color(0xffc72e)
    /// The halo's least spread, in world units: the Village's halos are 5% of a hall's size; small pieces (a robot, an
    /// alcove's side, a tile of rampart) get at least this much, so their glow reads as the Village's does.
    static let minSpread: CGFloat = 7

    private static let context = CIContext(options: nil)
    private typealias Halo = (texture: SKTexture, padX: CGFloat, padY: CGFloat)
    /// Halos by image (frames, silhouettes and tiles' textures are reused while their scene lasts), oldest dropped first.
    private static var cache: [ObjectIdentifier: Halo] = [:]
    private static var outsides: [ObjectIdentifier: SKTexture] = [:]
    private static var order: [ObjectIdentifier] = []

    /// The image's silhouette in white, spread a little and blurred, with room round it. `minRadius` in image pixels.
    private static func halo(_ image: CGImage, key: ObjectIdentifier, minRadius: CGFloat) -> Halo? {
        if let h = cache[key] { return h }
        let source = CIImage(cgImage: image)
        let white = solid(source)
        let radius = max(3, minRadius, CGFloat(max(image.width, image.height)) * 0.05)
        let pad = radius * 2.5
        let box = source.extent.insetBy(dx: -pad, dy: -pad)
        // Spread a little before blurring, so the halo reads beyond the outline.
        let spread = white.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": radius * 0.7])
        let base = CIImage(color: .clear).cropped(to: box)
        let out = spread.composited(over: base).applyingFilter("CIGaussianBlur", parameters: ["inputRadius": radius]).cropped(to: box)
        guard let cg = context.createCGImage(out, from: box) else { return nil }
        let t = SKTexture(cgImage: cg)
        t.filteringMode = .linear
        let h: Halo = (t, pad / CGFloat(image.width), pad / CGFloat(image.height))
        cache[key] = h
        order.append(key)
        if order.count > 600 {
            for old in order.prefix(200) { cache[old] = nil; outsides[old] = nil }
            order.removeFirst(200)
        }
        return h
    }

    /// The silhouette in white: faint alpha (soft padding) drops to nothing, so only the object glows.
    private static func solid(_ image: CIImage) -> CIImage {
        image.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 3),
            "inputBiasVector": CIVector(x: 1, y: 1, z: 1, w: -0.6),
        ]).applyingFilter("CIColorClamp")
    }

    /// The halo outside the silhouette only: for a silhouette already painted into the map beneath, which it mustn't wash.
    private static func outside(_ image: CGImage, key: ObjectIdentifier, halo h: Halo) -> SKTexture? {
        if let t = outsides[key] { return t }
        guard let haloImage = h.texture.cgImage() as CGImage? else { return nil }
        let pad = h.padX * CGFloat(image.width)
        let moved = solid(CIImage(cgImage: image)).transformed(by: CGAffineTransform(translationX: pad, y: pad))
        let ring = CIImage(cgImage: haloImage).applyingFilter("CISourceOutCompositing", parameters: [kCIInputBackgroundImageKey: moved])
        let box = CGRect(x: 0, y: 0, width: haloImage.width, height: haloImage.height)
        guard let cg = context.createCGImage(ring.cropped(to: box), from: box) else { return nil }
        let t = SKTexture(cgImage: cg)
        t.filteringMode = .linear
        outsides[key] = t
        return t
    }

    /// The Village's glow nodes: the halo, the lift over the object (0.14 of the halo) and, for a selection, the halo
    /// again 8% wider. `size` and `mid` in the parent's space.
    private static func make(_ h: Halo, ring texture: SKTexture? = nil, size: CGSize, mid: CGPoint, color: NSColor, name: String, wide: Bool) -> [SKNode] {
        func piece(_ t: SKTexture, alpha: CGFloat, z: CGFloat, grow: CGFloat = 1) -> SKSpriteNode {
            let n = SKSpriteNode(texture: t, size: CGSize(width: size.width * (1 + 2 * h.padX) * grow, height: size.height * (1 + 2 * h.padY) * grow))
            n.name = name
            n.position = mid
            n.color = color
            n.colorBlendFactor = 1
            n.blendMode = .add
            n.alpha = alpha
            n.zPosition = z
            return n
        }
        let ring = piece(texture ?? h.texture, alpha: 1, z: -0.02)
        let lift = piece(h.texture, alpha: 0.14, z: 0.02)
        return wide ? [ring, lift, piece(texture ?? h.texture, alpha: 1, z: -0.02, grow: 1.08)] : [ring, lift]
    }

    /// Glow `sprite` (as its children, so they move and sort with it), from its texture's image.
    @discardableResult
    static func glow(_ sprite: SKSpriteNode, color: NSColor, name: String, wide: Bool = false) -> [SKNode] {
        guard let texture = sprite.texture, sprite.size.width > 0 else { return [] }
        // Children sit in the sprite's own space (its size is before any scale), centred by its anchor.
        let size = sprite.size
        let mid = CGPoint(x: size.width * (0.5 - sprite.anchorPoint.x), y: size.height * (0.5 - sprite.anchorPoint.y))
        let key = ObjectIdentifier(texture)
        let h: Halo?
        if let cached = cache[key] { h = cached } else {
            let image = texture.cgImage()
            h = halo(image, key: key, minRadius: minSpread * CGFloat(image.width) / size.width)
        }
        guard let h else { return [] }
        let made = make(h, size: size, mid: mid, color: color, name: name, wide: wide)
        for n in made { sprite.addChild(n) }
        return made
    }

    /// For a silhouette painted beneath (the Overworld's halls, booths and robots): the halo outside it, the faint lift
    /// over it and, for a selection, the wider pass. `size` and `mid` in the parent's space.
    static func overlay(for image: CGImage, size: CGSize, mid: CGPoint, color: NSColor, name: String, wide: Bool = false) -> [SKNode] {
        let key = ObjectIdentifier(image)
        guard size.width > 0, let h = halo(image, key: key, minRadius: minSpread * CGFloat(image.width) / size.width),
              let out = outside(image, key: key, halo: h) else { return [] }
        return make(h, ring: out, size: size, mid: mid, color: color, name: name, wide: wide)
    }

    /// A selection's glow breathing, as the Village's: its halos between 70% and full, its lifts at 0.14 of that.
    static func breathe(_ nodes: [SKNode], clock: Double, reduced: Bool) {
        let t = reduced ? 0.5 : 0.5 + 0.5 * sin(clock / 1600 * .pi * 2)
        for (i, g) in nodes.enumerated() { g.alpha = (i % 3 == 1 ? 0.14 : 1) * CGFloat(0.7 + 0.3 * t) }
    }

    /// Every sprite in `node` (itself, or a tiled container's pieces).
    static func sprites(in node: SKNode) -> [SKSpriteNode] {
        if let s = node as? SKSpriteNode { return [s] }
        return node.children.compactMap { $0 as? SKSpriteNode }
    }
}
