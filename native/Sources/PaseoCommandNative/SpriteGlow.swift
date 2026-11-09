import AppKit
import CoreImage
import SpriteKit

/// The maps' glow, shared by the Dungeon Board and the Overworld: the hovered or selected thing lights up along
/// its own silhouette (a tight halo just outside it and a faint brightening over it), never a box or rim round it.
/// Hover is a warm white; selection gold, with a second, wider pass, breathing. The halo's profile is
/// spread by 0.7 of its radius, blurred by its radius, the radius 5% of the silhouette's size.
enum SpriteGlow {
    /// The hover and selection colours.
    static let hoverColor = Textures.color(0xfff4dc)
    static let selectColor = Textures.color(0xffc72e)
    /// Structures' halo radius (world units, which are the concept's pixels on every map): the removed Village's
    /// halls' own (5% of a hall's frame), so a terrace, alcove, booth or hall glows in a band of one width.
    static let structureSpread: CGFloat = 17

    private static let context = CIContext(options: nil)
    private typealias Halo = (texture: SKTexture, outside: SKTexture, padX: CGFloat, padY: CGFloat)
    /// Halos by image or texture, each holding its owner so the owner's address can't be reused for another image
    /// while its halo is cached (which once gave a small thing a big tile's halo).
    private static var cache: [ObjectIdentifier: (owner: AnyObject, halo: Halo)] = [:]
    private static var order: [ObjectIdentifier] = []
    /// Forgets every cached halo (the map changed world: the old one's sprites are gone).
    static func clear() {
        cache = [:]
        order = []
    }

    /// `image`'s halo, `radius` in its pixels (by default 5% of its size): the full halo (for the lift)
    /// and the part outside the silhouette (for the ring, so what's beneath, painted or not, isn't washed).
    private static func halo(_ image: CGImage, owner: AnyObject, radius given: CGFloat? = nil) -> Halo? {
        let key = ObjectIdentifier(owner)
        if let h = cache[key], h.owner === owner { return h.halo }
        let source = CIImage(cgImage: image)
        let white = solid(source)
        let radius = max(1.5, given ?? CGFloat(max(image.width, image.height)) * 0.05)
        let pad = (radius * 2.5).rounded(.up)
        let box = source.extent.insetBy(dx: -pad, dy: -pad)
        let spread = white.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": radius * 0.7])
        let base = CIImage(color: .clear).cropped(to: box)
        let full = spread.composited(over: base).applyingFilter("CIGaussianBlur", parameters: ["inputRadius": radius]).cropped(to: box)
        // The ring starts just outside the silhouette, closed over hairline seams between composited pieces.
        let closed = white.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": 1.5])
        let ring = full.applyingFilter("CISourceOutCompositing", parameters: [kCIInputBackgroundImageKey: closed]).cropped(to: box)
        guard let fullImage = context.createCGImage(full, from: box), let ringImage = context.createCGImage(ring, from: box) else { return nil }
        let t = SKTexture(cgImage: fullImage), o = SKTexture(cgImage: ringImage)
        t.filteringMode = .linear
        o.filteringMode = .linear
        let h: Halo = (t, o, pad / CGFloat(image.width), pad / CGFloat(image.height))
        cache[key] = (owner, h)
        order.append(key)
        if order.count > 400 {
            for old in order.prefix(150) { cache[old] = nil }
            order.removeFirst(150)
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

    /// The glow nodes: the ring (just outside the silhouette), the lift over it (0.14) and, for a selection,
    /// the ring again 8% wider. `size` and `mid` in the parent's space.
    private static func make(_ h: Halo, size: CGSize, mid: CGPoint, color: NSColor, name: String, wide: Bool) -> [SKNode] {
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
        let ring = piece(h.outside, alpha: 1, z: -0.02)
        let lift = piece(h.texture, alpha: 0.14, z: 0.02)
        return wide ? [ring, lift, piece(h.outside, alpha: 1, z: -0.02, grow: 1.08)] : [ring, lift]
    }

    /// Glow `sprite` (as its children, so they move and sort with it), from its texture's image, at the default spread (5% of its size).
    @discardableResult
    static func glow(_ sprite: SKSpriteNode, color: NSColor, name: String, wide: Bool = false) -> [SKNode] {
        guard let texture = sprite.texture, sprite.size.width > 0 else { return [] }
        let size = sprite.size
        let mid = CGPoint(x: size.width * (0.5 - sprite.anchorPoint.x), y: size.height * (0.5 - sprite.anchorPoint.y))
        let h = cache[ObjectIdentifier(texture)].flatMap { $0.owner === texture ? $0.halo : nil } ?? halo(texture.cgImage(), owner: texture)
        guard let h else { return [] }
        let made = make(h, size: size, mid: mid, color: color, name: name, wide: wide)
        for n in made { sprite.addChild(n) }
        return made
    }

    /// A silhouette image standing at `rect` (world space of the parent, `mid` its centre): its glow, for a silhouette
    /// drawn beneath (the Overworld's halls, booths and robots; the Dungeon's terraces and alcoves, composited).
    /// `spread`, in the parent's units, overrides the default 5% of its size.
    static func overlay(for image: CGImage, size: CGSize, mid: CGPoint, color: NSColor, name: String, wide: Bool = false, spread: CGFloat? = nil) -> [SKNode] {
        guard size.width > 0 else { return [] }
        let radius = spread.map { $0 * CGFloat(image.width) / size.width }
        guard let h = halo(image, owner: image, radius: radius) else { return [] }
        return make(h, size: size, mid: mid, color: color, name: name, wide: wide)
    }

    /// A selection's glow breathing: its rings between 70% and full, its lifts at 0.14 of that.
    static func breathe(_ nodes: [SKNode], clock: Double, reduced: Bool) {
        let t = reduced ? 0.5 : 0.5 + 0.5 * sin(clock / 1600 * .pi * 2)
        for (i, g) in nodes.enumerated() { g.alpha = (i % 3 == 1 ? 0.14 : 1) * CGFloat(0.7 + 0.3 * t) }
    }

    /// Every sprite in `node` (itself, or a tiled container's pieces).
    static func sprites(in node: SKNode) -> [SKSpriteNode] {
        if let s = node as? SKSpriteNode { return [s] }
        return node.children.compactMap { $0 as? SKSpriteNode }
    }

    /// Several sprites as one silhouette: drawn together by `view` into one image, with where it stands in `space`.
    static func composite(_ sprites: [SKSpriteNode], in space: SKNode, view: SKView) -> (image: CGImage, rect: CGRect)? {
        let group = SKNode()
        for s in sprites {
            guard let t = s.texture, let parent = s.parent else { continue }
            let copy = SKSpriteNode(texture: t, size: s.size)
            copy.anchorPoint = s.anchorPoint
            copy.xScale = s.xScale
            copy.yScale = s.yScale
            copy.position = space.convert(s.position, from: parent)
            copy.zPosition = s.zPosition
            group.addChild(copy)
        }
        let frame = group.calculateAccumulatedFrame()
        guard frame.width > 1, frame.height > 1, let texture = view.texture(from: group) else { return nil }
        return (texture.cgImage(), frame)
    }
}
