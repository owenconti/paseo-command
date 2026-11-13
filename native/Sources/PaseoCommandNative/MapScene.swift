import SpriteKit

/// A map style's scene, drawn in `AtlasView` under the page: the Atlas (`AtlasScene`), the
/// Dungeon Board (`DungeonScene`). The page lays the map out and paints its art; the scene draws,
/// animates, owns the camera, hover and picking, and reports through `emit`.
protocol MapScene: SKScene {
    /// Which world it draws: "atlas" (the Islands and Overworld styles), or "dungeon" (`scene` in the page's `art` message).
    var kind: String { get }
    /// Events for the page: pick, hover, zoom, ready, state.
    var emit: ([String: Any]) -> Void { get set }
    /// Asked to render again after the view paused itself.
    var wake: () -> Void { get set }
    var hasArt: Bool { get }
    var builds: Int { get }
    var sceneRevision: Int { get }
    var agentsRevision: Int { get }
    var appliedAt: CFTimeInterval { get }
    var framesDrawn: Int { get }
    var lastFrame: CFTimeInterval { get }
    /// The camera is moving or the user is handling the map: full rate.
    var lively: Bool { get }
    /// Something moves at the ambient rate.
    var animating: Bool { get }
    /// Something drifts slowly (the Atlas's sea).
    var drifting: Bool { get }

    func setArt(frames images: [String: CGImage], tiles tileImages: [String: CGImage], constants: [String: Any], reduced: Bool)
    func setScene(_ m: [String: Any], images: [String: CGImage])
    func setAgents(_ m: [String: Any], images: [String: CGImage])
    func pointer(phase: String, at point: CGPoint)
    func wheel(at point: CGPoint, dy: CGFloat)
    func pinch(at point: CGPoint, scale: CGFloat)
    func key(_ key: String, down isDown: Bool)
    func select(_ id: String?)
    func focus(_ id: String, closer: Bool)
    /// The page's dialogue box talks to `id` (an entity), covering the map's bottom `inset` points: frame it above the box;
    /// nil ends the conversation and puts the camera back. Only the Dungeon Board has one.
    func talk(id: String?, inset: CGFloat)
    func command(_ name: String)
    func setInput(_ enabled: Bool)
    func setMotion(reduced value: Bool)
    func viewportChanged()
    func state() -> [String: Any]
}

extension MapScene {
    func talk(id: String?, inset: CGFloat) {}
}

/// The scene for a style's name.
func makeMapScene(kind: String, size: CGSize) -> MapScene {
    switch kind {
    case "dungeon": return DungeonScene(size: size)
    default: return AtlasScene(size: size)
    }
}

/// The map's styles, as the page lists them (`MAP_STYLES` in `web/src/mapStyle.ts`), for View → Map Style.
enum MapStyles {
    static let all: [(id: String, name: String)] = [("islands", "Islands"), ("overworld", "Overworld"), ("dungeon", "Dungeon Board"), ("crew", "Crew")]
}
