import AppKit

/// Bitmap contexts and fixed colours for the window's own drawing (snapshots, the splash).
enum Textures {
    static func context(_ width: Int, _ height: Int) -> CGContext? {
        CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    }

    static func color(_ rgb: Int, _ alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                blue: CGFloat(rgb & 255) / 255, alpha: alpha)
    }
}

/// Native chrome aliases the React theme's semantic tokens.
enum Ink {
    typealias Tone = String
    static let base = "panel"
    static let bar = "fill"
    static let pane = "panel-raised"
    static let divider = "line-strong"
    static let tabFocused = "row-selected"
    static let tabShown = "fill-strong"
    static let text = "text"
    static let strong = "text-strong"
    static let mid = "text-2"
    static let faint = "text-3"
    static let off = "text-4"
    static let accent = "accent"
    static let onAccent = "on-accent"

    static func color(_ tone: Tone, _ appearance: NSAppearance, _ alpha: CGFloat = 1) -> NSColor {
        Chrome.color(tone, appearance).withAlphaComponent(alpha)
    }
}
