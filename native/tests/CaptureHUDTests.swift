// The recording's capsule: its row centred top to bottom and inside its ends, sized to fit; Clear only once there's ink.
import AppKit
let hud = CaptureHUD(screen: NSScreen.main ?? NSScreen.screens[0], hotkey: "⌃⌥⇧D")
let content = hud.panel.contentView!
content.layoutSubtreeIfNeeded()
assert(content.bounds.height == CaptureHUD.height, "\(content.bounds)")
func leaves(_ v: NSView) -> [NSView] { v is NSStackView ? v.subviews.flatMap(leaves) : v.subviews.isEmpty || v is NSControl ? [v] : v.subviews.flatMap(leaves) }
let row = content.subviews.first { $0 is NSStackView }!
let parts = leaves(row).map { $0.convert($0.bounds, to: content) }
assert(parts.count == 7, "\(parts.count) parts")
for r in parts {
    assert(abs(r.midY - content.bounds.midY) <= 1, "centred top to bottom: \(r)")
    assert(r.minX >= 10 && r.maxX <= content.bounds.width - 8, "inside its ends: \(r) in \(content.bounds)")
}
let buttons = leaves(row).compactMap { $0 as? PillButton }
assert(buttons.map(\.title) == ["Clear", "Cancel", "Done"])
assert(!buttons[0].isEnabled && buttons[1].isEnabled && buttons[2].isEnabled)
hud.canClear(true)
assert(buttons[0].isEnabled)
// The hint never changes the capsule's width as it says something else.
let width = hud.panel.frame.width
hud.say("Saving…")
content.layoutSubtreeIfNeeded()
assert(hud.panel.frame.width == width)
print("Capture capsule checks passed.")
