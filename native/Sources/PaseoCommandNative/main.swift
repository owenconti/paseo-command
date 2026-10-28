import AppKit
import Foundation
import notify

/// How the app was launched:
///   --url <url>        the Paseo Command app to show (default http://127.0.0.1:4310/,
///                      or PASEO_COMMAND_URL)
///   --ambient <fps>    the ambient frame rate (default 30)
///   --size <w>x<h>     the window's size in points
///   --front            show the window in front without activating the app
///   --background       run as an accessory that never activates (checks, measurements)
///   --ignore-occlusion keep drawing while the window is covered (for checks)
///   --checks           keep the scene's state current in the page (for checks)
///   --info <path>      write the window number and process ids there as JSON
///                      (and snapshots, on request, beside it as PNG)
struct Options {
    var url = URL(string: ProcessInfo.processInfo.environment["PASEO_COMMAND_URL"] ?? "http://127.0.0.1:4310/")!
    var size: CGSize?
    var front = false
    /// An accessory app (no Dock icon) that never becomes active, so it can't
    /// take focus: for checks and measurements while someone is working.
    var background = false
    var info: String?
    /// Keep the scene's state current in the page (`--checks`).
    var checks = false

    init(_ args: [String]) {
        var i = 1
        func next() -> String? { i += 1; return i < args.count ? args[i] : nil }
        while i < args.count {
            switch args[i] {
            case "--url": if let v = next(), let u = URL(string: v) { url = u }
            case "--ambient": if let v = next(), let n = Int(v) { AtlasView.ambientRate = n }
            case "--size":
                if let v = next() {
                    let parts = v.split(separator: "x").compactMap { Double($0) }
                    if parts.count == 2 { size = CGSize(width: parts[0], height: parts[1]) }
                }
            case "--front": front = true
            case "--background": background = true
            case "--ignore-occlusion": AtlasView.ignoreOcclusion = true
            case "--info": info = next()
            case "--checks": checks = true
            default: break
            }
            i += 1
        }
    }
}

enum Log {
    static func line(_ text: String) {
        FileHandle.standardError.write("[paseo-native] \(text)\n".data(using: .utf8)!)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let options = Options(CommandLine.arguments)
    var main: WorldWindow?
    private var tokens: [Int32] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let world = WorldWindow(options: options)
        main = world
        // Never take focus from whatever the user is doing: the window comes
        // up without activating the app.
        if options.front { world.window.orderFrontRegardless() } else { world.window.orderFront(nil) }
        Log.line("window \(world.window.windowNumber) loading \(options.url.absoluteString)")
        // Measurement hooks, posted with `notifyutil -p <name>`.
        listen("com.paseo.command.native.pan") { [weak self] in self?.main?.scriptedPan(seconds: 10) }
        listen("com.paseo.command.native.info") { [weak self] in self?.writeInfo() }
        listen("com.paseo.command.native.quit") { NSApp.terminate(nil) }
        // Run `<info>.js` in the page, writing its result to `<info>.out` (checks and tests).
        listen("com.paseo.command.native.eval") { [weak self] in
            guard let self, let info = self.options.info, let main = self.main else { return }
            let base = (info as NSString).deletingPathExtension
            guard let js = try? String(contentsOfFile: base + ".js", encoding: .utf8) else { return }
            main.web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                let text: String
                switch result {
                case .success(let value):
                    if JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
                        text = String(data: data, encoding: .utf8) ?? ""
                    } else { text = "\(value)" }
                case .failure(let error): text = "error: \(error)"
                }
                try? text.write(toFile: base + ".out", atomically: true, encoding: .utf8)
            }
        }
        // Alternate the window between its size and a smaller, taller one (checks).
        listen("com.paseo.command.native.resize") { [weak self] in
            guard let window = self?.main?.window else { return }
            let small = window.frame.width > 1200
            var frame = window.frame
            frame.size = small ? CGSize(width: 1000, height: 960) : (self?.options.size ?? CGSize(width: 1440, height: 900))
            window.setFrame(window.frameRect(forContentRect: CGRect(origin: frame.origin, size: frame.size)), display: true)
        }
        listen("com.paseo.command.native.snapshot") { [weak self] in
            guard let self, let info = self.options.info else { return }
            self.main?.snapshot(to: (info as NSString).deletingPathExtension + ".png")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.writeInfo() }
    }

    private func listen(_ name: String, _ action: @escaping () -> Void) {
        var token: Int32 = 0
        notify_register_dispatch(name, &token, DispatchQueue.main) { _ in action() }
        tokens.append(token)
    }

    private func writeInfo() {
        guard let path = options.info, let main else { return }
        let info: [String: Any] = [
            "window": main.window.windowNumber, "pids": main.processes(),
            "visible": main.window.occlusionState.contains(.visible), "framesDrawn": main.scene.framesDrawn,
            "paused": main.atlasView.isPaused, "fps": main.atlasView.preferredFramesPerSecond,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildMenu() {
        let bar = NSMenu()
        let appItem = NSMenuItem()
        bar.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide Paseo Command", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Paseo Command", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        // The page's text fields need the standard editing commands.
        let editItem = NSMenuItem()
        bar.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem()
        bar.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewItem.submenu = view
        let windowItem = NSMenuItem()
        bar.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        NSApp.mainMenu = bar
        NSApp.windowsMenu = windowMenu
    }

    @objc private func reload() { main?.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(Options(CommandLine.arguments).background ? .accessory : .regular)
app.run()
