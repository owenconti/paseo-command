import AppKit
import CoreText
import SwiftTerm

/// The terminals' font (Settings → Terminal; ⌘+ / ⌘− / ⌘0 the size), the panel's and the Files page's
/// editors' alike, kept in the app's preferences. `family` "" is the system's monospace.
struct TerminalFontSettings: Equatable {
    var family: String
    var size: CGFloat
    /// SwiftTerm's `lineSpacing`: the cell's height as a multiple of the font's line.
    var lineHeight: CGFloat
    /// Points added to (or taken from) each cell's width.
    var letterSpacing: CGFloat

    static let defaultSize: CGFloat = 12.5
    static let sizes: ClosedRange<CGFloat> = 8...32
    /// Any positive line height up to this. SwiftTerm takes any positive `lineSpacing` but keeps a cell
    /// within 1…8,192 pt, so past that the lines stop growing; 100× stays inside it at every size (8…32 pt).
    static let maxLineHeight: CGFloat = 100
    static let letterSpacings: ClosedRange<CGFloat> = -1...4
    static let standard = TerminalFontSettings(family: "", size: defaultSize, lineHeight: 1, letterSpacing: 0)
    static let keys = (family: "terminalFontFamily", size: "terminalFontSize", lineHeight: "terminalLineHeight", letterSpacing: "terminalLetterSpacing")

    init(family: String, size: CGFloat, lineHeight: CGFloat, letterSpacing: CGFloat) {
        self.family = family
        self.size = Self.clamp(size, Self.sizes)
        self.lineHeight = Self.usableLineHeight(lineHeight) ? lineHeight : 1
        self.letterSpacing = Self.clamp(letterSpacing, Self.letterSpacings)
    }

    /// As kept (an unset or unusable value is its default).
    init(_ defaults: UserDefaults = .standard) {
        let k = Self.keys
        let number = { (key: String, fallback: CGFloat) -> CGFloat in
            (defaults.object(forKey: key) as? NSNumber).map { CGFloat($0.doubleValue) } ?? fallback
        }
        let size = number(k.size, Self.defaultSize)
        self.init(family: defaults.string(forKey: k.family) ?? "", size: size > 0 ? size : Self.defaultSize,
                  lineHeight: number(k.lineHeight, 1), letterSpacing: number(k.letterSpacing, 0))
    }

    func save(_ defaults: UserDefaults = .standard) {
        let k = Self.keys
        if family.isEmpty { defaults.removeObject(forKey: k.family) } else { defaults.set(family, forKey: k.family) }
        defaults.set(Double(size), forKey: k.size)
        defaults.set(Double(lineHeight), forKey: k.lineHeight)
        defaults.set(Double(letterSpacing), forKey: k.letterSpacing)
    }

    /// The page's change (`terminalFont`'s `set`): only the values it names, each clamped (a line height that
    /// can't work changes nothing); a family that isn't installed is the system's monospace.
    func applying(_ change: [String: Any], families: [String]) -> TerminalFontSettings {
        var next = self
        if let family = change["family"] as? String { next.family = families.contains(family) ? family : "" }
        let number = { (key: String) in (change[key] as? NSNumber).map { CGFloat($0.doubleValue) }.flatMap { $0.isFinite ? $0 : nil } }
        if let v = number("size") { next.size = Self.clamp(v, Self.sizes) }
        if let v = number("lineHeight"), Self.usableLineHeight(v) { next.lineHeight = v }
        if let v = number("letterSpacing") { next.letterSpacing = Self.clamp(v, Self.letterSpacings) }
        return next
    }

    /// For the page and checks.
    var json: [String: Any] {
        ["family": family, "size": Double(size), "lineHeight": Double(lineHeight), "letterSpacing": Double(letterSpacing)]
    }

    /// Above zero, finite and at most `maxLineHeight`.
    static func usableLineHeight(_ v: CGFloat) -> Bool { v.isFinite && v > 0 && v <= maxLineHeight }

    private static func clamp(_ v: CGFloat, _ range: ClosedRange<CGFloat>) -> CGFloat {
        v.isFinite ? min(range.upperBound, max(range.lowerBound, v)) : range.lowerBound
    }
}

/// The terminal's fonts: the chosen family with a glyph cascade, so private-use icons (Nerd Fonts') draw
/// whatever the family: the bundled Symbols Nerd Font Mono (as Ghostty bundles its symbols), then the
/// system's symbol and emoji fonts. SwiftTerm draws a cell's missing glyph from Core Text's cascade, and
/// takes Nerd Font icons from `NerdSymbols` (its glyph fallback provider), which also sizes and centres them.
enum TerminalFonts {
    /// The bundled symbols font's PostScript name and file (`native/fonts`, copied to Resources/fonts).
    static let symbolsName = "SymbolsNFM"
    static let symbolsFile = "SymbolsNerdFontMono-Regular.ttf"
    /// After the chosen family, in order.
    static let cascade = [symbolsName, "AppleSymbols", "AppleColorEmoji"]

    private static var registered: Bool?
    /// Register the bundled symbols font for this process only (never installed for other apps).
    /// `url` is for checks; the app's is in its Resources.
    @discardableResult
    static func registerSymbols(_ url: URL? = nil) -> Bool {
        if let registered { return registered }
        guard let url = url ?? Bundle.main.resourceURL?.appendingPathComponent("fonts/\(symbolsFile)"),
              FileManager.default.fileExists(atPath: url.path) else {
            Log.line("terminal fonts: no bundled \(symbolsFile)")
            return false
        }
        var error: Unmanaged<CFError>?
        let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
            // Already registered (a second window, or a check registering it first) is fine.
            || NSFont(name: symbolsName, size: 12) != nil
        if !ok { Log.line("terminal fonts: \(symbolsFile) didn't register: \(error?.takeRetainedValue().localizedDescription ?? "?")") }
        registered = ok
        return ok
    }

    /// The family's regular face, else the system's monospace.
    static func base(_ family: String, size: CGFloat) -> NSFont {
        if !family.isEmpty, let font = NSFontManager.shared.font(withFamily: family, traits: [], weight: 5, size: size) { return font }
        return NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
    }

    /// The terminal's font: the family with the cascade and, with letter spacing, a fixed advance (SwiftTerm
    /// sizes its cells by the font's "W" and draws every glyph at its cell, so this spaces the grid).
    static func font(_ settings: TerminalFontSettings) -> NSFont {
        registerSymbols()
        let base = base(settings.family, size: settings.size)
        var attributes: [CFString: Any] = [
            kCTFontCascadeListAttribute: cascade.map { CTFontDescriptorCreateWithNameAndSize($0 as CFString, 0) },
        ]
        if settings.letterSpacing != 0 {
            attributes[kCTFontFixedAdvanceAttribute] = max(1, advance(of: base) + settings.letterSpacing)
        }
        let descriptor = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(base), attributes as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, settings.size, nil) as NSFont
    }

    /// The width of "W", as SwiftTerm measures its cell.
    static func advance(of font: NSFont) -> CGFloat {
        var characters: [UniChar] = [0x57]
        var glyphs: [CGGlyph] = [0]
        guard CTFontGetGlyphsForCharacters(font, &characters, &glyphs, 1) else { return font.maximumAdvancement.width }
        return font.advancement(forGlyph: NSGlyph(glyphs[0])).width
    }

    /// The installed families whose letters share one advance (monospaced), by name; the symbols-only fonts
    /// and hidden system families (".…") aside. The system's own monospace is the "" choice.
    static func families() -> [String] {
        let manager = NSFontManager.shared
        return manager.availableFontFamilies.filter { family in
            guard !family.hasPrefix("."), !family.hasPrefix("Symbols Nerd Font"),
                  let font = manager.font(withFamily: family, traits: [], weight: 5, size: 12) else { return false }
            return monospaced(font)
        }.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// Whether `font` draws Latin letters, all of one width.
    static func monospaced(_ font: NSFont) -> Bool {
        var characters = Array("iWm.0".utf16)
        var glyphs = [CGGlyph](repeating: 0, count: characters.count)
        guard CTFontGetGlyphsForCharacters(font, &characters, &glyphs, characters.count) else { return false }
        var advances = [CGSize](repeating: .zero, count: glyphs.count)
        CTFontGetAdvancesForGlyphs(font, .horizontal, glyphs, &advances, glyphs.count)
        guard let first = advances.first?.width, first > 0 else { return false }
        return advances.allSatisfy { abs($0.width - first) < 0.01 }
    }

    /// The font Core Text draws `text` in with the terminal's font (checks: an icon resolves to the symbols font).
    static func drawingFont(for text: String, in font: NSFont) -> String {
        let resolved = CTFontCreateForString(font, text as CFString, CFRange(location: 0, length: (text as NSString).length))
        return CTFontCopyPostScriptName(resolved) as String
    }
}

/// SwiftTerm's glyph fallback for Nerd Font icons the chosen family lacks: the private-use code points the
/// bundled symbols font has (a patched family's own icons keep priority: SwiftTerm asks only when the family
/// lacks the glyph), drawn from it fitted to their cells: one cell for a narrow cell, two for a wide one.
final class NerdSymbols: TerminalGlyphFallbackProvider, @unchecked Sendable {
    static let shared = NerdSymbols()
    let generation: UInt64 = 1
    private let lock = NSLock()
    private var fonts: [CGFloat: CTFont] = [:]
    private let covered: CharacterSet
    private static let policy = TerminalGlyphPlacementPolicy(placement: .icon)

    init() {
        TerminalFonts.registerSymbols()
        covered = NSFont(name: TerminalFonts.symbolsName, size: 12).map { CTFontCopyCharacterSet($0) as CharacterSet } ?? CharacterSet()
    }

    /// Private use only (U+E000–F8FF, planes 15 and 16), and only what the font has.
    static func privateUse(_ v: UInt32) -> Bool { (0xE000...0xF8FF).contains(v) || (0xF0000...0x10FFFD).contains(v) }

    func placementPolicy(for scalar: Unicode.Scalar) -> TerminalGlyphPlacementPolicy? {
        Self.privateUse(scalar.value) && covered.contains(scalar) ? Self.policy : nil
    }

    func fallbackFont(forPointSize size: CGFloat) -> CTFont? {
        lock.lock()
        defer { lock.unlock() }
        if let font = fonts[size] { return font }
        guard let font = NSFont(name: TerminalFonts.symbolsName, size: size) else { return nil }
        fonts[size] = font
        return font
    }
}
