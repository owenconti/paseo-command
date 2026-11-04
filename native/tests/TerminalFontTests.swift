// The terminals' font: Nerd Font icons resolve to the bundled symbols font whatever the family (Core Text's
// cascade, and SwiftTerm's glyph fallback), the settings are kept and clamped, letter spacing widens the
// cell, and a change reaches terminals already open (the Files page's editors as the panel's).
import AppKit
import SwiftTerm

_ = NSApplication.shared
let fontURL = URL(fileURLWithPath: CommandLine.arguments[1])
assert(TerminalFonts.registerSymbols(fontURL), "the bundled symbols font registers for this process")
assert(NSFont(name: TerminalFonts.symbolsName, size: 12) != nil)

// ── The cascade: icons from the symbols font, letters from the family ──
let icons = ["\u{e7a8}", "\u{f115}", "\u{e718}", "\u{f0219}", "\u{e5ff}", "\u{f07b}"]
for family in ["", "Menlo", "Courier New"] {
    let font = TerminalFonts.font(TerminalFontSettings(family: family, size: 13, lineHeight: 1, letterSpacing: 0))
    for icon in icons {
        let drawn = TerminalFonts.drawingFont(for: icon, in: font)
        assert(drawn == TerminalFonts.symbolsName, "U+\(String(icon.unicodeScalars.first!.value, radix: 16)) in \(family): \(drawn)")
    }
    assert(TerminalFonts.drawingFont(for: "A", in: font) == CTFontCopyPostScriptName(TerminalFonts.base(family, size: 13)) as String, "letters keep the family")
    assert(TerminalFonts.drawingFont(for: "😀", in: font).contains("AppleColorEmoji"))
    assert(font.pointSize == 13)
}
assert(TerminalFonts.base("Menlo", size: 12).familyName == "Menlo")
assert(TerminalFonts.base("No Such Family", size: 12).fontName == NSFont.monospacedSystemFont(ofSize: 12, weight: .regular).fontName)

// ── SwiftTerm's fallback provider: the private-use code points the symbols font has, at a stable font per size ──
let symbols = NerdSymbols.shared
for icon in icons { assert(symbols.placementPolicy(for: icon.unicodeScalars.first!) != nil, icon) }
for other in ["A", "─", "😀", "\u{10FFFD}"] { assert(symbols.placementPolicy(for: other.unicodeScalars.first!) == nil, other) }
let at13 = symbols.fallbackFont(forPointSize: 13)
assert(at13 != nil && at13 === symbols.fallbackFont(forPointSize: 13), "one font per size")
assert(CTFontCopyPostScriptName(at13!) as String == TerminalFonts.symbolsName)

// ── Families: monospaced only, the symbols fonts aside ──
let families = TerminalFonts.families()
assert(families.contains("Menlo") && families.contains("Courier New"), "\(families)")
assert(!families.contains("Helvetica") && !families.contains { $0.hasPrefix("Symbols Nerd Font") || $0.hasPrefix(".") })

// ── Settings: kept, clamped, and changed only as the page names ──
let defaults = UserDefaults(suiteName: "paseo-command-terminal-font-test")!
defaults.removePersistentDomain(forName: "paseo-command-terminal-font-test")
assert(TerminalFontSettings(defaults) == .standard, "nothing kept: the system monospace at 12.5")
defaults.set(15.0, forKey: "terminalFontSize")
assert(TerminalFontSettings(defaults).size == 15, "the ⌘+ size kept before this change still reads")
let chosen = TerminalFontSettings.standard.applying(["family": "Menlo", "size": 99, "lineHeight": 1.25, "letterSpacing": -7], families: families)
assert(chosen == TerminalFontSettings(family: "Menlo", size: 32, lineHeight: 1.25, letterSpacing: -1), "\(chosen)")
chosen.save(defaults)
assert(TerminalFontSettings(defaults) == chosen)
assert(chosen.applying(["lineHeight": 3], families: families) == TerminalFontSettings(family: "Menlo", size: 32, lineHeight: 1.6, letterSpacing: -1))
assert(chosen.applying(["family": "Not Installed"], families: families).family == "", "an unknown family is the system's")
assert(chosen.applying(["size": "big", "lineHeight": Double.nan], families: families) == chosen, "unusable values change nothing")
TerminalFontSettings.standard.save(defaults)
assert(defaults.string(forKey: "terminalFontFamily") == nil && TerminalFontSettings(defaults) == .standard)
defaults.removePersistentDomain(forName: "paseo-command-terminal-font-test")

// ── Letter spacing: SwiftTerm's cell is the font's "W", so the grid widens by it ──
let plain = TerminalFonts.font(TerminalFontSettings(family: "Menlo", size: 12, lineHeight: 1, letterSpacing: 0))
let spaced = TerminalFonts.font(TerminalFontSettings(family: "Menlo", size: 12, lineHeight: 1, letterSpacing: 1.5))
assert(abs(TerminalFonts.advance(of: spaced) - TerminalFonts.advance(of: plain) - 1.5) < 0.01, "\(TerminalFonts.advance(of: spaced))")
assert(TerminalFonts.drawingFont(for: "\u{f115}", in: spaced) == TerminalFonts.symbolsName, "the cascade stays with spacing")

// ── Applied to terminals already open: the Files page's editors (the panel's sessions take the same `apply`) ──
final class FlippedView: NSView { override var isFlipped: Bool { true } }
// Top-level code isn't the main actor's; the app's terminals are.
MainActor.assumeIsolated {
    let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 1000, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
    let content = NSView(frame: CGRect(x: 0, y: 0, width: 1000, height: 700))
    window.contentView = content
    let web = FlippedView(frame: content.bounds)
    content.addSubview(web)
    let overlay = EditorOverlay(font: .standard)
    // Nothing listens there: the relay fails, which is all the same to its font.
    overlay.server = { URL(string: "http://127.0.0.1:9/")! }
    content.addSubview(overlay)
    for id in ["term-1", "term-2"] {
        overlay.place(EditorPlacement(["terminal": id, "x": 0, "y": 0, "width": 800, "height": 500]), filesShows: true, web: web)
    }
    func cells() -> [[String: Any]] { overlay.state()["cells"] as! [[String: Any]] }
    assert(cells().count == 2)
    let session = TerminalSession(id: "lone", name: "x", server: URL(string: "http://127.0.0.1:9/")!, host: "", font: .standard)
    assert(session.view.glyphFallbackProvider === NerdSymbols.shared, "every terminal has the icon fallback")
    assert(TerminalFonts.drawingFont(for: "\u{e7a8}", in: session.view.font) == TerminalFonts.symbolsName)
    let menlo = TerminalFontSettings(family: "Menlo", size: 16, lineHeight: 1.4, letterSpacing: 0.5)
    overlay.setFont(menlo)
    for cell in cells() {
        assert(cell["family"] as? String == "Menlo" && cell["pointSize"] as? Double == 16 && abs((cell["lineSpacing"] as? Double ?? 0) - 1.4) < 0.001, "\(cell)")
    }
    session.apply(menlo)
    assert(session.view.font.familyName == "Menlo" && abs(session.view.lineSpacing - 1.4) < 0.001)
    assert(abs(TerminalFonts.advance(of: session.view.font) - TerminalFonts.advance(of: TerminalFonts.base("Menlo", size: 16)) - 0.5) < 0.01)
    // A terminal opened afterwards starts with it.
    overlay.place(EditorPlacement(["terminal": "term-3", "x": 0, "y": 0, "width": 800, "height": 500]), filesShows: true, web: web)
    assert(cells().count == 3 && cells().allSatisfy { $0["pointSize"] as? Double == 16 })
    overlay.closeAll()
    session.close()
}
print("Terminal font checks passed.")
