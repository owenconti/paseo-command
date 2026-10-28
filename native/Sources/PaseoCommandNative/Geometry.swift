import CoreGraphics
import Foundation

/// The Atlas's axial hex grid, world boxes and camera limits: ports of
/// `rendering/src/world.ts`, `outline.ts`, `pick.ts` and `camera.ts`. World
/// coordinates are the web Atlas's (y grows downward); the scene flips them.
struct Axial: Hashable {
    var q: Int
    var r: Int
}

/// A world rectangle from its top-left corner. (The bridge's entity
/// locations are centred on their x, y instead; see `AtlasScene.Entity.at`.)
struct WorldBox {
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat
    var height: CGFloat
    var midX: CGFloat { x + width / 2 }
    var midY: CGFloat { y + height / 2 }
}

enum Hex {
    /// `HEX_RADIUS`; the bridge sends the web value with the art.
    static var radius: CGFloat = 68

    /// A cell's centre (`point` in world.ts).
    static func point(_ a: Axial) -> CGPoint {
        CGPoint(x: radius * sqrt(3) * (CGFloat(a.q) + CGFloat(a.r) / 2), y: radius * 1.5 * CGFloat(a.r))
    }

    /// Corner `i` of a hexagon of radius `r` round `c`, pointy-top, from the top clockwise (y down).
    static func corner(_ c: CGPoint, _ i: Int, _ r: CGFloat) -> CGPoint {
        let angle = Double(i) * .pi / 3 - .pi / 2
        return CGPoint(x: c.x + CGFloat(cos(angle)) * r, y: c.y + CGFloat(sin(angle)) * r)
    }

    /// The cell under a world point (`cellAt`, cube-rounded).
    static func cellAt(_ x: CGFloat, _ y: CGFloat) -> Axial {
        let r = Double(y / (radius * 1.5))
        let q = Double(x / (radius * sqrt(3))) - r / 2
        let s = -q - r
        var rq = q.rounded(), rr = r.rounded()
        let rs = s.rounded()
        let dq = abs(rq - q), dr = abs(rr - r), ds = abs(rs - s)
        if dq > dr && dq > ds { rq = -rr - rs } else if dr > ds { rr = -rq - rs }
        return Axial(q: Int(rq), r: Int(rr))
    }

    /// The outer perimeter of some cells (`perimeter` in outline.ts): its
    /// sides, inset so a stroke `width` wide stays inside them, the bridges
    /// across steps where two cells meet, and the sides' ends (round caps).
    static func perimeter(_ cells: [Axial], width: CGFloat, inset: Bool = true) -> (segments: [(CGPoint, CGPoint)], caps: [CGPoint]) {
        func key(_ p: CGPoint) -> String { "\(Int((p.x * 10).rounded())),\(Int((p.y * 10).rounded()))" }
        let shrink = inset ? width / 2 / CGFloat(cos(Double.pi / 6)) : 0
        var order: [String] = []
        var sides: [String: (a: CGPoint, b: CGPoint, ia: CGPoint, ib: CGPoint)] = [:]
        for cell in cells {
            let c = point(cell)
            for i in 0..<6 {
                let a = corner(c, i, radius), b = corner(c, i + 1, radius)
                let ka = key(a), kb = key(b)
                let id = ka < kb ? "\(ka):\(kb)" : "\(kb):\(ka)"
                if sides[id] != nil {
                    sides[id] = nil
                } else {
                    sides[id] = (a, b, corner(c, i, radius - shrink), corner(c, i + 1, radius - shrink))
                    order.append(id)
                }
            }
        }
        var segments: [(CGPoint, CGPoint)] = []
        var ends: [String: [CGPoint]] = [:]
        var endOrder: [String] = []
        for id in order {
            guard let side = sides[id] else { continue }
            segments.append((side.ia, side.ib))
            for (p, q) in [(side.a, side.ia), (side.b, side.ib)] {
                let k = key(p)
                if ends[k] == nil { endOrder.append(k) }
                ends[k, default: []].append(q)
            }
        }
        var caps: [CGPoint] = []
        for k in endOrder {
            let list = ends[k]!
            caps.append(contentsOf: list)
            if list.count == 2 && key(list[0]) != key(list[1]) { segments.append((list[0], list[1])) }
        }
        return (segments, caps)
    }
}

/// The camera's limits (camera.ts), in points per world pixel: the web
/// Atlas's zoom divided by its render density.
struct CameraRules {
    var maxZoom: CGFloat = 2.4
    var overlayTop: CGFloat = 76
    var overlayBottom: CGFloat = 72

    /// The world box the camera may show (`mapExtent`).
    func extent(_ land: WorldBox?, view: CGSize) -> WorldBox {
        let bounds = land ?? WorldBox(x: -400, y: -300, width: 800, height: 600)
        let r = Hex.radius
        let marginX = r * 1.6, top = r * 1.6, bottom = r * 0.9
        let zoom = max(0.01, min(view.width / (bounds.width + marginX * 2),
                                 (view.height - overlayTop - overlayBottom) / (bounds.height + top + bottom)))
        return WorldBox(x: bounds.x - marginX,
                        y: bounds.y - top - overlayTop / zoom,
                        width: bounds.width + marginX * 2,
                        height: bounds.height + top + bottom + (overlayTop + overlayBottom) / zoom)
    }

    /// The furthest out the camera goes: the whole extent just fits.
    func minimumZoom(_ land: WorldBox?, view: CGSize) -> CGFloat {
        let e = extent(land, view: view)
        return min(view.width / e.width, view.height / e.height)
    }

    /// Zoom within its limits and the view within the extent (`clampCamera`).
    func clamp(center: CGPoint, zoom: CGFloat, land: WorldBox?, view: CGSize) -> (center: CGPoint, zoom: CGFloat) {
        let e = extent(land, view: view)
        let z = min(max(zoom, minimumZoom(land, view: view)), maxZoom)
        let w = view.width / z, h = view.height / z
        let x = w >= e.width ? e.midX : min(max(center.x, e.x + w / 2), e.x + e.width - w / 2)
        let y = h >= e.height ? e.midY : min(max(center.y, e.y + h / 2), e.y + e.height - h / 2)
        return (CGPoint(x: x, y: y), z)
    }

    /// The zoom that frames an entity at `loc` (`focusZoom`), not yet limited.
    func focusZoom(kind: String, loc: WorldBox, view: CGSize) -> CGFloat {
        if kind == "host" { return min((view.width - 90) / loc.width, (view.height - 80) / loc.height) }
        if kind == "project" { return min(1.5, view.height / 650) }
        return 1.5
    }

    /// Whether `loc`'s centre (its x, y) sits well inside the visible world box.
    static func comfortablyVisible(_ loc: WorldBox, in view: WorldBox) -> Bool {
        let mx = view.width * 0.12, my = view.height * 0.12
        return loc.x > view.x + mx && loc.x < view.x + view.width - mx && loc.y > view.y + my && loc.y < view.y + view.height - my
    }
}

/// The web Atlas's seeded generator (`random` in world.ts), so robots wander
/// as they do there.
struct Seeded {
    var value: UInt32
    init(_ seed: UInt32) { value = seed }
    mutating func next() -> CGFloat {
        value = value &* 1664525 &+ 1013904223
        return CGFloat(Double(value) / 4294967296)
    }
}
