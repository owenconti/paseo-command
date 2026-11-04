import AppKit
import CoreVideo
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
        // Waking, the screens waking and the session coming back: look again whether the window shows.
        let workspace = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            workspace.addObserver(self, selector: #selector(occlusionChanged), name: name, object: nil)
        }
        // A display plugged in, unplugged or reconfigured: SpriteKit's display link was made for the
        // displays there were, and may stop for good (nothing else restarts it), so it is restarted.
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let timer = Timer(timeInterval: AtlasView.watchEvery, repeats: true) { [weak self] _ in self?.watch() }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        watchdog = timer
    }
    deinit { retire() }

    /// Stop watching and drawing, for a view replaced by a fresh one (`onRebuild`).
    func retire() {
        watchdog?.invalidate()
        watchdog = nil
        NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        settling?.cancel()
        isPaused = true
        if scene === atlas { presentScene(nil) }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var acceptsFirstResponder: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        for name in [NSWindow.didChangeOcclusionStateNotification, NSWindow.didChangeScreenNotification] {
            NotificationCenter.default.removeObserver(self, name: name, object: nil)
        }
        guard let window, watchdog != nil else { return }
        NotificationCenter.default.addObserver(self, selector: #selector(occlusionChanged),
                                               name: NSWindow.didChangeOcclusionStateNotification, object: window)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSWindow.didChangeScreenNotification, object: window)
        occlusionChanged()
    }

    /// The displays changed, or the window moved to another: say so in the log (a stall that follows
    /// one is then plain), and once things settle restart SpriteKit's display link if the map draws.
    @objc private func screensChanged(_ note: Notification) {
        let screens = NSScreen.screens.map { "\($0.localizedName) \($0.maximumFramesPerSecond) Hz" }.joined(separator: ", ")
        Log.line("map: \(note.name == NSWindow.didChangeScreenNotification ? "the window moved to another display" : "the displays changed") (\(screens))")
        restartLink?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if !self.isPaused {
                self.isPaused = true
                self.isPaused = false
                self.unpausedAt = CACurrentMediaTime()
            }
            self.occlusionChanged()
        }
        restartLink = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }
    private var restartLink: DispatchWorkItem?

    /// Whether the window shows, as it says now.
    private var windowShows: Bool { AtlasView.ignoreOcclusion || (window?.occlusionState.contains(.visible) ?? false) }

    @objc private func occlusionChanged() {
        visible = windowShows
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
    /// Under Conquer, in the map's place: nothing to draw.
    var covered = false { didSet { govern() } }

    private var neededRate: Int? {
        guard visible, !covered, !isHiddenOrHasHiddenAncestor, atlas.hasArt else { return nil }
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
            if isPaused { isPaused = false; unpausedAt = CACurrentMediaTime() }
            // SpriteKit pauses the scene with the view; a scene left paused draws but never moves.
            if atlas.isPaused { atlas.isPaused = false }
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
        } else if visible && !covered && !isHiddenOrHasHiddenAncestor && atlas.hasArt {
            // Draw the change, then rest.
            if isPaused { isPaused = false; unpausedAt = CACurrentMediaTime() }
            if atlas.isPaused { atlas.isPaused = false }
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

    // MARK: Watchdog

    /// How often the watchdog looks, and how long the map may go without a frame while it should draw.
    static let watchEvery: TimeInterval = 2
    static let stallAfter: CFTimeInterval = 3
    private var watchdog: Timer?
    /// When the view last went from paused to drawing (a frame is due soon after).
    private var unpausedAt: CFTimeInterval = 0
    /// Stalls found and recovered from, and how many in a row.
    private(set) var recoveries = 0
    private(set) var lastRecovery = ""
    private var stallsInRow = 0
    /// Frames drawn when it last recovered: until more are, a recovery hasn't worked.
    private var framesAtRecovery = 0
    /// Told after a recovery, so the page can post its world again (`stalled`).
    var onRecover: (String) -> Void = { _ in }
    /// Asked to replace this view with a fresh one showing the same scene, when restarting its
    /// loop didn't bring frames back: SpriteKit's display link can wedge where only a new view mends it.
    var onRebuild: (AtlasView) -> Void = { _ in }

    /// Whether the map should be drawing now and isn't: the visibility it keeps out of step with the
    /// window's, the view or its scene paused while it's needed, or no frame for `stallAfter`. Seen on
    /// two looks in a row (so a notification on its way isn't one), it restarts the loop and says so in the log.
    func watch(now: CFTimeInterval = CACurrentMediaTime()) {
        // A retired view (replaced by a fresh one) watches no more.
        guard watchdog != nil else { return }
        let symptom = stall(now: now)
        defer { suspect = symptom }
        guard let symptom else {
            if atlas.framesDrawn > framesAtRecovery { stallsInRow = 0 }
            return
        }
        if suspect != nil { recover(symptom) }
    }
    private var suspect: String?

    /// What is wrong with the map's drawing now, if anything.
    func stall(now: CFTimeInterval = CACurrentMediaTime()) -> String? {
        if windowShows != visible { return "it took the window as \(visible ? "showing" : "hidden"), but it is \(windowShows ? "showing" : "hidden")" }
        guard neededRate != nil else { return nil }
        if isPaused { return "the view was paused while the map should draw" }
        if atlas.isPaused { return "the scene was paused under a running view" }
        let quiet = now - max(atlas.lastFrame, unpausedAt)
        return quiet > AtlasView.stallAfter ? String(format: "no frame for %.1f s", quiet) : nil
    }

    /// Restart the loop: take the window's word on whether it shows, unpause the scene, and pause and
    /// unpause the view, which restarts SpriteKit's display link. A second stall with no frame drawn
    /// between asks for a fresh view (`onRebuild`).
    private func recover(_ why: String) {
        recoveries += 1
        stallsInRow += 1
        lastRecovery = why
        let rebuild = stallsInRow >= 2 && neededRate != nil
        Log.line("map stalled: \(why); \(rebuild ? "replacing its view" : "restarting its loop") (\(AtlasView.describe(diagnostics)))")
        framesAtRecovery = atlas.framesDrawn
        visible = windowShows
        atlas.isPaused = false
        if let rate = neededRate {
            isPaused = true
            isPaused = false
            preferredFramesPerSecond = rate
            unpausedAt = CACurrentMediaTime()
        }
        govern()
        onRecover(why)
        if rebuild { onRebuild(self) }
    }

    /// A fresh view for the same scene, taking this one's place, size and state.
    func successor() -> AtlasView {
        let next = AtlasView(frame: frame, scene: atlas)
        next.autoresizingMask = autoresizingMask
        next.isHidden = isHidden
        next.covered = covered
        next.resizedUntil = resizedUntil
        next.recoveries = recoveries
        next.lastRecovery = lastRecovery
        next.framesAtRecovery = atlas.framesDrawn
        next.onRecover = onRecover
        next.onRebuild = onRebuild
        return next
    }

    /// Checks: wedge SpriteKit's display link as a display change or a lost frame can, through its
    /// private state (`link`: the callback left "in progress", so every frame is skipped; `cv`: its
    /// CVDisplayLink stopped). Only the check hooks call this.
    func wedgeDisplayLink(_ how: String) {
        guard let ivar = class_getInstanceVariable(SKView.self, "_displayLink"), let link = object_getIvar(self, ivar) as AnyObject?,
              let flag = class_getInstanceVariable(type(of: link), how == "cv" ? "_cvDisplayLink" : "_callbackAlreadyInProgress") else {
            return Log.line("checks: no display link to wedge")
        }
        let field = Unmanaged.passUnretained(link).toOpaque().advanced(by: ivar_getOffset(flag))
        if how == "cv" {
            if let cv = field.load(as: CVDisplayLink?.self) { CVDisplayLinkStop(cv) }
        } else {
            field.storeBytes(of: UInt8(1), as: UInt8.self)
        }
    }

    /// Checks: the view takes its window for hidden without being told, as a missed notification would leave it.
    func missOcclusion() {
        visible = false
        govern()
    }

    /// What the view reckons, for `--info` and the log.
    var diagnostics: [String: Any] {
        let now = CACurrentMediaTime()
        return [
            "paused": isPaused, "scenePaused": atlas.isPaused, "fps": preferredFramesPerSecond,
            "visible": visible, "windowShows": windowShows, "covered": covered, "hidden": isHiddenOrHasHiddenAncestor,
            "hasArt": atlas.hasArt, "needed": neededRate ?? 0, "framesDrawn": atlas.framesDrawn,
            "sinceFrame": atlas.lastFrame > 0 ? (now - atlas.lastFrame).rounded(toPlaces: 2) : -1,
            "sceneRevision": atlas.sceneRevision, "agentsRevision": atlas.agentsRevision,
            "sinceApplied": atlas.appliedAt > 0 ? (now - atlas.appliedAt).rounded(toPlaces: 2) : -1,
            "recoveries": recoveries, "lastRecovery": lastRecovery,
        ]
    }

    static func describe(_ d: [String: Any]) -> String {
        d.keys.sorted().map { "\($0) \(d[$0]!)" }.joined(separator: ", ")
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let f = pow(10, Double(places))
        return (self * f).rounded() / f
    }
}
