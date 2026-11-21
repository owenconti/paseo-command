import AppKit
import Carbon.HIToolbox

/// A system-wide shortcut (Carbon's `RegisterEventHotKey`: it works whichever app is in front and needs no
/// permission). Registering fails when another app holds the same keys; `init` then returns nil.
final class HotKey {
    private var ref: EventHotKeyRef?
    private let id: UInt32
    private static var actions: [UInt32: () -> Void] = [:]
    private static var handler: EventHandlerRef?
    private static var nextID: UInt32 = 1

    /// `keyCode` a virtual key (`kVK_ANSI_S`), `modifiers` Carbon's (`controlKey | optionKey | shiftKey`).
    init?(keyCode: Int, modifiers: Int, action: @escaping () -> Void) {
        Self.install()
        id = Self.nextID
        Self.nextID += 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x5043_4150), id: id) // "PCAP"
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), hotKeyID, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, ref != nil else {
            Log.line("hotkey: couldn't register (\(status)); another app may hold it")
            return nil
        }
        Self.actions[id] = action
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        Self.actions[id] = nil
    }

    private static func install() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var hotKeyID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            let id = hotKeyID.id
            DispatchQueue.main.async { HotKey.actions[id]?() }
            return noErr
        }, 1, &spec, nil, &handler)
    }
}
