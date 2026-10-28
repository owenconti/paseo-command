import AppKit
import SpriteKit

/// The Atlas, drawn natively. The bridge (`rendering/src/native/bridge.ts`)
/// sends the layout and painted artwork; this scene places it, animates the
/// agents' states, robots and sea, owns the camera, and reports picks, hover
/// and zoom. It never sends daemon actions; the React app owns those.
final class AtlasScene: SKScene {
    /// Events for the page: pick, hover, zoom, ready, state.
    var emit: ([String: Any]) -> Void = { _ in }
    /// Asked to render again after the view paused itself.
    var wake: () -> Void = {}

    // MARK: Art and layout

    private var frames: [String: SKTexture] = [:]
    private var frameSizes: [String: CGSize] = [:]
    private var tiles: [String: SKTexture] = [:]
    private var pieces: [String: SKTexture] = [:]
    private var banners: [String: SKTexture] = [:]
    private var land: WorldBox?
    private struct Entity {
        let id: String
        let kind: String
        let cells: [Axial]
        /// Where it is focused and where its hover card points: a box
        /// centred on its x, y (`locations` in placement.ts).
        let at: WorldBox
    }
    private var entities: [String: Entity] = [:]
    /// A workspace's PR flag, for its hover card: the flag's art as a box
    /// centred on its x, y (as `Entity.at`).
    private struct PlantedFlag {
        let flag: String
        let workspace: String
        let at: WorldBox
    }
    private var plantedFlags: [PlantedFlag] = []
    /// Which project, workspace or agent owns each cell (hosts are never picked).
    private var owners: [Axial: String] = [:]
    var hasArt: Bool { !frames.isEmpty }
    private(set) var builds = 0

    // MARK: Nodes

    private let cam = SKCameraNode()
    /// Everything in world space; flipped so world y grows downward as on the web.
    private let world = SKNode()
    private let sea = SKNode()
    private let glints = SKNode()
    private let clouds = SKNode()
    private var seaCover = CGRect.zero
    private let structures = SKNode()
    private let agentLayer = SKNode()
    private let hoverNode = SKNode()
    private let selectionNode = SKNode()
    private let selectionWash = SKNode()
    private let selectionHalo = SKNode()

    // MARK: Animation

    private struct Pulse { let node: SKSpriteNode; let base: CGFloat; let period: Double; let phase: Double }
    private struct Runner { let segments: [SKSpriteNode]; let corners: [CGPoint]; let period: Double; let phase: Double }
    private struct Flame { let node: SKSpriteNode; let period: Double; let phase: Double; let flicker: Bool }
    private struct Robot {
        let id: String
        let node: SKNode
        let hands: [SKSpriteNode]
        let home: CGPoint
        let busy: Bool
        var drones: [(drone: SKSpriteNode, shadow: SKSpriteNode, phase: Double)]
    }
    private struct Walker {
        var x: CGFloat = 0, y: CGFloat = 0, heading: CGFloat = .pi / 2, tx: CGFloat = 0, ty: CGFloat = 0
        var pause: CGFloat, look: CGFloat = .pi / 2, rng: Seeded, stride: CGFloat = 0, phase: CGFloat
    }
    /// PR flags whose CI is running sway about their pole's foot.
    private var swaying: [SKSpriteNode] = []
    private var flagFoot = CGPoint(x: 0.19, y: 0.95)
    private var flagSway = (degrees: CGFloat(3), period: Double(1400))
    private var pulses: [Pulse] = []
    private var runners: [Runner] = []
    private var flames: [Flame] = []
    private var robots: [Robot] = []
    private var walkers: [String: Walker] = [:]
    private var tileStates: [String: String] = [:]
    private var droneOrbit: Double = 7000
    private var droneSize: CGFloat = 24
    private var robotSize: CGFloat = 84
    private var wander = (x: CGFloat(13), y: CGFloat(10), speed: CGFloat(8), turn: CGFloat(1.3))
    private var hoverColors: [String: Int] = ["host": 0xffffff, "project": 0xffc83d, "workspace": 0xff7f32, "agent": 0x4fe6dc]
    /// Milliseconds of motion so far (the web Atlas's `clock`).
    private var clock: Double = 0
    private var drift: CGFloat = 0
    private var driftPending: Double = 0
    private var lastTime: TimeInterval?
    private(set) var reduced = false

    // MARK: Camera and input

    var rules = CameraRules()
    /// The camera's centre (world) and zoom (points per world pixel).
    private var center = CGPoint.zero
    private var zoom: CGFloat = 1
    private var fitted = false
    private var animation: (from: CGPoint, to: CGPoint, fromZoom: CGFloat, toZoom: CGFloat, start: TimeInterval?, duration: Double)?
    private var down: (point: CGPoint, center: CGPoint)?
    private var keys = Set<String>()
    private(set) var selected: String?
    private(set) var hovered: String?
    /// The PR flag under the pointer, when it is one of the hovered workspace's.
    private var hoveredFlag: PlantedFlag?
    private var lastHoverReport = ""
    var inputEnabled = true
    /// When the last interaction was, so the view stays at full rate after it.
    private(set) var lastInteraction: TimeInterval = 0

    override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        backgroundColor = Textures.color(0x1d6884)
        addChild(cam)
        camera = cam
        world.yScale = 1
        addChild(world)
        for (node, z) in [(sea, -10.0), (glints, -9.5), (clouds, 20.0)] as [(SKNode, CGFloat)] {
            node.zPosition = z
            world.addChild(node)
        }
        glints.alpha = 0.7
        clouds.alpha = 0.2
        for node in [structures, agentLayer] { world.addChild(node) }
        hoverNode.zPosition = 7
        selectionWash.zPosition = 7.9
        selectionNode.zPosition = 8
        selectionHalo.zPosition = 7.95
        for node in [hoverNode, selectionWash, selectionHalo, selectionNode] { world.addChild(node) }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// World (y down) to scene (y up).
    @inline(__always) private func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: -y) }

    // MARK: Messages

    /// The art, decoded: sprite frames by name, and the sea's three tiles.
    func setArt(frames images: [String: CGImage], tiles tileImages: [String: CGImage], constants: [String: Any], reduced: Bool) {
        for (name, image) in images {
            frames[name] = Textures.texture(image)
            frameSizes[name] = CGSize(width: image.width, height: image.height)
        }
        for (name, image) in tileImages {
            let t = SKTexture(cgImage: image)
            t.filteringMode = .linear
            tiles[name] = t
        }
        if let r = constants["hexRadius"] as? Double { Hex.radius = CGFloat(r) }
        if let v = constants["robotSize"] as? Double { robotSize = CGFloat(v) }
        if let v = constants["droneSize"] as? Double { droneSize = CGFloat(v) }
        if let v = constants["droneOrbit"] as? Double { droneOrbit = v }
        if let v = constants["maxZoom"] as? Double { rules.maxZoom = CGFloat(v) }
        if let v = constants["overlayTop"] as? Double { rules.overlayTop = CGFloat(v) }
        if let v = constants["overlayBottom"] as? Double { rules.overlayBottom = CGFloat(v) }
        if let w = constants["wander"] as? [String: Double] {
            wander = (CGFloat(w["x"] ?? 13), CGFloat(w["y"] ?? 10), CGFloat(w["speed"] ?? 8), CGFloat(w["turn"] ?? 1.3))
        }
        if let h = constants["hover"] as? [String: Int] { hoverColors = h }
        if let f = constants["flagFoot"] as? [String: Double] { flagFoot = CGPoint(x: f["x"] ?? 0.19, y: f["y"] ?? 0.95) }
        if let f = constants["flagSway"] as? [String: Double] { flagSway = (CGFloat(f["degrees"] ?? 3), f["period"] ?? 1400) }
        self.reduced = reduced
        // A fresh mount of the page's world fits the land.
        fitted = false
        emit(["type": "ready"])
    }

    /// Everything that changes only with the cells: terrain, buildings,
    /// props, flags, banners, and what each entity covers.
    func setScene(_ m: [String: Any], images: [String: CGImage]) {
        builds += 1
        for (key, image) in images {
            if key.hasPrefix("banner:") { banners[key] = Textures.texture(image) } else { pieces[key] = Textures.texture(image) }
        }
        structures.removeAllChildren()
        if let b = m["bounds"] as? [String: Double] { land = box(b) }
        var keep = Set<String>()
        for piece in m["pieces"] as? [[String: Any]] ?? [] {
            guard let key = piece["key"] as? String, let texture = pieces[key] else { continue }
            keep.insert(key)
            let node = SKSpriteNode(texture: texture)
            node.anchorPoint = CGPoint(x: 0, y: 1)
            node.position = p(num(piece["x"]), num(piece["y"]))
            node.size = CGSize(width: num(piece["width"]), height: num(piece["height"]))
            node.zPosition = num(piece["depth"])
            node.alpha = num(piece["alpha"], 1)
            structures.addChild(node)
        }
        pieces = pieces.filter { keep.contains($0.key) }
        for s in m["sprites"] as? [[String: Any]] ?? [] {
            guard let name = s["frame"] as? String, let node = sprite(name, width: num(s["width"])) else { continue }
            node.position = p(num(s["x"]), num(s["y"]))
            node.zPosition = num(s["depth"])
            node.alpha = num(s["alpha"], 1)
            if s["flipX"] as? Bool == true { node.xScale = -1 }
            structures.addChild(node)
        }
        swaying = []
        plantedFlags = []
        for f in m["prFlags"] as? [[String: Any]] ?? [] {
            guard let name = f["frame"] as? String, let node = sprite(name, width: num(f["width"])) else { continue }
            if let flag = f["flag"] as? String, let workspace = f["workspace"] as? String {
                plantedFlags.append(PlantedFlag(flag: flag, workspace: workspace,
                                                at: WorldBox(x: num(f["x"]), y: num(f["y"]), width: node.size.width, height: node.size.height)))
            }
            // Standing on its pole's foot, so a sway turns about it.
            node.anchorPoint = CGPoint(x: flagFoot.x, y: 1 - flagFoot.y)
            node.position = p(num(f["x"]) + (flagFoot.x - 0.5) * node.size.width, num(f["y"]) + (flagFoot.y - 0.5) * node.size.height)
            node.zPosition = num(f["depth"])
            node.alpha = num(f["alpha"], 1)
            structures.addChild(node)
            if f["sway"] as? Bool == true { swaying.append(node) }
        }
        for flag in m["flags"] as? [[String: Double]] ?? [] { structures.addChild(campFlag(CGFloat(flag["x"] ?? 0), CGFloat(flag["y"] ?? 0))) }
        var keepBanners = Set<String>()
        for b in m["banners"] as? [[String: Any]] ?? [] {
            guard let key = b["key"] as? String, let texture = banners[key] else { continue }
            keepBanners.insert(key)
            let node = SKSpriteNode(texture: texture)
            node.anchorPoint = CGPoint(x: 0, y: 1)
            node.position = p(num(b["x"]), num(b["y"]))
            node.size = CGSize(width: num(b["width"]), height: num(b["height"]))
            node.zPosition = 23
            structures.addChild(node)
        }
        banners = banners.filter { keepBanners.contains($0.key) }
        entities = [:]
        owners = [:]
        for e in m["entities"] as? [[String: Any]] ?? [] {
            guard let id = e["id"] as? String, let kind = e["kind"] as? String else { continue }
            let cells = (e["cells"] as? [[Int]] ?? []).map { Axial(q: $0[0], r: $0[1]) }
            let at = (e["at"] as? [String: Double]).map(box) ?? WorldBox(x: 0, y: 0, width: 0, height: 0)
            entities[id] = Entity(id: id, kind: kind, cells: cells, at: at)
            if kind != "host" { for c in cells where owners[c] == nil { owners[c] = id } }
        }
        coverSea()
        if let id = selected, entities[id] == nil { selected = nil }
        drawSelection()
        // A hover that survives the scene keeps its card, pointing where the entity now stands.
        if let id = hovered, entities[id] == nil { setHover(nil) } else if hovered != nil {
            // Its flag may have changed or gone: the card follows what now stands there.
            hoveredFlag = hoveredFlag.flatMap { old in plantedFlags.first { $0.workspace == old.workspace && $0.at.x == old.at.x && $0.at.y == old.at.y } }
            drawHover()
            reportHover()
        }
        if !fitted && view != nil && size.width > 0 { fit() } else { constrain() }
        wake()
    }

    /// The agents' layer: state tiles, lit signals, robots and drones.
    func setAgents(_ m: [String: Any]) {
        agentLayer.removeAllChildren()
        pulses = []
        runners = []
        flames = []
        robots = []
        tileStates = [:]
        var fills: [String: SKTexture] = [:]
        for t in m["tiles"] as? [[String: Any]] ?? [] {
            let id = t["id"] as? String ?? ""
            let color = t["color"] as? Int ?? 0
            let at = CGPoint(x: num(t["x"]), y: num(t["y"]))
            let fillAlpha = num(t["fillAlpha"])
            tileStates[id] = t["state"] as? String
            let key = "\(color)/\(fillAlpha)"
            let fillTexture = fills[key] ?? Textures.tileFill(color: color, alpha: fillAlpha)
            fills[key] = fillTexture
            let side = Hex.radius * 2 + 4
            let fill = SKSpriteNode(texture: fillTexture, size: CGSize(width: side, height: side))
            fill.position = p(at.x, at.y)
            fill.zPosition = 4
            agentLayer.addChild(fill)
            let border = SKSpriteNode(texture: Textures.ring, size: CGSize(width: side, height: side))
            border.color = Textures.color(color)
            border.colorBlendFactor = 1
            border.alpha = num(t["borderAlpha"])
            border.position = fill.position
            border.zPosition = 4.1
            agentLayer.addChild(border)
            let phase = Double(num(t["phase"]))
            if let pulse = t["pulse"] as? Double {
                pulses.append(Pulse(node: border, base: border.alpha, period: pulse, phase: phase))
            } else if let lap = t["running"] as? Double {
                let corners = (0..<6).map { Hex.corner(at, $0, Hex.radius - 5.5) }
                var segments: [SKSpriteNode] = []
                for k in 0..<12 {
                    let s = SKSpriteNode(texture: Textures.white)
                    s.color = Textures.color(0xeafff2)
                    s.colorBlendFactor = 1
                    s.alpha = 0.95 * (1 - CGFloat(k) / 12)
                    s.zPosition = 4.2
                    agentLayer.addChild(s)
                    segments.append(s)
                }
                runners.append(Runner(segments: segments, corners: corners, period: lap, phase: phase))
            }
        }
        var glows: [Int: SKTexture] = [:]
        for l in m["lights"] as? [[String: Any]] ?? [] {
            let x = num(l["x"]), y = num(l["y"])
            if l["lit"] as? Bool == true {
                let reach = num(l["reach"])
                let texture = glows[Int(reach)] ?? Textures.glow(reach: reach)
                glows[Int(reach)] = texture
                let glow = SKSpriteNode(texture: texture, size: CGSize(width: reach * 2 + 2, height: reach * 2 + 2))
                glow.color = Textures.color(l["color"] as? Int ?? 0xffffff)
                glow.colorBlendFactor = 1
                glow.blendMode = .add
                glow.position = p(x, y)
                glow.zPosition = 17.4
                agentLayer.addChild(glow)
                flames.append(Flame(node: glow, period: l["period"] as? Double ?? 3200, phase: Double(num(l["phase"])), flicker: l["flicker"] as? Bool ?? false))
            }
            if let name = l["frame"] as? String, let prop = sprite(name, width: num(l["width"])) {
                prop.position = p(x, y)
                prop.zPosition = 17.5
                if l["stale"] as? Bool == true { prop.alpha = 0.6 }
                agentLayer.addChild(prop)
            }
        }
        for r in m["robots"] as? [[String: Any]] ?? [] {
            guard let id = r["id"] as? String, let art = r["art"] as? String else { continue }
            let offline = r["offline"] as? Bool ?? false
            let suffix = offline ? "~offline" : ""
            let home = CGPoint(x: num(r["x"]), y: num(r["y"]))
            let node = SKNode()
            node.position = p(home.x, home.y)
            node.zPosition = 35
            var hands: [SKSpriteNode] = []
            for part in ["body", "hand-l", "hand-r"] {
                guard let s = sprite("\(art)-\(part)\(suffix)", width: robotSize) else { continue }
                if offline { s.alpha = 0.7 }
                node.addChild(s)
                if part != "body" { hands.append(s) }
            }
            agentLayer.addChild(node)
            var robot = Robot(id: id, node: node, hands: hands, home: home, busy: r["busy"] as? Bool ?? false, drones: [])
            let count = r["drones"] as? Int ?? 0
            if count > 0 {
                var rng = Seeded(UInt32(truncatingIfNeeded: r["droneSeed"] as? Int ?? 0))
                let phase = Double(rng.next())
                for i in 0..<count {
                    guard let drone = sprite(art, width: droneSize) else { continue }
                    let shadow = SKSpriteNode(texture: Textures.shadow, size: CGSize(width: 18, height: 18))
                    shadow.zPosition = 34
                    agentLayer.addChild(shadow)
                    agentLayer.addChild(drone)
                    robot.drones.append((drone, shadow, phase + Double(i) / Double(count)))
                }
            }
            robots.append(robot)
            if walkers[id] == nil {
                var rng = Seeded(UInt32(truncatingIfNeeded: r["seed"] as? Int ?? 0))
                let pause = rng.next() * 2000
                let phase = rng.next() * 10
                walkers[id] = Walker(pause: pause, rng: rng, phase: phase)
            }
        }
        let ids = Set(robots.map(\.id))
        walkers = walkers.filter { ids.contains($0.key) }
        animate(step: 0)
        wake()
    }

    // MARK: Building blocks

    private func num(_ v: Any?, _ fallback: CGFloat = 0) -> CGFloat {
        if let d = v as? Double { return CGFloat(d) }
        if let i = v as? Int { return CGFloat(i) }
        if let n = v as? NSNumber { return CGFloat(n.doubleValue) }
        return fallback
    }
    private func box(_ b: [String: Double]) -> WorldBox {
        WorldBox(x: CGFloat(b["x"] ?? 0), y: CGFloat(b["y"] ?? 0), width: CGFloat(b["width"] ?? 0), height: CGFloat(b["height"] ?? 0))
    }
    /// A frame drawn `width` world pixels wide, centred on its position.
    private func sprite(_ name: String, width: CGFloat) -> SKSpriteNode? {
        guard let texture = frames[name], let size = frameSizes[name] else { return nil }
        let node = SKSpriteNode(texture: texture)
        node.size = CGSize(width: width, height: width * size.height / size.width)
        return node
    }
    /// A camp's flag: the daemon reports its agents without a workspace.
    private func campFlag(_ x: CGFloat, _ y: CGFloat) -> SKNode {
        let flag = SKNode()
        flag.zPosition = 16
        let ground = SKShapeNode(ellipseOf: CGSize(width: 18, height: 6))
        ground.position = p(x - 6, y + 7)
        ground.fillColor = Textures.color(0x7b6340, 0.35)
        ground.strokeColor = .clear
        let pole = SKShapeNode()
        let polePath = CGMutablePath()
        polePath.move(to: p(x - 6, y + 6))
        polePath.addLine(to: p(x - 6, y - 30))
        pole.path = polePath
        pole.strokeColor = Textures.color(0x7b6340)
        pole.lineWidth = 2
        let cloth = SKShapeNode()
        let clothPath = CGMutablePath()
        clothPath.addLines(between: [p(x - 5, y - 30), p(x + 18, y - 23), p(x - 5, y - 16)])
        clothPath.closeSubpath()
        cloth.path = clothPath
        cloth.fillColor = Textures.color(0xc75136)
        cloth.strokeColor = .clear
        for n in [ground, pole, cloth] { flag.addChild(n) }
        return flag
    }

    /// The sea's tiles cover whatever the camera can show, plus a tile for drift.
    private func coverSea() {
        guard let water = tiles["water"], let glint = tiles["glints"], let cloud = tiles["clouds"], let view else { return }
        let viewSize = view.bounds.size
        guard viewSize.width > 0 else { return }
        let e = rules.extent(land, view: viewSize)
        let z = rules.minimumZoom(land, view: viewSize)
        let w = max(e.width, viewSize.width / z), h = max(e.height, viewSize.height / z)
        let cover = CGRect(x: e.midX - w / 2, y: e.midY - h / 2, width: w, height: h)
        if cover == seaCover { return }
        seaCover = cover
        for (layer, texture, scale) in [(sea, water, CGFloat(1)), (glints, glint, 1.6), (clouds, cloud, 6)] as [(SKNode, SKTexture, CGFloat)] {
            layer.removeAllChildren()
            let tile = texture.size().width * scale
            let x0 = (floor(cover.minX / tile) - 1) * tile, y0 = (floor(cover.minY / tile) - 1) * tile
            var y = y0
            while y < cover.maxY + tile {
                var x = x0
                while x < cover.maxX + tile {
                    let node = SKSpriteNode(texture: texture, size: CGSize(width: tile + 0.5, height: tile + 0.5))
                    node.anchorPoint = CGPoint(x: 0, y: 1)
                    node.position = p(x, y)
                    layer.addChild(node)
                    x += tile
                }
                y += tile
            }
        }
    }

    // MARK: Selection and hover

    private func strokes(_ cells: [Axial], width: CGFloat, color: NSColor, inset: Bool = true) -> SKShapeNode {
        let outline = Hex.perimeter(cells, width: width, inset: inset)
        let path = CGMutablePath()
        for (a, b) in outline.segments {
            path.move(to: p(a.x, a.y))
            path.addLine(to: p(b.x, b.y))
        }
        let node = SKShapeNode(path: path)
        node.strokeColor = color
        node.lineWidth = width
        node.lineCap = .round
        node.isAntialiased = true
        return node
    }

    /// A golden rim with a breathing halo and a warm wash, so the selection
    /// reads on grass, timber, flagstones and every tile colour.
    private func drawSelection() {
        for node in [selectionNode, selectionWash, selectionHalo] { node.removeAllChildren() }
        guard let id = selected, let e = entities[id] else { return }
        if e.kind != "host" {
            // Cells don't overlap, so one path keeps the wash even across them.
            let path = CGMutablePath()
            for c in e.cells {
                let centre = Hex.point(c)
                for i in 0..<6 {
                    let q = Hex.corner(centre, i, Hex.radius + 0.5)
                    if i == 0 { path.move(to: p(q.x, q.y)) } else { path.addLine(to: p(q.x, q.y)) }
                }
                path.closeSubpath()
            }
            let wash = SKShapeNode(path: path)
            wash.fillColor = Textures.color(0xffe27a)
            wash.strokeColor = .clear
            selectionWash.addChild(wash)
        }
        // The halo: the rim's glow, as widening soft strokes.
        for k in 1...5 {
            let halo = strokes(e.cells, width: 6 + CGFloat(k) * 4, color: Textures.color(0xffc72e, 0.2))
            selectionHalo.addChild(halo)
        }
        selectionNode.addChild(strokes(e.cells, width: 6, color: Textures.color(0xffc72e)))
        breathe()
    }

    private func breathe() {
        let t = reduced ? 0.5 : 0.5 + 0.5 * sin(clock / 1600 * .pi * 2)
        selectionWash.alpha = CGFloat(0.1 + 0.16 * t)
        selectionHalo.alpha = CGFloat(0.5 + 0.5 * t)
    }

    private func drawHover() {
        hoverNode.removeAllChildren()
        guard let id = hovered, let e = entities[id] else { return }
        hoverNode.addChild(strokes(e.cells, width: 4, color: Textures.color(hoverColors[e.kind] ?? 0xffffff, 0.95)))
    }

    private func setHover(_ id: String?, flag: PlantedFlag? = nil) {
        guard id != hovered || flag?.flag != hoveredFlag?.flag || flag?.at.x != hoveredFlag?.at.x else { return }
        let outline = id != hovered
        hovered = id
        hoveredFlag = id == nil ? nil : flag
        if outline { drawHover() }
        reportHover()
        wake()
    }

    /// Where the hover card points: the entity's (or its hovered flag's) top
    /// centre, in the surface's points.
    private func reportHover() {
        var message: [String: Any] = ["type": "hover", "id": hovered as Any? ?? NSNull()]
        if let flag = hoveredFlag { message["flag"] = flag.flag }
        if let id = hovered, let at = hoveredFlag?.at ?? entities[id]?.at, let v = view?.bounds.size {
            message["x"] = (at.x - (center.x - v.width / 2 / zoom)) * zoom
            message["y"] = (at.y - at.height / 2 - (center.y - v.height / 2 / zoom)) * zoom
        }
        let key = "\(hovered ?? "")"
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

    func fit() {
        guard viewSize.width > 0, viewSize.height > 0 else { return }
        let e = rules.extent(land, view: viewSize)
        zoom = rules.minimumZoom(land, view: viewSize)
        center = CGPoint(x: e.midX, y: e.midY)
        animation = nil
        fitted = land != nil
        applyCamera()
        reportZoom()
    }

    private func constrain() {
        let c = rules.clamp(center: center, zoom: zoom, land: land, view: viewSize)
        center = c.center
        zoom = c.zoom
        applyCamera()
    }

    private func applyCamera() {
        cam.position = p(center.x, center.y)
        cam.setScale(1 / zoom)
    }

    private func reportZoom() { emit(["type": "zoom", "zoom": zoom]) }

    /// The visible world box.
    private var worldView: WorldBox {
        let v = viewSize
        return WorldBox(x: center.x - v.width / 2 / zoom, y: center.y - v.height / 2 / zoom, width: v.width / zoom, height: v.height / zoom)
    }

    /// The map's surface was resized: the web Atlas fits again.
    func viewportChanged() {
        seaCover = .zero
        coverSea()
        if land != nil { fit() }
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

    /// Bring an entity into view: pan only when it is not comfortably
    /// visible; `closer` frames it as well.
    func focus(_ id: String, closer: Bool) {
        guard let e = entities[id] else { return }
        let loc = e.at
        let target = CGPoint(x: loc.x, y: loc.y)
        if !closer {
            if CameraRules.comfortablyVisible(loc, in: worldView) { return }
            if reduced { center = target; constrain(); return }
            animation = (center, target, zoom, zoom, nil, 380)
        } else {
            let level = min(max(rules.focusZoom(kind: e.kind, loc: loc, view: viewSize), rules.minimumZoom(land, view: viewSize)), rules.maxZoom)
            if reduced { zoom = level; center = target; constrain(); reportZoom(); return }
            animation = (center, target, zoom, level, nil, 380)
        }
        interacted()
    }

    private func interacted() {
        lastInteraction = CACurrentMediaTime()
        wake()
    }

    // MARK: Input (forwarded from the page's map surface)

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

    /// Hover what is under a surface point: a PR flag's art takes it before
    /// the cell beneath, and outlines its workspace.
    private func hover(at point: CGPoint) {
        if let flag = flagAt(point) { setHover(flag.workspace, flag: flag) } else { setHover(entityAt(point)) }
    }

    /// The PR flag whose art holds a surface point (its cloth and pole, a
    /// little inside the frame's transparent edges), if any.
    private func flagAt(_ point: CGPoint) -> PlantedFlag? {
        let v = worldView
        let x = v.x + point.x / zoom, y = v.y + point.y / zoom
        return plantedFlags.last { f in
            abs(x - f.at.x) <= f.at.width * 0.42 && abs(y - f.at.y) <= f.at.height * 0.46 && entities[f.workspace] != nil
        }
    }

    /// The project, workspace or agent under a surface point, if any.
    private func entityAt(_ point: CGPoint) -> String? {
        let v = worldView
        let x = v.x + point.x / zoom, y = v.y + point.y / zoom
        return owners[Hex.cellAt(x, y)]
    }

    func wheel(at point: CGPoint, dy: CGFloat) { zoom(at: point, by: exp(-dy * 0.001)) }
    func pinch(at point: CGPoint, scale: CGFloat) { zoom(at: point, by: scale) }

    private func zoom(at point: CGPoint, by factor: CGFloat) {
        guard inputEnabled, factor.isFinite, factor > 0 else { return }
        let v = worldView
        let before = CGPoint(x: v.x + point.x / zoom, y: v.y + point.y / zoom)
        let limited = min(max(zoom * factor, rules.minimumZoom(land, view: viewSize)), rules.maxZoom)
        zoom = limited
        let after = CGPoint(x: worldView.x + point.x / zoom, y: worldView.y + point.y / zoom)
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
        animate(step: 0)
        breathe()
        wake()
    }

    // MARK: Frames

    /// Whether anything moves at the ambient rate (tiles, robots, signals, the selection).
    var animating: Bool {
        !reduced && (!pulses.isEmpty || !runners.isEmpty || !flames.isEmpty || !swaying.isEmpty || robots.contains { $0.busy || !$0.drones.isEmpty } || selected != nil)
    }
    /// The sea's glints and cloud shadows drift (slowly, in 15 Hz steps).
    var drifting: Bool { !reduced && !tiles.isEmpty }
    /// The camera is moving or the user is handling the map.
    var lively: Bool {
        animation != nil || down != nil || !keys.isEmpty || CACurrentMediaTime() - lastInteraction < 1.5
    }

    private var frameCount = 0
    private var frameSecond: TimeInterval = 0
    static let debug = ProcessInfo.processInfo.environment["PASEO_NATIVE_DEBUG"] != nil

    /// Frames drawn so far (for measurements).
    private(set) var framesDrawn = 0

    override func update(_ currentTime: TimeInterval) {
        framesDrawn += 1
        if AtlasScene.debug {
            frameCount += 1
            if currentTime - frameSecond >= 1 {
                Log.line("fps \(frameCount) (asked \(view?.preferredFramesPerSecond ?? 0))")
                frameCount = 0
                frameSecond = currentTime
            }
        }
        let delta = lastTime.map { min((currentTime - $0) * 1000, 250) } ?? 0
        lastTime = currentTime
        if !keys.isEmpty {
            // Arrow keys pan at the web Atlas's 0.65 world px per ms.
            let d = CGFloat(delta) * 0.65
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
        if !reduced {
            clock += delta
            driftPending += delta
            if driftPending >= 1000 / 15 {
                drift += CGFloat(driftPending * 0.003)
                driftPending = 0
                driftSea()
            }
        }
        animate(step: CGFloat(min(delta, 100) / 1000))
    }

    private func driftSea() {
        let glintTile = (tiles["glints"]?.size().width ?? 512) * 1.6
        let cloudTile = (tiles["clouds"]?.size().width ?? 512) * 6
        func wrap(_ v: CGFloat, _ m: CGFloat) -> CGFloat { v - floor(v / m) * m }
        glints.position = p(wrap(-drift * 0.6, glintTile), wrap(drift * 0.25, glintTile))
        clouds.position = p(wrap(drift, cloudTile), wrap(drift * 0.4, cloudTile))
    }

    /// One frame of the agents' motion (AtlasScene.ts's update): pulses,
    /// running lights, lamp glows, the selection's breath, robots and drones.
    private func animate(step: CGFloat) {
        for pulse in pulses {
            let a: Double = reduced ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * cos((clock / pulse.period + pulse.phase) * .pi * 2))
            pulse.node.alpha = pulse.base * CGFloat(a)
        }
        for r in runners {
            let t = (reduced ? 0 : clock / r.period) + r.phase
            func at(_ u: Double) -> CGPoint {
                let f = (u.truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1) * 6
                let i = Int(f), a = r.corners[i % 6], b = r.corners[(i + 1) % 6]
                let k = CGFloat(f - Double(i))
                return CGPoint(x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k)
            }
            // Brightest at its head, fading toward its tail.
            for (k, s) in r.segments.enumerated() {
                let a = at(t - Double(k) / 72), b = at(t - Double(k + 1) / 72)
                s.position = p((a.x + b.x) / 2, (a.y + b.y) / 2)
                s.size = CGSize(width: hypot(b.x - a.x, b.y - a.y), height: 7)
                s.zRotation = -atan2(b.y - a.y, b.x - a.x)
            }
        }
        for f in flames {
            if reduced { f.node.alpha = 0.8; continue }
            let t = clock / f.period + f.phase
            let pulse = 0.5 + 0.5 * cos(t * .pi * 2)
            let flicker = f.flicker ? 0.15 * sin(clock / 70 + f.phase * 40) * sin(clock / 113) : 0
            f.node.alpha = CGFloat((f.flicker ? 0.45 + 0.55 * pulse : 0.7 + 0.3 * pulse) + flicker)
        }
        if selected != nil { breathe() }
        // The running CI flag sways; still, with reduced motion.
        let sway = (clock / flagSway.period) * .pi * 2
        for (i, flag) in swaying.enumerated() {
            flag.zRotation = reduced ? 0 : -flagSway.degrees * .pi / 180 * CGFloat(sin(sway + Double(i) * 0.7))
        }
        walk(step)
    }

    /// Working robots potter about their cell: turn to face a spot, walk to
    /// it, pause and look about, then pick another (`walkRobots`).
    private func walk(_ step: CGFloat) {
        for r in robots {
            var position = r.home
            if r.busy && !reduced, var w = walkers[r.id] {
                func wrapAngle(_ a: CGFloat) -> CGFloat { atan2(sin(a), cos(a)) }
                func turn(_ to: CGFloat, _ rate: CGFloat) -> CGFloat {
                    let diff = wrapAngle(to - w.heading)
                    w.heading += min(max(diff, -rate * step), rate * step)
                    return abs(diff)
                }
                if w.pause > 0 {
                    w.pause -= step * 1000
                    _ = turn(w.look, 0.7)
                    if w.pause <= 0 {
                        // Somewhere else in the cell, a fair step away.
                        for _ in 0..<6 {
                            let a = w.rng.next() * .pi * 2, d = 0.45 + 0.55 * sqrt(w.rng.next())
                            w.tx = cos(a) * wander.x * d
                            w.ty = sin(a) * wander.y * d
                            if hypot(w.tx - w.x, w.ty - w.y) > 7 { break }
                        }
                    }
                } else {
                    let dx = w.tx - w.x, dy = w.ty - w.y, dist = hypot(dx, dy)
                    let off = turn(atan2(dy, dx), wander.turn)
                    // Walks once it roughly faces its spot, slowing as it arrives.
                    if off < 0.3 {
                        let move = min(dist, wander.speed * step * min(1, dist / 4 + 0.3))
                        w.x += cos(w.heading) * move
                        w.y += sin(w.heading) * move
                        w.stride += move
                    }
                    if dist < 0.8 {
                        w.pause = 1200 + w.rng.next() * 2400
                        w.look = w.heading + (w.rng.next() - 0.5) * 1.6
                    }
                }
                let walking = w.pause <= 0
                let bob = walking ? abs(sin(w.stride * 0.55)) * 1.8 : 0
                // Arms swing opposite each other in stride; at rest they tinker.
                let swing = walking ? sin(w.stride * 0.55) * 3 : CGFloat(sin(clock / 260 + Double(w.phase))) * 1.6
                for (i, hand) in r.hands.enumerated() {
                    let side: CGFloat = i == 0 ? -1 : 1
                    let reach = walking ? 0 : side * max(0, CGFloat(sin(clock / 410 + Double(w.phase) + Double(i)))) * 1.5
                    hand.position = CGPoint(x: reach, y: -(i == 0 ? -swing : swing))
                }
                position = CGPoint(x: r.home.x + w.x, y: r.home.y + w.y - bob)
                // The visor faces down its sprite (+y), so heading π/2 is no turn.
                r.node.zRotation = -(w.heading - .pi / 2)
                walkers[r.id] = w
            } else {
                r.node.zRotation = 0
                for hand in r.hands { hand.position = .zero }
            }
            r.node.position = p(position.x, position.y)
            for d in r.drones {
                let turn = ((reduced ? 0 : clock / droneOrbit) + d.phase) * .pi * 2
                let dx = CGFloat(cos(turn)) * 40, dy = CGFloat(sin(turn)) * 28
                let lift: CGFloat = 18 + (reduced ? 0 : CGFloat(sin(turn * 3)) * 2)
                d.shadow.position = p(position.x + dx, position.y + dy + 10)
                d.drone.position = p(position.x + dx, position.y + dy + 10 - lift)
                // Behind the robot on the far side of its circle, in front on the near side.
                d.drone.zPosition = dy < 0 ? 34.5 : 35.5
            }
        }
    }

    /// What the scene holds, for checks from the page (`inspect`).
    func state() -> [String: Any] {
        [
            "renderer": "SpriteKit",
            "builds": builds,
            "selected": selected as Any? ?? NSNull(),
            "hovered": hovered as Any? ?? NSNull(),
            "zoom": zoom,
            "minimumZoom": rules.minimumZoom(land, view: viewSize),
            "center": ["x": center.x, "y": center.y],
            "nodes": countNodes(self),
            "tiles": tileStates,
            "robots": robots.count,
            "motion": !reduced,
            "frames": frames.count,
        ]
    }
    private func countNodes(_ node: SKNode) -> Int { node.children.reduce(1) { $0 + countNodes($1) } }
}
