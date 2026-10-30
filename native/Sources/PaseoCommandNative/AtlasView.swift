import AppKit
import SpriteKit

/// The SpriteKit view under the page. It draws only as often as the world
/// needs: at the display's full rate while the map is handled or the camera
/// moves, `ambientRate` while tiles, robots or signals animate, a few frames
/// a second while only the sea drifts, and not at all when nothing moves or
/// the window can't be seen.
final class AtlasView: SKView {
    /// Frames per second for ambient motion (the web Atlas runs 60).
    static var ambientRate = 30
    /// The sea's glints and cloud shadows step at 15 Hz on the web too.
    static let driftRate = 15
    /// Keep drawing when the window is covered (`--ignore-occlusion`, for checks).
    static var ignoreOcclusion = false
    let atlas: AtlasScene
    private var visible = true
    private var settling: DispatchWorkItem?
    /// Until when the view keeps drawing after a resize (see `resized`).
    private var resizedUntil: CFTimeInterval = 0

    init(frame: NSRect, scene: AtlasScene) {
        atlas = scene
        super.init(frame: frame)
        ignoresSiblingOrder = true
        shouldCullNonVisibleNodes = true
        allowsTransparency = false
        preferredFramesPerSecond = AtlasView.ambientRate
        presentScene(scene)
        scene.wake = { [weak self] in self?.govern() }
        // The page keeps the keyboard; the map's keys reach Swift through it.
        setAccessibilityElement(false)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var acceptsFirstResponder: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        NotificationCenter.default.removeObserver(self)
        guard let window else { return }
        NotificationCenter.default.addObserver(self, selector: #selector(occlusionChanged),
                                               name: NSWindow.didChangeOcclusionStateNotification, object: window)
        occlusionChanged()
    }

    @objc private func occlusionChanged() {
        visible = AtlasView.ignoreOcclusion || (window?.occlusionState.contains(.visible) ?? false)
        govern()
    }

    /// The view was given a new size: its drawing surface takes it now (SpriteKit
    /// would only catch up a frame later, stretching that frame to the new shape),
    /// and it keeps drawing a moment, so the last frame shown is never a stretched one.
    func resized() {
        if let metal = layer as? CAMetalLayer {
            let scale = window?.backingScaleFactor ?? metal.contentsScale
            metal.drawableSize = CGSize(width: (frame.width * scale).rounded(), height: (frame.height * scale).rounded())
        }
        resizedUntil = CACurrentMediaTime() + 0.4
    }

    /// The highest rate the world needs right now; nil when it can rest.
    private var neededRate: Int? {
        guard visible, !isHiddenOrHasHiddenAncestor, atlas.hasArt else { return nil }
        if CACurrentMediaTime() < resizedUntil && !atlas.lively { return AtlasView.ambientRate }
        if atlas.lively { return max(60, NSScreen.main?.maximumFramesPerSecond ?? 60) }
        if atlas.animating { return AtlasView.ambientRate }
        if atlas.drifting { return AtlasView.driftRate }
        return nil
    }

    /// Set the frame rate for what is happening, pausing when nothing moves
    /// (after one frame, so the latest change is drawn).
    func govern() {
        settling?.cancel()
        if let rate = neededRate {
            if preferredFramesPerSecond != rate { preferredFramesPerSecond = rate }
            if isPaused { isPaused = false }
            // Full rate lasts only while handled, and drawing after a resize only a
            // moment; check again once either may end.
            let afterResize = resizedUntil - CACurrentMediaTime()
            if afterResize > 0 {
                let work = DispatchWorkItem { [weak self] in self?.govern() }
                settling = work
                DispatchQueue.main.asyncAfter(deadline: .now() + afterResize + 0.02, execute: work)
            } else if atlas.lively {
                let work = DispatchWorkItem { [weak self] in self?.govern() }
                settling = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
            }
        } else if visible && !isHiddenOrHasHiddenAncestor && atlas.hasArt {
            // Draw the change, then rest.
            isPaused = false
            let work = DispatchWorkItem { [weak self] in
                guard let self, self.neededRate == nil else { return }
                self.isPaused = true
            }
            settling = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: work)
        } else {
            isPaused = true
        }
    }
}
