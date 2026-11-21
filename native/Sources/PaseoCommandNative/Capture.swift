import AppKit
import AVFoundation
import Carbon.HIToolbox
import ScreenCaptureKit

/// Screen captures for agents (after Kit Langton's Scrawl, MIT): the hotkey (⌃⌥⇧S; ⌃⌥⇧D in the Dev app, so both
/// can run) or the menu bar's icon records the display under the pointer while you draw on it (hold ⇧), then
/// the hotkey again, or Done, makes its bundle (`CaptureBundle`) and drops the send panel (`CaptureSendPanel`) to
/// choose an agent, or a project for a new one. Your voice is recorded with it (`CaptureVoice`: the menu's Record Your
/// Voice, the capsule's mic to mute it) and what you said is transcribed on this Mac into the bundle. The bundle is the data folder's `captures/<id>/`, which the
/// server reads (`web/server/captures.ts`).
final class CaptureController: NSObject, NSMenuDelegate {
    static var hotkeyLabel: String { AppFlavor.isRelease ? "⌃⌥⇧S" : "⌃⌥⇧D" }
    private static var hotkeyCode: Int { AppFlavor.isRelease ? kVK_ANSI_S : kVK_ANSI_D }

    /// The app server's root, for the send panel's page.
    var server: () -> URL = { URL(string: "http://127.0.0.1:\(AppFlavor.port)/")! }
    /// Something for the app's window (`paseo:capture`): it comes forward and the page opens it.
    var toApp: (([String: Any]) -> Void)?
    /// Pages and storage of their own in a check run.
    var persistent = true

    private var hotkey: HotKey?
    private var statusItem: NSStatusItem?
    private var session: Session?
    private var building = false
    private var sendPanel: CaptureSendPanel?

    private struct Session {
        let id: String
        let folder: URL
        let started: Date
        let app: String?
        let screen: NSScreen
        let recorder: CaptureRecorder
        let ink: InkOverlay
        let hud: CaptureHUD
        var clickMonitor: Any?
        /// The microphone is being recorded (and whether it's muted now).
        var voice = false
        var muted = false
        var events: [(kind: CaptureEvent.Kind, host: Double, x: Double, y: Double)] = []
    }

    static var folder: URL { AppFlavor.dataFolder.appendingPathComponent("captures", isDirectory: true) }

    /// The hotkey and the menu bar's icon (not in a check run: they'd answer the user's own keys).
    func install() {
        hotkey = HotKey(keyCode: Self.hotkeyCode, modifiers: controlKey | optionKey | shiftKey) { [weak self] in self?.toggle() }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "pencil.and.scribble", accessibilityDescription: "Screen capture")
            ?? NSImage(systemSymbolName: "pencil.tip", accessibilityDescription: "Screen capture")
        item.button?.toolTip = "\(AppFlavor.name): capture your screen for an agent (\(Self.hotkeyLabel))"
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    var recording: Bool { session != nil }

    /// For check runs' `--info`: whether it records, and the send panel's capture, frame and size.
    func state() -> [String: Any] {
        var state: [String: Any] = ["recording": session != nil, "hotkey": hotkey != nil, "voiceWanted": CaptureVoice.wanted,
                                    "voice": session?.voice ?? false, "muted": session?.muted ?? false]
        if let sendPanel {
            let f = sendPanel.panel.frame
            state["panel"] = ["id": sendPanel.id, "visible": sendPanel.panel.isVisible, "key": sendPanel.panel.isKeyWindow,
                              "width": f.width, "height": f.height]
        }
        return state
    }

    // MARK: The menu bar's menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        func add(_ title: String, _ action: Selector?, enabled: Bool = true) {
            menu.addItem(withTitle: title, action: enabled ? action : nil, keyEquivalent: "").target = self
        }
        if let session {
            add("Finish Capture (\(Self.hotkeyLabel))", #selector(finishFromMenu))
            add(session.ink.strokes > 0 ? "Clear Ink" : "Hold ⇧ and Drag to Draw", session.ink.strokes > 0 ? #selector(clearInk) : nil, enabled: session.ink.strokes > 0)
            if session.voice { add(session.muted ? "Unmute the Microphone" : "Mute the Microphone", #selector(toggleMute)) }
            add("Cancel Capture", #selector(cancelFromMenu))
        } else {
            add(building ? "Saving the Capture…" : "Start Screen Capture (\(Self.hotkeyLabel))", #selector(startFromMenu), enabled: !building)
            add("Send the Last Capture…", #selector(sendLast), enabled: Self.latest() != nil && !building)
        }
        if CaptureVoice.recordable {
            menu.addItem(.separator())
            let voice = NSMenuItem(title: "Record Your Voice", action: #selector(toggleVoice), keyEquivalent: "")
            voice.target = self
            voice.state = CaptureVoice.wanted ? .on : .off
            voice.toolTip = "Record the microphone with your captures; what you say goes to the agent as text (heard on this Mac)"
            menu.addItem(voice)
            // Which microphone: the system's default input (as it is when a capture starts), or one pinned.
            let mics = NSMenuItem(title: "Microphone", action: nil, keyEquivalent: "")
            let list = NSMenu()
            let chosen = CaptureVoice.chosenMicrophone
            let devices = CaptureMicrophone.devices()
            let pinned = devices.contains { $0.id == chosen }
            let fallback = AVCaptureDevice.default(for: .audio)?.localizedName
            let system = NSMenuItem(title: "System Default" + (fallback.map { " (\($0))" } ?? ""), action: #selector(chooseMicrophone(_:)), keyEquivalent: "")
            system.target = self
            system.state = pinned ? .off : .on
            list.addItem(system)
            list.addItem(.separator())
            for d in devices {
                let item = NSMenuItem(title: d.name, action: #selector(chooseMicrophone(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = d.id
                item.state = d.id == chosen ? .on : .off
                list.addItem(item)
            }
            mics.submenu = list
            mics.isEnabled = CaptureVoice.wanted
            menu.addItem(mics)
        }
        menu.addItem(.separator())
        add("Show Captures in Finder", #selector(revealFolder))
        add("Show \(AppFlavor.name)", #selector(showApp))
    }

    @objc private func startFromMenu() { start() }
    @objc private func finishFromMenu() { finish() }
    @objc private func cancelFromMenu() { cancel() }
    @objc private func toggleVoice() { CaptureVoice.wanted.toggle() }
    /// The Microphone menu: a device pinned (its unique id), or the system's default (none).
    @objc private func chooseMicrophone(_ item: NSMenuItem) {
        CaptureVoice.chosenMicrophone = item.representedObject as? String
        Log.line("capture: microphone \(item.representedObject as? String ?? "system default")")
    }
    @objc private func toggleMute() { mic() }

    /// The capsule's mic: mutes or unmutes this capture's voice; off, does what turns it on.
    private func mic() {
        guard let s = session else { return }
        if s.voice {
            let muted = !s.muted
            session?.muted = muted
            s.recorder.muted = muted
            s.hud.mic.state(muted ? .muted : .on)
            return
        }
        switch micOff() {
        case .settings:
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") { NSWorkspace.shared.open(url) }
        case .preference:
            CaptureVoice.wanted = true
            s.hud.mic.state(.off("Your voice is recorded from the next capture"))
        case .none: break
        }
    }

    private enum MicFix { case settings, preference, none }
    /// Why this capture has no voice, and what a click on the mic does about it.
    private func micOff() -> MicFix {
        if !CaptureVoice.recordable { return .none }
        if !CaptureVoice.wanted { return .preference }
        return CaptureVoice.permission == .denied ? .settings : .none
    }

    private func micOffReason() -> String {
        if !CaptureVoice.recordable { return "Recording your voice needs macOS 15" }
        if !CaptureVoice.wanted { return "Your voice isn't recorded: click to record it from the next capture" }
        if CaptureVoice.permission == .denied { return "\(AppFlavor.name) may not use the microphone: click to allow it in System Settings" }
        return "Your voice isn't recorded"
    }
    @objc private func clearInk() {
        session?.ink.clear()
        session?.hud.canClear(false)
    }
    @objc func sendLast() {
        guard let id = Self.latest() else { return notice("No captures yet", "Press \(Self.hotkeyLabel) to record one.") }
        openPanel(id)
    }
    @objc private func revealFolder() {
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([Self.latest().map { Self.folder.appendingPathComponent($0) } ?? Self.folder])
    }
    @objc private func showApp() { toApp?([:]) }

    /// The newest bundle's id.
    static func latest() -> String? {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return names.filter { $0.hasPrefix("cap-") && FileManager.default.fileExists(atPath: folder.appendingPathComponent("\($0)/capture.json").path) }
            .sorted().last
    }

    // MARK: Recording

    /// The hotkey: starts, or finishes the capture under way.
    func toggle() {
        if session != nil { finish() } else if !building { start() }
    }

    func start() {
        guard session == nil, !building else { return }
        guard CGPreflightScreenCaptureAccess() else { return askPermission() }
        sendPanel?.close()
        let mouse = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main,
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else { return }
        let started = Date()
        let id = CaptureBundle.newID(at: started, in: Self.folder)
        let folder = Self.folder.appendingPathComponent(id, isDirectory: true)
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) } catch {
            return notice("Couldn't start the capture", error.localizedDescription)
        }
        let front = NSWorkspace.shared.frontmostApplication
        let app = front?.bundleIdentifier == Bundle.main.bundleIdentifier ? AppFlavor.name : front?.localizedName
        let recorder = CaptureRecorder(url: folder.appendingPathComponent("recording.mp4"))
        let ink = InkOverlay(screen: screen)
        let hud = CaptureHUD(screen: screen, hotkey: Self.hotkeyLabel)
        hud.onDone = { [weak self] in self?.finish() }
        hud.onCancel = { [weak self] in self?.cancel() }
        hud.onMic = { [weak self] in self?.mic() }
        hud.onClear = { [weak self, weak hud] in
            self?.session?.ink.clear()
            hud?.canClear(false)
        }
        ink.onStroke = { [weak self, weak hud] host in
            self?.session?.events.append((.stroke, host, 0, 0))
            hud?.canClear(true)
        }
        recorder.onFailure = { [weak self] why in self?.failed(why) }
        recorder.onLevel = { [weak hud] level in hud?.level(level) }
        session = Session(id: id, folder: folder, started: started, app: app, screen: screen, recorder: recorder, ink: ink, hud: hud)
        ink.show()
        hud.show()
        hud.say("Starting…")
        statusItem?.button?.contentTintColor = .systemRed
        Log.line("capture \(id): starting on display \(displayID)")
        Task { @MainActor in
            do {
                // Your voice, when wanted and allowed (macOS asks the first time, while the capsule says Starting…).
                let voice = CaptureVoice.recordable && CaptureVoice.wanted ? await CaptureVoice.ask() : false
                guard self.session?.id == id else { return }
                if voice { CaptureVoice.prepare() }
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == displayID }) else { throw CaptureError("That display isn't available to record") }
                // The controls stay out of the recording; the ink is in it.
                let hudWindow = content.windows.filter { $0.windowID == CGWindowID(hud.panel.windowNumber) }
                try await recorder.start(display: display, scale: screen.backingScaleFactor, excluding: hudWindow, voice: voice)
                guard self.session?.id == id else { return await recorder.cancel() }
                self.session?.voice = recorder.recordsVoice
                hud.mic.state(recorder.recordsVoice ? .on : .off(voice ? "Your microphone couldn't be recorded" : self.micOffReason()))
                if let name = recorder.microphoneName { hud.mic.toolTip = "Recording your voice from \(name): click to mute" }
                hud.say("Hold ⇧ and drag to draw")
                self.session?.clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { _ in
                    // Removed with the session (`teardown`), so it holds the controller only meanwhile.
                    guard let s = self.session, !s.ink.isDrawing else { return }
                    let p = NSEvent.mouseLocation, f = s.screen.frame
                    guard NSMouseInRect(p, f, false) else { return }
                    self.session?.events.append((.click, CACurrentMediaTime(), (p.x - f.minX) / f.width, 1 - (p.y - f.minY) / f.height))
                }
            } catch {
                Log.line("capture \(id): couldn't start: \(error.localizedDescription)")
                self.teardown()
                try? FileManager.default.removeItem(at: folder)
                // macOS refused though the setting may show on: its grant was for another build of the app.
                if (error as NSError).domain == SCStreamErrorDomain, (error as NSError).code == SCStreamError.Code.userDeclined.rawValue {
                    return self.permissionHelp(stale: true)
                }
                self.notice("Couldn't record the screen", error.localizedDescription)
            }
        }
    }

    private func teardown() {
        guard let s = session else { return }
        if let monitor = s.clickMonitor { NSEvent.removeMonitor(monitor) }
        s.ink.close()
        s.hud.close()
        session = nil
        statusItem?.button?.contentTintColor = nil
    }

    func cancel() {
        guard let s = session else { return }
        teardown()
        Log.line("capture \(s.id): cancelled")
        Task {
            await s.recorder.cancel()
            try? FileManager.default.removeItem(at: s.folder)
        }
    }

    private func failed(_ why: String) {
        guard let s = session else { return }
        teardown()
        Task { await s.recorder.cancel(); try? FileManager.default.removeItem(at: s.folder) }
        notice("The screen recording stopped", why)
    }

    func finish() {
        guard let s = session else { return }
        s.hud.say("Saving…")
        if let monitor = s.clickMonitor { NSEvent.removeMonitor(monitor) }
        session?.clickMonitor = nil
        building = true
        Task { @MainActor in
            let duration = await s.recorder.stop()
            s.ink.close()
            defer { self.building = false }
            guard let duration, let first = s.recorder.firstFrame else {
                self.teardown()
                try? FileManager.default.removeItem(at: s.folder)
                return self.notice("Nothing was recorded", "The screen didn't send any frames.")
            }
            var events = s.events.map { CaptureEvent(kind: $0.kind, t: max(0, $0.host - first), x: $0.x, y: $0.y) }.filter { $0.t <= duration }
            // What you said: its sentences for the agent, and a keyframe for each.
            let voiced = s.recorder.voiced
            var speech: [CaptureSpeech] = [], note: String?
            if voiced {
                s.hud.say("Hearing what you said…")
                s.hud.mic.state(.muted)
                do {
                    let words = try await CaptureVoice.words(in: s.recorder.url)
                    speech = CaptureTranscript.sentences(words)
                    events += CaptureTranscript.moments(words).filter { $0 <= duration }.map { CaptureEvent(kind: .said, t: $0) }
                    if speech.isEmpty { note = s.recorder.quiet(duration: duration) ?? "Nothing was said" }
                } catch {
                    note = s.recorder.quiet(duration: duration) ?? error.localizedDescription
                    Log.line("capture \(s.id): no transcript: \(error.localizedDescription)")
                }
            } else if s.recorder.recordsVoice {
                // Recorded, but nothing reached the file: why (silent, gone), unless you muted it throughout.
                note = s.recorder.quiet(duration: duration)
            }
            if let mic = s.recorder.microphoneSummary { Log.line("capture \(s.id): microphone \(mic)") }
            self.teardown()
            var bundle = CaptureBundle(folder: s.folder, id: s.id, created: s.started, duration: duration, app: s.app,
                                       size: s.recorder.size, events: events)
            bundle.voice = voiced
            bundle.speech = speech
            bundle.transcriptNote = note
            do {
                let frames = try await bundle.build()
                Log.line("capture \(s.id): \(String(format: "%.1f", duration)) s, \(frames.count) keyframes, \(events.count) marks, clicks and sayings, \(speech.count) sentences")
            } catch {
                Log.line("capture \(s.id): couldn't make its frames: \(error.localizedDescription)")
                return self.notice("Couldn't save the capture", error.localizedDescription)
            }
            self.openPanel(s.id)
            // The GIF after: the panel needn't wait for it.
            Task.detached(priority: .utility) { _ = await bundle.writeGIF() }
        }
    }

    // MARK: Sending

    func openPanel(_ id: String) {
        sendPanel?.close()
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main ?? NSScreen.screens[0]
        let panel = CaptureSendPanel(id: id, server: server(), screen: screen, persistent: persistent)
        panel.onClose = { [weak self, weak panel] in if self?.sendPanel === panel { self?.sendPanel = nil } }
        panel.onApp = { [weak self] body in
            var message = body
            message["capture"] = id
            message.removeValue(forKey: "type")
            self?.toApp?(message)
        }
        panel.onReveal = { NSWorkspace.shared.activateFileViewerSelecting([Self.folder.appendingPathComponent(id)]) }
        sendPanel = panel
        panel.show(key: persistent)
    }

    // MARK: Permission and notices

    private func askPermission() {
        // Every time: macOS prompts by itself when it hasn't been asked (the first time, or after the app's entry was
        // reset or removed) and lists the app in System Settings; otherwise it answers at once. (Asking only once left an
        // app whose entry had gone, or no longer matched its signature, unable to be asked again.)
        if CGRequestScreenCaptureAccess() { return start() }
        permissionHelp(stale: false)
    }

    /// Where to allow recording. `stale`: macOS refused though the app may be listed as allowed (an entry for an
    /// earlier build of it, signed otherwise). Reset and Ask Again clears this app's entry only (`tccutil reset
    /// ScreenCapture <its bundle id>`) and asks macOS again, which prompts.
    private func permissionHelp(stale: Bool) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = stale ? "macOS didn't let \(AppFlavor.name) record the screen" : "\(AppFlavor.name) needs to record your screen"
        let settings = "System Settings → Privacy & Security → Screen & System Audio Recording"
        alert.informativeText = (stale
            ? "Its permission may be for an earlier build of the app. "
            : "Turn on \(AppFlavor.name) in \(settings), then press \(Self.hotkeyLabel) again. ")
            + "If it's already on there, or isn't listed, choose Reset and Ask Again: macOS forgets this app's entry and asks you again. After allowing it, quit and reopen the app if macOS asks."
        alert.addButton(withTitle: "Reset and Ask Again")
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Not Now")
        switch alert.runModal() {
        case .alertFirstButtonReturn: resetPermission()
        case .alertSecondButtonReturn:
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") { NSWorkspace.shared.open(url) }
        default: break
        }
    }

    /// Forgets this app's Screen Recording entry (only its own: `tccutil` needs no administrator for that) and asks again.
    private func resetPermission() {
        guard let id = Bundle.main.bundleIdentifier else { return }
        let reset = Process()
        reset.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
        reset.arguments = ["reset", "ScreenCapture", id]
        do {
            try reset.run()
            reset.waitUntilExit()
            Log.line("capture: reset the Screen Recording permission for \(id) (exit \(reset.terminationStatus))")
        } catch {
            Log.line("capture: couldn't reset the Screen Recording permission: \(error.localizedDescription)")
        }
        // macOS's own prompt, now that it's undecided again.
        if CGRequestScreenCaptureAccess() { start() }
    }

    private func notice(_ title: String, _ text: String) {
        Log.line("capture: \(title): \(text)")
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
