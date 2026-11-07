import AppKit
import SpriteKit

/// The Dungeon Board, drawn natively. The page (`rendering/src/dungeon/bridge.ts`) lays the board
/// out and paints its text; this scene places the sprites it names, animates torches, candles, the
/// portcullis, the gold links' running light, robots and drones, owns the camera (with the HUD in
/// screen space), and reports picks, hover and zoom. Positions are board units, y down; every
/// sprite comes as a top-left box. It never sends daemon actions; the React app owns those.
final class DungeonScene: SKScene, MapScene {
    let kind = "dungeon"
    var emit: ([String: Any]) -> Void = { _ in }
    var wake: () -> Void = {}

    // MARK: Art

    private var frames: [String: SKTexture] = [:]
    private var frameImages: [String: CGImage] = [:]
    /// Each frame's size in board units.
    private var frameSizes: [String: CGSize] = [:]
    /// Painted labels, plaques and the HUD, by content key.
    private var images: [String: SKTexture] = [:]
    /// Tiles repeated into larger textures (fewer nodes), by frame and count.
    private var bigTiles: [String: SKTexture] = [:]
    var hasArt: Bool { !frames.isEmpty }
    private(set) var builds = 0
    private(set) var sceneRevision = 0
    private(set) var agentsRevision = 0
    private(set) var appliedAt: CFTimeInterval = 0
    private var bounds: WorldBox?

    // MARK: Nodes

    private let cam = SKCameraNode()
    private let world = SKNode()
    private let backdrop = SKNode()
    private let board = SKNode()
    private let agentLayer = SKNode()
    private let hoverNode = SKNode()
    private let selectionNode = SKNode()
    private let selectionWash = SKNode()
    private let selectionHalo = SKNode()
    private let hud = SKNode()
    private var hudTitle: SKSpriteNode?
    private var hudCounts: SKSpriteNode?
    private var backdropCover = CGRect.zero

    // MARK: Animation

    private struct Anim { let node: SKSpriteNode; let frames: [SKTexture]; let fps: Double; let phase: Double }
    private struct Pulse { let node: SKNode; let base: CGFloat; let period: Double; let phase: Double; let low: CGFloat }
    private struct Glow { let node: SKSpriteNode; let period: Double; let phase: Double; let flicker: Bool; var k: CGFloat = 1 }
    private struct Robot {
        let id: String
        let node: SKSpriteNode
        let home: CGPoint
        let size: CGSize
        let idle: [SKTexture]
        let work: [SKTexture]
        let busy: Bool
        let still: Bool
        let phase: Double
        let mark: SKSpriteNode?
        let markHome: CGPoint
        var drones: [(node: SKSpriteNode, frames: [SKTexture], phase: Double)]
    }
    private var sceneAnims: [Anim] = []
    private var agentAnims: [Anim] = []
    private var scenePulses: [Pulse] = []
    private var agentPulses: [Pulse] = []
    private var sceneGlows: [Glow] = []
    private var agentGlows: [Glow] = []
    private var robots: [Robot] = []
    /// Running robots' rim lights: the light, the ellipse's centre and radii, its phase.
    private var rimRunners: [(node: SKSpriteNode, center: CGPoint, rx: CGFloat, ry: CGFloat, phase: Double)] = []
    /// Markers that pulse by scale: node, period, phase, how much they grow.
    private var markPulses: [(node: SKSpriteNode, period: Double, phase: Double, amount: CGFloat)] = []
    private var droneOrbit: Double = 6000
    /// The state glows drawn under robots (for checks).
    private var stateGlows = 0
    private var hoverColors: [String: Int] = ["project": 0xffc83d, "workspace": 0xff7f32, "agent": 0x4fe6dc]
    /// What glows when hovered: each entity's sprites (an alcove's frame, a terrace's rampart and returns: tagged `e` by
    /// the page), each robot's body, each PR medallion.
    private var owners: [String: [SKSpriteNode]] = [:]
    private var robotBodies: [String: SKSpriteNode] = [:]
    private var flagNodes: [String: SKSpriteNode] = [:]
    private var hoverGlows: [SKNode] = []
    private var selectionGlows: [SKNode] = []
    private var clock: Double = 0
    private var lastTime: TimeInterval?
    private(set) var reduced = false

    // MARK: Picking

    private struct Entity { let id: String; let kind: String; let rect: CGRect }
    private var entities: [String: Entity] = [:]
    private var pickOrder: [Entity] = []
    private struct Flag { let workspace: String; let flag: String; let center: CGPoint; let radius: CGFloat }
    private var flags: [Flag] = []

    // MARK: Camera and input

    private var maxZoom: CGFloat = 3.4
    /// The HUD lies over the board, as the concept's does. The count bar lies over the foot's pad, plus a little screen
    /// room below the board (the pad's share of the bar shrinks with the zoom), so the foot's furnishings stay clear of it.
    private let hudTop: CGFloat = 0
    private let hudBottom: CGFloat = 26
    private let margin: CGFloat = 8
    private var center = CGPoint.zero
    private var zoom: CGFloat = 1
    private var fitted = false
    private var animation: (from: CGPoint, to: CGPoint, fromZoom: CGFloat, toZoom: CGFloat, start: TimeInterval?, duration: Double)?
    private var down: (point: CGPoint, center: CGPoint)?
    private var keys = Set<String>()
    private(set) var selected: String?
    private(set) var hovered: String?
    private var hoveredFlag: Flag?
    var inputEnabled = true
    private(set) var lastInteraction: TimeInterval = 0

    override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        backgroundColor = Textures.color(0x0f0b16)
        addChild(cam)
        camera = cam
        addChild(world)
        backdrop.zPosition = -100
        for node in [backdrop, board, agentLayer] { world.addChild(node) }
        hoverNode.zPosition = 19
        selectionWash.zPosition = 19.5
        selectionHalo.zPosition = 19.6
        selectionNode.zPosition = 19.7
        for node in [hoverNode, selectionWash, selectionHalo, selectionNode] { world.addChild(node) }
        hud.zPosition = 100
        cam.addChild(hud)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @inline(__always) private func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: -y) }

    // MARK: Messages

    func setArt(frames images: [String: CGImage], tiles tileImages: [String: CGImage], constants: [String: Any], reduced: Bool) {
        for (name, image) in images {
            frames[name] = Textures.texture(image)
            frameImages[name] = image
        }
        if let v = constants["maxZoom"] as? Double { maxZoom = CGFloat(v) }
        if let v = constants["droneOrbit"] as? Double { droneOrbit = v }
        if let h = constants["hover"] as? [String: Int] { hoverColors = h }
        if let sizes = constants["sizes"] as? [String: [Double]] {
            for (name, s) in sizes where s.count == 2 { frameSizes[name] = CGSize(width: s[0], height: s[1]) }
        }
        self.reduced = reduced
        fitted = false
        emit(["type": "ready"])
    }

    /// The board: stone, gates, alcoves, labels, links, nodes, decorations and lights, and what each entity covers.
    func setScene(_ m: [String: Any], images newImages: [String: CGImage]) {
        builds += 1
        if let rev = m["rev"] as? Int { sceneRevision = rev }
        appliedAt = CACurrentMediaTime()
        for (key, image) in newImages { images[key] = Textures.texture(image) }
        let showingAll = fitted && animation == nil && viewSize.width > 0 && zoom <= minimumZoom * 1.001
        if let b = m["bounds"] as? [String: Double] {
            bounds = WorldBox(x: CGFloat(b["x"] ?? 0), y: CGFloat(b["y"] ?? 0), width: CGFloat(b["w"] ?? 0), height: CGFloat(b["h"] ?? 0))
        }
        board.removeAllChildren()
        sceneAnims = []
        scenePulses = []
        sceneGlows = []
        owners = [:]
        flagNodes = [:]
        composites = [:]
        for s in m["sprites"] as? [[String: Any]] ?? [] {
            if let node = node(s, anims: &sceneAnims, pulses: &scenePulses) {
                board.addChild(node)
                if let e = s["e"] as? String { owners[e, default: []] += SpriteGlow.sprites(in: node) }
            }
        }
        for s in m["images"] as? [[String: Any]] ?? [] {
            if let node = node(s, anims: &sceneAnims, pulses: &scenePulses) { board.addChild(node) }
        }
        flags = []
        for f in m["flags"] as? [[String: Any]] ?? [] {
            let made = node(f, anims: &sceneAnims, pulses: &scenePulses)
            if let made { board.addChild(made) }
            if let ws = f["ws"] as? String, let flag = f["flag"] as? String {
                if let sprite = made as? SKSpriteNode { flagNodes["\(ws)|\(flag)"] = sprite }
                flags.append(Flag(workspace: ws, flag: flag, center: CGPoint(x: num(f["cx"]), y: num(f["cy"])), radius: num(f["s"]) / 2 + 2))
            }
        }
        for l in m["lights"] as? [[String: Any]] ?? [] { board.addChild(light(l, into: &sceneGlows)) }
        entities = [:]
        for e in m["entities"] as? [[String: Any]] ?? [] {
            guard let id = e["id"] as? String, let kind = e["kind"] as? String else { continue }
            entities[id] = Entity(id: id, kind: kind, rect: CGRect(x: num(e["x"]), y: num(e["y"]), width: num(e["w"]), height: num(e["h"])))
        }
        // Robots before their alcoves, alcoves before their projects.
        let rank = ["agent": 0, "workspace": 1, "project": 2]
        pickOrder = entities.values.sorted { (rank[$0.kind] ?? 3, $0.id) < (rank[$1.kind] ?? 3, $1.id) }
        backdropCover = .zero
        coverBackdrop()
        if let id = selected, entities[id] == nil { selected = nil }
        drawSelection()
        if let id = hovered, entities[id] == nil { setHover(nil) } else if hovered != nil {
            hoveredFlag = hoveredFlag.flatMap { old in flags.first { $0.workspace == old.workspace && $0.flag == old.flag } }
            drawHover()
            reportHover()
        }
        if (!fitted || showingAll) && view != nil && size.width > 0 { fit() } else { constrain() }
        wake()
    }

    /// Robots, their glows and markers, drones, the projects' torches and flares, the runs of light, the HUD.
    func setAgents(_ m: [String: Any], images newImages: [String: CGImage]) {
        if let rev = m["rev"] as? Int { agentsRevision = rev }
        appliedAt = CACurrentMediaTime()
        for (key, image) in newImages { images[key] = Textures.texture(image) }
        agentLayer.removeAllChildren()
        robotBodies = [:]
        stateGlows = 0
        agentAnims = []
        agentPulses = []
        agentGlows = []
        robots = []
        rimRunners = []
        markPulses = []
        for s in m["sprites"] as? [[String: Any]] ?? [] {
            if let node = node(s, anims: &agentAnims, pulses: &agentPulses) { agentLayer.addChild(node) }
        }
        for l in m["lights"] as? [[String: Any]] ?? [] { agentLayer.addChild(light(l, into: &agentGlows)) }
        for r in m["robots"] as? [[String: Any]] ?? [] {
            guard let id = r["id"] as? String else { continue }
            let idle = (r["idle"] as? [String] ?? []).compactMap { frames[$0] }
            let work = (r["work"] as? [String] ?? []).compactMap { frames[$0] }
            guard let first = idle.first ?? work.first else { continue }
            let box = CGRect(x: num(r["x"]), y: num(r["y"]), width: num(r["w"]), height: num(r["h"]))
            let dim = num(r["dim"]) > 0
            let body = SKSpriteNode(texture: first)
            body.anchorPoint = CGPoint(x: 0, y: 1)
            body.size = box.size
            body.position = p(box.minX, box.minY)
            body.zPosition = 10
            if dim { darken(body) }
            agentLayer.addChild(body)
            robotBodies[id] = body
            // Its halo, a soft glow round its silhouette in its colour, and its visor's glowing eyes: they move with it.
            if let h = r["halo"] as? [String: Any], let f = h["f"] as? String, let tex = frames[f] {
                let halo = SKSpriteNode(texture: tex, size: CGSize(width: num(h["w"]), height: num(h["h"])))
                halo.position = CGPoint(x: box.width / 2, y: -box.height / 2)
                halo.blendMode = .add
                halo.alpha = 0.88
                halo.zPosition = -0.5
                body.addChild(halo)
            }
            if let e = r["eyes"] as? [String: Any] {
                let w = num(e["w"], 30)
                let eyes = SKSpriteNode(texture: DungeonScene.warmGlow, size: CGSize(width: w, height: w * 0.42))
                eyes.color = Textures.color(Int(num(e["c"], 0x8ff0ff)))
                eyes.colorBlendFactor = 1
                eyes.blendMode = .add
                eyes.alpha = 0.6
                eyes.position = CGPoint(x: num(e["x"]), y: -num(e["y"]))
                eyes.zPosition = 0.2
                body.addChild(eyes)
            }
            // Its state's glow, an ellipse in the state's colour on the ledge round its feet (not added,
            // which the ledge's light would wash out), over its halo, under its body.
            if let g = r["glow"] as? [String: Any] {
                // A clear floor ellipse in the state's colour with a crisp brighter rim, over the alcove's light.
                let w = num(g["w"], 60), h = num(g["h"], 22)
                let color = Int(num(g["c"], 0xffffff))
                let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
                let glow = SKShapeNode(ellipseIn: rect)
                glow.fillColor = Textures.color(color, num(g["fill"], 0.7))
                glow.strokeColor = Textures.color(Int(num(g["rim"], Double(color))))
                glow.lineWidth = num(g["rimWidth"], 2.4)
                glow.glowWidth = num(g["bloom"], 0)
                glow.isAntialiased = true
                glow.alpha = num(g["a"], 1)
                glow.position = p(num(g["x"]), num(g["y"]))
                glow.zPosition = 9.7
                agentLayer.addChild(glow)
                stateGlows += 1
                // Running: a light travelling slowly round the rim, as the Atlas's running border has.
                if num(g["runner"]) > 0 {
                    let dot = SKSpriteNode(texture: DungeonScene.warmGlow, size: CGSize(width: 14, height: 9))
                    dot.color = Textures.color(0xeafff2)
                    dot.colorBlendFactor = 1
                    dot.blendMode = .add
                    dot.zPosition = 9.75
                    agentLayer.addChild(dot)
                    rimRunners.append((dot, glow.position, w / 2, h / 2, Double(num(r["ph"]))))
                }
                if let period = g["pulse"] as? Double {
                    agentPulses.append(Pulse(node: glow, base: glow.alpha, period: period, phase: Double(num(r["ph"])), low: 0.45))
                }
            }
            var mark: SKSpriteNode?
            var markHome = CGPoint.zero
            // Its marker, over its head and its drones: solid, pulsing by scale about its centre (never fading).
            if let mk = r["mark"] as? [String: Any], let f = mk["f"] as? String, let tex = frames[f] {
                let marker = SKSpriteNode(texture: tex, size: CGSize(width: num(mk["w"]), height: num(mk["h"])))
                marker.zPosition = 12
                agentLayer.addChild(marker)
                mark = marker
                markHome = CGPoint(x: num(mk["x"]) + num(mk["w"]) / 2, y: num(mk["y"]) + num(mk["h"]) / 2)
                if let period = mk["pulse"] as? Double {
                    markPulses.append((marker, period, Double(num(r["ph"])), num(mk["scale"], 0.12)))
                }
            }
            var robot = Robot(id: id, node: body, home: box.origin, size: box.size, idle: idle, work: work.isEmpty ? idle : work,
                              busy: r["busy"] as? Bool ?? false, still: dim, phase: Double(num(r["ph"])), mark: mark, markHome: markHome, drones: [])
            let count = r["subagents"] as? Int ?? 0
            let arts = r["drones"] as? [[String]] ?? []
            let fallback = (r["droneDefault"] as? [String] ?? []).compactMap { frames[$0] }
            for i in 0..<count {
                let set = i < arts.count ? arts[i].compactMap { frames[$0] } : fallback
                guard let tex = set.first ?? fallback.first else { continue }
                let drone = SKSpriteNode(texture: tex)
                // Its height the page's (about 55% of a robot's), its width keeping the frame's shape.
                let s = frameSizes[(i < arts.count ? arts[i].first : nil) ?? ""] ?? CGSize(width: 14, height: 12)
                let tall = num(r["droneSize"], s.height)
                drone.size = CGSize(width: tall * s.width / max(s.height, 1), height: tall)
                // A faint glow, so it reads as a small flying helper.
                let aura = SKSpriteNode(texture: DungeonScene.warmGlow, size: CGSize(width: tall * 2.2, height: tall * 1.6))
                aura.color = Textures.color(0xd8f4ff)
                aura.colorBlendFactor = 1
                aura.blendMode = .add
                aura.alpha = 0.45
                aura.zPosition = -0.1
                drone.addChild(aura)
                agentLayer.addChild(drone)
                robot.drones.append((drone, set.isEmpty ? fallback : set, robot.phase + Double(i) / Double(max(count, 1))))
            }
            robots.append(robot)
        }
        if let h = m["hud"] as? [String: [String: Any]] { placeHud(h) }
        // The robots are new nodes: a hovered or selected robot's glow goes onto its new body.
        if selected != nil { drawSelection() }
        if hovered != nil { drawHover() }
        animate()
        wake()
    }

    // MARK: Building blocks

    private func num(_ v: Any?, _ fallback: CGFloat = 0) -> CGFloat {
        if let d = v as? Double { return CGFloat(d) }
        if let i = v as? Int { return CGFloat(i) }
        if let n = v as? NSNumber { return CGFloat(n.doubleValue) }
        return fallback
    }

    /// Shade is purple-tinted, as the concept's shadows are, never a neutral grey.
    static let shadow = Textures.color(0x1a0830)
    private func darken(_ node: SKSpriteNode) {
        node.color = DungeonScene.shadow
        node.colorBlendFactor = 0.55
    }

    /// A sprite from the page's description: a frame (`f`, animated by `anim`) or a painted image
    /// (`key`), as a top-left box; tiled when `tile` says so.
    private func node(_ s: [String: Any], anims: inout [Anim], pulses: inout [Pulse]) -> SKNode? {
        let box = CGRect(x: num(s["x"]), y: num(s["y"]), width: num(s["w"]), height: num(s["h"]))
        let dim = num(s["dim"]) > 0
        let z = num(s["z"])
        if let mode = s["tile"] as? String, let name = s["f"] as? String {
            // Darkened by `shade`, and more on an offline floor.
            let shade = min(0.85, num(s["shade"]) + (dim ? 0.55 : 0))
            // `neutral` shades toward a near-neutral dark (a fascia in shadow) rather than the purple shadow.
            let color = num(s["neutral"]) > 0 ? Textures.color(0x15131a) : DungeonScene.shadow
            guard let tiled = tiled(name, box, mode: mode, shade: shade, ox: num(s["ox"]), oy: num(s["oy"]), shadeColor: color) else { return nil }
            tiled.zPosition = z
            tiled.alpha = num(s["a"], 1)
            return tiled
        }
        let texture: SKTexture?
        if let key = s["key"] as? String { texture = images[key] } else if let f = s["f"] as? String { texture = frames[f] } else { texture = nil }
        guard let texture else { return nil }
        let node = SKSpriteNode(texture: texture)
        node.anchorPoint = CGPoint(x: 0, y: 1)
        node.size = box.size
        node.position = p(box.minX, box.minY)
        node.zPosition = z
        node.alpha = num(s["a"], 1)
        if num(s["flip"]) > 0 {
            node.xScale = -1
            node.position = p(box.maxX, box.minY)
        }
        if num(s["add"]) > 0 { node.blendMode = .add }
        if dim { darken(node) } else if num(s["shade"]) > 0 {
            node.color = DungeonScene.shadow
            node.colorBlendFactor = num(s["shade"])
        }
        if let names = s["anim"] as? [String] {
            let list = names.compactMap { frames[$0] }
            if list.count > 1 { anims.append(Anim(node: node, frames: list, fps: Double(num(s["fps"], 6)), phase: Double(num(s["ph"], CGFloat(Double(abs(box.minX * 7 + box.minY * 13).truncatingRemainder(dividingBy: 1000)) / 1000))))) }
        }
        if let period = s["pulse"] as? Double {
            pulses.append(Pulse(node: node, base: node.alpha, period: period, phase: Double(num(s["ph"])), low: 0.45))
        }
        return node
    }

    /// A frame repeated across a box: along x, y or both, in larger textures where it can, its
    /// pattern shifted by (`ox`, `oy`) so neighbouring areas don't repeat in step.
    private func tiled(_ name: String, _ box: CGRect, mode: String, shade: CGFloat, ox: CGFloat = 0, oy: CGFloat = 0, shadeColor: NSColor = DungeonScene.shadow) -> SKNode? {
        guard let image = frameImages[name] else { return nil }
        let size = frameSizes[name] ?? CGSize(width: 32, height: 32)
        let container = SKNode()
        // Repeat the tile into a bigger texture: a few hundred nodes instead of thousands.
        let rx = mode == "y" ? 1 : 6, ry = mode == "x" ? 1 : 6
        let key = "\(name)/\(rx)x\(ry)"
        let big = bigTiles[key] ?? {
            let w = image.width * rx, h = image.height * ry
            guard let ctx = Textures.context(w, h) else { return SKTexture(cgImage: image) }
            // Its rougher variants (`<name>-2`, `-3`), where the sheet has them, mixed per tile (seeded by the tile's place),
            // so the masonry doesn't repeat in step.
            let variants = [image] + ["\(name)-2", "\(name)-3"].compactMap { frameImages[$0] }.filter { $0.width == image.width && $0.height == image.height }
            for i in 0..<rx { for j in 0..<ry {
                // Stable across launches (String.hashValue is seeded per process).
                let named = name.utf8.reduce(UInt32(2166136261)) { ($0 ^ UInt32($1)) &* 16777619 }
                var hash = UInt32(truncatingIfNeeded: i &* 73856093 ^ j &* 19349663) ^ named
                hash = hash &* 2654435761
                let pick = variants.count > 1 ? variants[Int(hash >> 16) % variants.count] : image
                ctx.draw(pick, in: CGRect(x: i * image.width, y: j * image.height, width: image.width, height: image.height))
            } }
            // Unpadded, so a partial tile's rect is relative to the repeated image itself.
            let t = SKTexture(cgImage: ctx.makeImage()!)
            t.filteringMode = .linear
            bigTiles[key] = t
            return t
        }()
        var tw = size.width * CGFloat(rx), th = size.height * CGFloat(ry)
        // Along one axis the tile spans the box's other side.
        if mode == "x" { th = box.height; tw = size.width * CGFloat(rx) * box.height / size.height }
        if mode == "y" { tw = box.width; th = size.height * CGFloat(ry) * box.width / size.width }
        let sx = mode == "y" ? 0 : ox.truncatingRemainder(dividingBy: tw)
        let sy = mode == "x" ? 0 : oy.truncatingRemainder(dividingBy: th)
        var y = box.minY - sy
        while y < box.maxY - 0.01 {
            var x = box.minX - sx
            while x < box.maxX - 0.01 {
                // The part of this tile inside the box.
                let cell = CGRect(x: x, y: y, width: tw, height: th).intersection(box)
                if cell.width > 0.01 && cell.height > 0.01 {
                    let u = (cell.minX - x) / tw, v = (cell.minY - y) / th
                    let part = cell.width < tw - 0.01 || cell.height < th - 0.01
                        ? SKTexture(rect: CGRect(x: u, y: 1 - v - cell.height / th, width: cell.width / tw, height: cell.height / th), in: big)
                        : big
                    let s = SKSpriteNode(texture: part)
                    s.anchorPoint = CGPoint(x: 0, y: 1)
                    s.size = CGSize(width: cell.width + 0.4, height: cell.height + 0.4)
                    s.position = p(cell.minX, cell.minY)
                    if shade > 0 {
                        s.color = shadeColor
                        s.colorBlendFactor = shade
                    }
                    container.addChild(s)
                }
                x += tw
            }
            y += th
        }
        return container
    }

    /// A light's glow: additive, in its colour, flickering as a flame or breathing.
    private func light(_ l: [String: Any], into glows: inout [Glow]) -> SKNode {
        let reach = num(l["r"], 40)
        // An ellipse when it gives its radii; a "gold" light scales the stone up toward its colour (doubled, never below
        // neutral), so it lights it gold rather than greying it as added light would, and never stains it brown.
        let size = l["rx"] != nil ? CGSize(width: num(l["rx"]) * 2, height: num(l["ry"]) * 2) : CGSize(width: reach * 2 + 2, height: reach * 2 + 2)
        let golden = l["blend"] as? String == "gold"
        if golden {
            // Opaque, fading to neutral grey (which ×2 leaves as it is): a transparent edge would darken the stone.
            let pool = SKSpriteNode(texture: goldPool(color: Int(num(l["c"], 0xffd426)), strength: num(l["k"], 0.6), tight: num(l["tight"]) > 0), size: size)
            pool.blendMode = .multiplyX2
            pool.position = p(num(l["x"]), num(l["y"]))
            pool.zPosition = num(l["z"], 6)
            return pool
        }
        let glow = SKSpriteNode(texture: DungeonScene.warmGlow, size: size)
        glow.color = Textures.color(Int(num(l["c"], 0xffffff)))
        glow.colorBlendFactor = 1
        glow.blendMode = .add
        glow.position = p(num(l["x"]), num(l["y"]))
        glow.zPosition = num(l["z"], 6)
        glows.append(Glow(node: glow, period: l["period"] as? Double ?? 2400, phase: Double(num(l["ph"])), flicker: l["flicker"] as? Bool ?? true, k: num(l["k"], 1)))
        return glow
    }

    /// A light's pool: a soft radial falloff, bright at its heart (tinted per light, added over the stone).
    static let warmGlow: SKTexture = {
        let px = 128
        let ctx = Textures.context(px, px)!
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let stops: [CGFloat] = [0, 0.35, 1]
        let colors = [CGColor(colorSpace: space, components: [1, 1, 1, 0.85])!, CGColor(colorSpace: space, components: [1, 1, 1, 0.32])!,
                      CGColor(colorSpace: space, components: [1, 1, 1, 0])!] as CFArray
        let gradient = CGGradient(colorsSpace: space, colors: colors, locations: stops)!
        let c = CGPoint(x: px / 2, y: px / 2)
        ctx.drawRadialGradient(gradient, startCenter: c, startRadius: 0, endCenter: c, endRadius: CGFloat(px) / 2, options: [])
        let t = SKTexture(cgImage: ctx.makeImage()!)
        t.filteringMode = .linear
        return t
    }()

    /// A state's glow under a robot: solid to 60% of its radius, then a soft edge, so its colour reads.
    static let stateGlow: SKTexture = {
        let px = 128
        let ctx = Textures.context(px, px)!
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let colors = [CGColor(colorSpace: space, components: [1, 1, 1, 0.95])!, CGColor(colorSpace: space, components: [1, 1, 1, 0.8])!,
                      CGColor(colorSpace: space, components: [1, 1, 1, 0])!] as CFArray
        let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 0.6, 1])!
        let c = CGPoint(x: px / 2, y: px / 2)
        ctx.drawRadialGradient(gradient, startCenter: c, startRadius: 0, endCenter: c, endRadius: CGFloat(px) / 2, options: [])
        let t = SKTexture(cgImage: ctx.makeImage()!)
        t.filteringMode = .linear
        return t
    }()

    /// Gold pools by colour and strength: the colour (at `strength` of the way from neutral grey) at the heart,
    /// easing to neutral grey at the edge, opaque throughout.
    private var goldPools: [String: SKTexture] = [:]
    private func goldPool(color: Int, strength: CGFloat, tight: Bool = false) -> SKTexture {
        let key = "\(color)/\(Int(strength * 100))/\(tight)"
        if let t = goldPools[key] { return t }
        let px = 96
        let ctx = Textures.context(px, px)!
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let c = [CGFloat((color >> 16) & 255), CGFloat((color >> 8) & 255), CGFloat(color & 255)].map { $0 / 255 }
        // Never below neutral (0.5, which ×2 leaves as it is) in any channel: the light only raises the stone toward its
        // hue (its colour's channels as shares of its strongest), so it warms and brightens, never browns or darkens.
        let top = max(c.max() ?? 1, 0.01)
        let mix = { (k: CGFloat) in CGColor(colorSpace: space, components: c.map { 0.5 + 0.5 * k * ($0 / top) } + [1])! }
        ctx.setFillColor(mix(0))
        ctx.fill(CGRect(x: 0, y: 0, width: px, height: px))
        let gradient = CGGradient(colorsSpace: space, colors: [mix(strength), mix(strength * (tight ? 0.45 : 0.95)), mix(0)] as CFArray, locations: [0, tight ? 0.3 : 0.7, 1])!
        let mid = CGPoint(x: px / 2, y: px / 2)
        ctx.drawRadialGradient(gradient, startCenter: mid, startRadius: 0, endCenter: mid, endRadius: CGFloat(px) / 2, options: [])
        let t = SKTexture(cgImage: ctx.makeImage()!)
        t.filteringMode = .linear
        goldPools[key] = t
        return t
    }

    /// Dark dungeon stone wherever the camera can show beyond the board.
    private func coverBackdrop() {
        guard bounds != nil, viewSize.width > 0 else { return }
        let e = extent
        let z = minimumZoom
        let w = max(e.width, viewSize.width / z) + 400, h = max(e.height, viewSize.height / z) + 400
        let cover = CGRect(x: e.midX - w / 2, y: e.midY - h / 2, width: w, height: h)
        if cover == backdropCover { return }
        backdropCover = cover
        backdrop.removeAllChildren()
        let snapped = CGRect(x: floor(cover.minX / 192) * 192, y: floor(cover.minY / 192) * 192, width: cover.width + 192, height: cover.height + 192)
        // The rock round the board: dark and nearly neutral, so the board's own purple and gold carry the colour.
        if let stone = tiled("wall-brick-dark", snapped, mode: "xy", shade: 0.55, shadeColor: Textures.color(0x15131a)) { backdrop.addChild(stone) }
        // No frame: the board ends in the rock, its floors' stepped edges its silhouette, as the concept's does.
    }

    // MARK: HUD

    private var hudSpec: [String: [String: Any]] = [:]
    private func placeHud(_ h: [String: [String: Any]]) {
        hudSpec = h
        hud.removeAllChildren()
        hudTitle = nil
        hudCounts = nil
        let v = viewSize
        guard v.width > 0 else { return }
        if let t = h["title"], let key = t["key"] as? String, let tex = images[key] {
            let node = SKSpriteNode(texture: tex)
            let w = num(t["w"]), hh = num(t["h"])
            let scale = min(1, (v.width - 28) / max(w, 1))
            node.size = CGSize(width: w * scale, height: hh * scale)
            node.anchorPoint = CGPoint(x: 0, y: 1)
            node.position = CGPoint(x: -v.width / 2 + 14, y: v.height / 2 - 14)
            hud.addChild(node)
            hudTitle = node
        }
        if let c = h["counts"], let key = c["key"] as? String, let tex = images[key] {
            let node = SKSpriteNode(texture: tex)
            let w = num(c["w"]), hh = num(c["h"])
            let scale = min(1, (v.width - 28) / max(w, 1))
            node.size = CGSize(width: w * scale, height: hh * scale)
            node.anchorPoint = CGPoint(x: 0.5, y: 0)
            node.position = CGPoint(x: 0, y: -v.height / 2 + 14)
            hud.addChild(node)
            hudCounts = node
        }
    }

    // MARK: Selection and hover

    /// What glows for an entity: a PR medallion (when that's what's hovered), a robot's body, or its tagged sprites.
    private func glowSprites(_ id: String, flag: Flag? = nil) -> [SKSpriteNode] {
        if let f = flag, let medallion = flagNodes["\(f.workspace)|\(f.flag)"] { return [medallion] }
        if entities[id]?.kind == "agent" { return robotBodies[id].map { [$0] } ?? [] }
        return owners[id] ?? []
    }

    /// An alcove's or terrace's pieces drawn as one silhouette (its frame and bay, its rampart, face and return), kept
    /// until the scene changes.
    private var composites: [String: (image: CGImage, rect: CGRect)] = [:]

    /// The glow for `id` in `color`: a robot or a PR medallion along its own sprite (the Village's 5% spread); an
    /// alcove or terrace along its pieces' one outline, spread as the Village's halls are.
    private func glowNodes(_ id: String, flag: Flag? = nil, color: NSColor, name: String, wide: Bool, into layer: SKNode) -> [SKNode] {
        let sprites = glowSprites(id, flag: flag)
        let kind = entities[id]?.kind
        if flag != nil || kind == "agent" { return sprites.flatMap { SpriteGlow.glow($0, color: color, name: name, wide: wide) } }
        guard let view, !sprites.isEmpty else { return [] }
        if composites[id] == nil { composites[id] = SpriteGlow.composite(sprites, in: layer.parent ?? world, view: view) }
        guard let c = composites[id] else { return [] }
        let spread = SpriteGlow.structureSpread
        let made = SpriteGlow.overlay(for: c.image, size: c.rect.size, mid: CGPoint(x: c.rect.midX, y: c.rect.midY), color: color, name: name, wide: wide, spread: spread)
        for n in made { layer.addChild(n) }
        return made
    }

    /// The selection glows gold along the same silhouette, breathing, as the Village's does (no rim or wash).
    private func drawSelection() {
        for node in [selectionNode, selectionWash, selectionHalo] { node.removeAllChildren() }
        for g in selectionGlows { g.removeFromParent() }
        selectionGlows = []
        guard let id = selected, entities[id] != nil else { return }
        selectionGlows = glowNodes(id, color: SpriteGlow.selectColor, name: "select-glow", wide: true, into: selectionNode)
        breathe()
    }

    private func breathe() {
        SpriteGlow.breathe(selectionGlows, clock: clock, reduced: reduced)
    }

    /// The hovered thing glows as the Village's do: a warm halo just outside its own silhouette (a robot's body, an
    /// alcove's frame and bay, a terrace's rampart, face and return, a PR medallion) and a faint brightening, no box.
    private func drawHover() {
        hoverNode.removeAllChildren()
        for g in hoverGlows { g.removeFromParent() }
        hoverGlows = []
        // The selected one keeps its gold (unless a PR medallion on it is hovered).
        guard let id = hovered, entities[id] != nil, id != selected || hoveredFlag != nil else { return }
        hoverGlows = glowNodes(id, flag: hoveredFlag, color: SpriteGlow.hoverColor, name: "hover-glow", wide: false, into: hoverNode)
    }

    private func setHover(_ id: String?, flag: Flag? = nil) {
        guard id != hovered || flag?.flag != hoveredFlag?.flag || flag?.center != hoveredFlag?.center else { return }
        let outline = id != hovered
        hovered = id
        hoveredFlag = id == nil ? nil : flag
        if outline { drawHover() }
        reportHover()
        wake()
    }

    private var lastHoverReport = ""
    /// Where the hover card points: the entity's (or its medallion's) top centre, in the surface's points.
    private func reportHover() {
        var message: [String: Any] = ["type": "hover", "id": hovered as Any? ?? NSNull()]
        if let flag = hoveredFlag { message["flag"] = flag.flag }
        if let id = hovered, let e = entities[id] {
            let top = hoveredFlag.map { CGPoint(x: $0.center.x, y: $0.center.y - $0.radius) } ?? CGPoint(x: e.rect.midX, y: e.rect.minY)
            let v = viewSize
            message["x"] = (top.x - (center.x - v.width / 2 / zoom)) * zoom
            message["y"] = (top.y - (center.y - v.height / 2 / zoom)) * zoom
        }
        let key = hovered ?? ""
        if key == lastHoverReport && hovered == nil { return }
        lastHoverReport = key
        emit(message)
    }

    func select(_ id: String?) {
        selected = id.flatMap { entities[$0] != nil ? $0 : nil }
        drawSelection()
        wake()
    }

    // MARK: Camera

    private var viewSize: CGSize { view?.bounds.size ?? size }
    private var boardBox: WorldBox { bounds ?? WorldBox(x: -600, y: 0, width: 1200, height: 1000) }

    /// The furthest out the camera goes: the board and a margin fit between the HUD's title and count bar.
    private var minimumZoom: CGFloat {
        let v = viewSize, b = boardBox
        return max(0.01, min(v.width / (b.width + margin * 2), (v.height - hudTop - hudBottom) / (b.height + margin * 2)))
    }

    /// The world box the camera may show.
    private var extent: WorldBox {
        let b = boardBox, z = minimumZoom
        return WorldBox(x: b.x - margin, y: b.y - margin - hudTop / z, width: b.width + margin * 2, height: b.height + margin * 2 + (hudTop + hudBottom) / z)
    }

    func fit() {
        guard viewSize.width > 0, viewSize.height > 0 else { return }
        let e = extent
        zoom = minimumZoom
        center = CGPoint(x: e.midX, y: e.midY)
        animation = nil
        fitted = bounds != nil
        applyCamera()
        reportZoom()
    }

    private func constrain() {
        let v = viewSize
        zoom = min(max(zoom, minimumZoom), maxZoom)
        let e = extent
        let w = v.width / zoom, h = v.height / zoom
        center.x = w >= e.width ? e.midX : min(max(center.x, e.x + w / 2), e.x + e.width - w / 2)
        center.y = h >= e.height ? e.midY : min(max(center.y, e.y + h / 2), e.y + e.height - h / 2)
        applyCamera()
    }

    private func applyCamera() {
        cam.position = p(center.x, center.y)
        cam.setScale(1 / zoom)
        // The HUD (the camera's child) keeps its screen size and place.
    }

    private func reportZoom() { emit(["type": "zoom", "zoom": zoom]) }

    private var worldView: WorldBox {
        let v = viewSize
        return WorldBox(x: center.x - v.width / 2 / zoom, y: center.y - v.height / 2 / zoom, width: v.width / zoom, height: v.height / zoom)
    }

    func viewportChanged() {
        backdropCover = .zero
        coverBackdrop()
        placeHud(hudSpec)
        if bounds != nil { fit() }
        wake()
    }

    func command(_ name: String) {
        interacted()
        if name == "home" { fit() }
        if name == "in" || name == "out" {
            zoom *= name == "in" ? 1.25 : 0.8
            constrain()
            reportZoom()
        }
    }

    func focus(_ id: String, closer: Bool) {
        guard let e = entities[id] else { return }
        let target = CGPoint(x: e.rect.midX, y: e.rect.midY)
        let v = worldView
        let mx = v.width * 0.12, my = v.height * 0.12
        let visible = e.rect.minX > v.x + mx && e.rect.maxX < v.x + v.width - mx && e.rect.minY > v.y + my && e.rect.maxY < v.y + v.height - my
        if !closer {
            if visible { return }
            if reduced { center = target; constrain(); return }
            animation = (center, target, zoom, zoom, nil, 380)
        } else {
            let s = viewSize
            let level = min(max(min(s.width * 0.3 / max(e.rect.width, 1), s.height * 0.3 / max(e.rect.height, 1)), minimumZoom), maxZoom)
            if reduced { zoom = level; center = target; constrain(); reportZoom(); return }
            animation = (center, target, zoom, level, nil, 380)
        }
        interacted()
    }

    private func interacted() {
        lastInteraction = CACurrentMediaTime()
        wake()
    }

    // MARK: Input

    func pointer(phase: String, at point: CGPoint) {
        guard inputEnabled else { return }
        switch phase {
        case "down":
            down = (point, center)
            animation = nil
            interacted()
        case "move":
            if let d = down {
                center = CGPoint(x: d.center.x - (point.x - d.point.x) / zoom, y: d.center.y - (point.y - d.point.y) / zoom)
                constrain()
                if hovered != nil { setHover(nil) }
                interacted()
            } else {
                hover(at: point)
            }
        case "up":
            if let d = down {
                down = nil
                if hypot(point.x - d.point.x, point.y - d.point.y) < 7, let id = flagAt(point)?.workspace ?? entityAt(point) {
                    emit(["type": "pick", "id": id])
                }
                hover(at: point)
            }
        case "leave":
            if down == nil { setHover(nil) }
        default: break
        }
    }

    private func worldPoint(_ point: CGPoint) -> CGPoint {
        let v = worldView
        return CGPoint(x: v.x + point.x / zoom, y: v.y + point.y / zoom)
    }

    private func hover(at point: CGPoint) {
        if let flag = flagAt(point) { setHover(flag.workspace, flag: flag) } else { setHover(entityAt(point)) }
    }

    private func flagAt(_ point: CGPoint) -> Flag? {
        let w = worldPoint(point)
        return flags.last { hypot(w.x - $0.center.x, w.y - $0.center.y) <= $0.radius && entities[$0.workspace] != nil }
    }

    private func entityAt(_ point: CGPoint) -> String? {
        let w = worldPoint(point)
        return pickOrder.first { $0.rect.contains(w) }?.id
    }

    func wheel(at point: CGPoint, dy: CGFloat) { zoom(at: point, by: exp(-dy * 0.001)) }
    func pinch(at point: CGPoint, scale: CGFloat) { zoom(at: point, by: scale) }

    private func zoom(at point: CGPoint, by factor: CGFloat) {
        guard inputEnabled, factor.isFinite, factor > 0 else { return }
        let before = worldPoint(point)
        zoom = min(max(zoom * factor, minimumZoom), maxZoom)
        let after = worldPoint(point)
        center.x += before.x - after.x
        center.y += before.y - after.y
        animation = nil
        constrain()
        if hovered != nil { setHover(nil) }
        reportZoom()
        interacted()
    }

    func key(_ key: String, down isDown: Bool) {
        if key == "all" { keys.removeAll(); return }
        if isDown && inputEnabled { keys.insert(key) } else { keys.remove(key) }
        interacted()
    }

    func setInput(_ enabled: Bool) {
        inputEnabled = enabled
        if !enabled {
            down = nil
            keys.removeAll()
            setHover(nil)
        }
    }

    func setMotion(reduced value: Bool) {
        reduced = value
        animate()
        breathe()
        wake()
    }

    // MARK: Frames

    var animating: Bool {
        !reduced && (!sceneAnims.isEmpty || !agentAnims.isEmpty || !sceneGlows.isEmpty || !agentGlows.isEmpty || !robots.isEmpty || selected != nil)
    }
    var drifting: Bool { false }
    var lively: Bool {
        animation != nil || down != nil || !keys.isEmpty || CACurrentMediaTime() - lastInteraction < 1.5
    }

    private(set) var framesDrawn = 0
    private(set) var lastFrame: CFTimeInterval = 0

    override func update(_ currentTime: TimeInterval) {
        framesDrawn += 1
        lastFrame = CACurrentMediaTime()
        let delta = lastTime.map { min(max(0, (currentTime - $0) * 1000), 250) } ?? 0
        lastTime = currentTime
        if !keys.isEmpty {
            let d = CGFloat(delta) * 0.65 / max(zoom, 0.3)
            if keys.contains("ArrowLeft") { center.x -= d }
            if keys.contains("ArrowRight") { center.x += d }
            if keys.contains("ArrowUp") { center.y -= d }
            if keys.contains("ArrowDown") { center.y += d }
            constrain()
        }
        if var a = animation {
            if a.start == nil { a.start = currentTime; animation = a }
            let t = min(1, (currentTime - a.start!) * 1000 / a.duration)
            let e = 1 - pow(1 - t, 3)
            center = CGPoint(x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e)
            zoom = a.fromZoom + (a.toZoom - a.fromZoom) * e
            if t >= 1 { animation = nil }
            constrain()
            if a.fromZoom != a.toZoom { reportZoom() }
        }
        if !reduced { clock += delta }
        animate()
    }

    /// One frame of motion: frame animations, pulses, flickering lights, the selection's breath,
    /// robots at work or at rest, drones and the runs of light along the links.
    private func animate() {
        for a in sceneAnims + agentAnims {
            let i = reduced ? 0 : Int(floor(clock / 1000 * a.fps + a.phase * Double(a.frames.count))) % a.frames.count
            if a.node.texture !== a.frames[i] { a.node.texture = a.frames[i] }
        }
        for pulse in scenePulses + agentPulses {
            let k: Double = reduced ? 1 : Double(pulse.low) + (1 - Double(pulse.low)) * (0.5 + 0.5 * cos((clock / pulse.period + pulse.phase) * .pi * 2))
            pulse.node.alpha = pulse.base * CGFloat(k)
        }
        for g in sceneGlows + agentGlows {
            if reduced { g.node.alpha = 0.85 * g.k; continue }
            let t = clock / g.period + g.phase
            let breath = 0.5 + 0.5 * cos(t * .pi * 2)
            let flicker = g.flicker ? 0.14 * sin(clock / 67 + g.phase * 40) * sin(clock / 109 + g.phase * 9) : 0
            g.node.alpha = g.k * CGFloat((g.flicker ? 0.7 + 0.25 * breath : 0.6 + 0.4 * breath) + flicker)
        }
        if selected != nil { breathe() }
        for rr in rimRunners {
            let t = ((reduced ? 0 : clock / 2600) + rr.phase) * .pi * 2
            rr.node.position = CGPoint(x: rr.center.x + CGFloat(cos(t)) * rr.rx, y: rr.center.y + CGFloat(sin(t)) * rr.ry)
            rr.node.alpha = reduced ? 0 : 1
        }
        for m in markPulses {
            let k = reduced ? 0 : 0.5 + 0.5 * cos((clock / m.period + m.phase) * .pi * 2)
            m.node.setScale(1 + m.amount * CGFloat(k))
        }
        for r in robots {
            var dy: CGFloat = 0
            if !r.still && !reduced {
                let list = r.busy ? r.work : r.idle
                let fps = r.busy ? 7.0 : 1.6
                let i = Int(floor(clock / 1000 * fps + r.phase * Double(list.count))) % max(list.count, 1)
                if !list.isEmpty && r.node.texture !== list[i] { r.node.texture = list[i] }
                // At rest a robot breathes; at work it hops a little.
                // At work it hops visibly as its arms move; at rest it only breathes.
                dy = r.busy ? -abs(CGFloat(sin((clock / 220 + r.phase * 7)))) * 3.2 : CGFloat(sin(clock / 1100 + r.phase * 6)) * 0.5
            } else if let first = r.idle.first, r.node.texture !== first {
                r.node.texture = first
            }
            r.node.position = p(r.home.x, r.home.y + dy)
            if let mark = r.mark {
                let bob = reduced ? 0 : CGFloat(sin(clock / 420 + r.phase * 5)) * 1.6
                mark.position = p(r.markHome.x, r.markHome.y + bob)
            }
            let mid = CGPoint(x: r.home.x + r.size.width / 2, y: r.home.y + r.size.height * 0.45)
            // Drones circle on a small flat ellipse above the head: never in front of its face, nor its neighbours'.
            let above = CGPoint(x: r.home.x + r.size.width / 2, y: r.home.y - 7)
            _ = mid
            for d in r.drones {
                let turn = ((reduced ? 0 : clock / droneOrbit) + d.phase) * .pi * 2
                let dx = CGFloat(cos(turn)) * r.size.width * 0.3, ddy = CGFloat(sin(turn)) * 3.5
                let lift: CGFloat = reduced ? 0 : CGFloat(sin(turn * 3)) * 1.2
                d.node.position = p(above.x + dx, above.y + ddy - lift)
                d.node.zPosition = 11
                if d.frames.count > 1 && !reduced {
                    let i = Int(clock / 60) % d.frames.count
                    if d.node.texture !== d.frames[i] { d.node.texture = d.frames[i] }
                }
            }
        }
    }

    func state() -> [String: Any] {
        [
            "renderer": "SpriteKit",
            "style": kind,
            "builds": builds,
            "selected": selected as Any? ?? NSNull(),
            "hovered": hovered as Any? ?? NSNull(),
            "zoom": zoom,
            "minimumZoom": minimumZoom,
            "center": ["x": center.x, "y": center.y],
            "nodes": countNodes(self),
            "robots": robots.count,
            "stateGlows": stateGlows,
            "motion": !reduced,
            "frames": frames.count,
            "sceneRevision": sceneRevision,
            "agentsRevision": agentsRevision,
            "framesDrawn": framesDrawn,
            "hud": ["title": hudTitle != nil, "counts": hudCounts != nil],
        ]
    }
    private func countNodes(_ node: SKNode) -> Int { node.children.reduce(1) { $0 + countNodes($1) } }
}
