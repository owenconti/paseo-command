// The recording's capsule: its row centred top to bottom and inside its ends, sized to fit; Clear only once there's ink.
import AppKit
let hud = CaptureHUD(screen: NSScreen.main ?? NSScreen.screens[0], hotkey: "⌃⌥⇧D")
let content = hud.panel.contentView!
content.layoutSubtreeIfNeeded()
assert(content.bounds.height == CaptureHUD.height, "\(content.bounds)")
func leaves(_ v: NSView) -> [NSView] { v is NSStackView ? v.subviews.flatMap(leaves) : v.subviews.isEmpty || v is NSControl ? [v] : v.subviews.flatMap(leaves) }
let row = content.subviews.first { $0 is NSStackView }!
let parts = leaves(row).map { $0.convert($0.bounds, to: content) }
assert(parts.count == 8, "\(parts.count) parts")
for r in parts {
    assert(abs(r.midY - content.bounds.midY) <= 1, "centred top to bottom: \(r)")
    assert(r.minX >= 10 && r.maxX <= content.bounds.width - 8, "inside its ends: \(r) in \(content.bounds)")
}
let buttons = leaves(row).compactMap { $0 as? PillButton }
assert(buttons.map(\.title) == ["", "Clear", "Cancel", "Done"])
assert(buttons[0] === hud.mic)
assert(!buttons[1].isEnabled && buttons[2].isEnabled && buttons[3].isEnabled)
hud.canClear(true)
assert(buttons[1].isEnabled)
// The mic: off until the recording says (no meter, its why as the tooltip); on, a meter beside it; muted, flat.
// The hint and the mic never change the capsule's width.
assert(hud.mic.toolTip == "" || hud.mic.toolTip == nil)
let offWidth = hud.mic.intrinsicContentSize.width
hud.mic.state(.on)
assert(hud.mic.intrinsicContentSize.width == offWidth, "the capsule keeps its width")
assert(hud.mic.toolTip == "Recording your voice: click to mute")
hud.level(0.8)
hud.mic.state(.muted)
assert(hud.mic.toolTip == "Muted: click to record your voice")
hud.mic.state(.off("Recording your voice needs macOS 15"))
assert(hud.mic.toolTip == "Recording your voice needs macOS 15" )
// The hint never changes the capsule's width as it says something else.
let width = hud.panel.frame.width
hud.say("Saving…")
content.layoutSubtreeIfNeeded()
assert(hud.panel.frame.width == width)
print("Capture capsule checks passed.")
