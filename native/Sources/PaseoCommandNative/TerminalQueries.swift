import Foundation

/// The queries a program asks its terminal (device attributes, cursor position,
/// colours, modes, versions…) in the bytes a `TerminalSession` feeds SwiftTerm,
/// which answers each by typing its reply into the terminal. Two kinds of
/// answer would be typed into the wrong program, so their queries are taken
/// out of the bytes before SwiftTerm sees them (they never change the screen):
///
/// - Those in a replay (the screen sent first on connect): whoever asked them
///   has had its answer long ago, so a fresh one goes to whatever runs now.
/// - Those the daemon answers itself, at once, from its own headless terminal
///   (`@getpaseo/server`'s `terminal.js` and `TerminalInputModeTracker`): DA1
///   (`CSI c`, `CSI 0 c`), `CSI 5 n`, `CSI 6 n`, `CSI ? 6 n`, `OSC 10/11/12;?`
///   and kitty's `CSI ? u`. SwiftTerm's answer would be a second one, a round
///   trip later: nvim asks DA1 as it quits, leaves on the daemon's answer, and
///   SwiftTerm's (`ESC[?65;4;1;2;6;21;22;17;28c`) reached the shell's prompt.
///
/// The others (DA2, DA3, other DSRs, DECRQM, XTVERSION, window reports, OSC 4
/// and other colour queries, XTGETTCAP, DECRQSS) only SwiftTerm answers, so
/// live ones pass through. The filter also notes shell-integration prompt
/// marks (`OSC 633;A|D`, `OSC 133;A|D`): a query before one came from a
/// program that has finished, whose answer the session then drops.
struct TerminalQueryFilter {
    /// What one chunk became: the bytes to feed, and where in them the queries
    /// left for SwiftTerm to answer and the prompt marks fell.
    struct Output: Equatable {
        var bytes: [UInt8] = []
        var queries: [Int] = []
        var prompts: [Int] = []
        /// Queries taken out.
        var removed = 0
    }

    private enum State { case ground, escape, csi, osc, oscEscape, dcs, dcsEscape, pass, passEscape }
    private var state = State.ground
    /// The sequence being read, ESC first, until it is known to be a query or not.
    private var pending: [UInt8] = []
    private static let esc: UInt8 = 0x1b, bel: UInt8 = 0x07, st: UInt8 = 0x5c

    /// Reads one chunk, carrying an unfinished sequence over to the next.
    mutating func filter(_ chunk: [UInt8], replay: Bool) -> Output {
        var out = Output()
        out.bytes.reserveCapacity(chunk.count)
        for byte in chunk { step(byte, replay: replay, &out) }
        return out
    }

    /// Starts afresh (a new replay): an unfinished sequence goes.
    mutating func reset() {
        state = .ground
        pending = []
    }

    private mutating func flush(_ out: inout Output) {
        out.bytes += pending
        pending = []
    }

    private mutating func step(_ byte: UInt8, replay: Bool, _ out: inout Output) {
        switch state {
        case .ground:
            if byte == Self.esc { pending = [byte]; state = .escape } else { out.bytes.append(byte) }
        case .escape:
            pending.append(byte)
            switch byte {
            case 0x5b: state = .csi // [
            case 0x5d: state = .osc // ]
            case 0x50: state = .dcs // P
            case Self.esc: pending.removeLast(); flush(&out); pending = [byte]
            default: flush(&out); state = .ground
            }
        case .csi:
            if (0x20...0x3f).contains(byte) && pending.count < 48 {
                pending.append(byte)
            } else if (0x40...0x7e).contains(byte) {
                pending.append(byte)
                finish(Self.csiQuery(Array(pending.dropFirst(2))), replay: replay, &out)
                state = .ground
            } else {
                flush(&out)
                state = .ground
                step(byte, replay: replay, &out)
            }
        case .osc:
            if byte == Self.bel {
                let body = Array(pending.dropFirst(2))
                pending.append(byte)
                finish(Self.oscQuery(body), replay: replay, &out)
                state = .ground
            } else if byte == Self.esc {
                state = .oscEscape
            } else {
                pending.append(byte)
                let body = pending.dropFirst(2)
                if Self.isPrompt(body) {
                    out.prompts.append(out.bytes.count)
                    flush(&out)
                    state = .pass
                } else if !Self.mayBeOscQuery(body) {
                    flush(&out)
                    state = .pass
                }
            }
        case .oscEscape:
            if byte == Self.st {
                let body = Array(pending.dropFirst(2))
                pending += [Self.esc, byte]
                finish(Self.oscQuery(body), replay: replay, &out)
                state = .ground
            } else {
                // An ESC inside the string ends it and starts what follows.
                flush(&out)
                state = .ground
                step(Self.esc, replay: replay, &out)
                step(byte, replay: replay, &out)
            }
        case .dcs:
            if byte == Self.esc {
                state = .dcsEscape
            } else {
                pending.append(byte)
                if !Self.mayBeDcsQuery(pending.dropFirst(2)) { flush(&out); state = .pass }
            }
        case .dcsEscape:
            if byte == Self.st {
                pending += [Self.esc, byte]
                finish(.answeredHere, replay: replay, &out)
                state = .ground
            } else {
                flush(&out)
                state = .ground
                step(Self.esc, replay: replay, &out)
                step(byte, replay: replay, &out)
            }
        case .pass:
            // The rest of a string that isn't a query: as it comes, to its end.
            if byte == Self.bel { out.bytes.append(byte); state = .ground }
            else if byte == Self.esc { state = .passEscape }
            else { out.bytes.append(byte) }
        case .passEscape:
            out.bytes.append(Self.esc)
            if byte == Self.st { out.bytes.append(byte); state = .ground }
            else { out.bytes.removeLast(); state = .ground; step(Self.esc, replay: replay, &out); step(byte, replay: replay, &out) }
        }
    }

    /// Who answers a sequence: no one (it isn't a query), the daemon, or SwiftTerm.
    enum Answer: Equatable { case none, daemon, answeredHere }

    private mutating func finish(_ answer: Answer, replay: Bool, _ out: inout Output) {
        if answer == .daemon || (answer == .answeredHere && replay) {
            pending = []
            out.removed += 1
        } else {
            if answer == .answeredHere { out.queries.append(out.bytes.count) }
            flush(&out)
        }
    }

    /// A CSI sequence's parameters, intermediates and final byte (after `ESC [`).
    static func csiQuery(_ body: [UInt8]) -> Answer {
        guard let final = body.last.map({ Character(UnicodeScalar($0)) }) else { return .none }
        let text = String(decoding: body.dropLast(), as: UTF8.self)
        let prefix = text.first.flatMap { "<=>?".contains($0) ? $0 : nil }
        let params = prefix == nil ? text : String(text.dropFirst())
        switch (prefix, params, final) {
        case (nil, "", "c"), (nil, "0", "c"): return .daemon // DA1
        case (nil, "5", "n"), (nil, "6", "n"), ("?", "6", "n"): return .daemon // status, cursor position
        case ("?", _, "u"): return .daemon // kitty keyboard flags
        case (nil, _, "c"), (">", _, "c"), ("=", _, "c"): return .answeredHere // DA2, DA3
        case (nil, _, "n"), ("?", _, "n"): return .answeredHere // other device status reports
        case (">", _, "q"): return .answeredHere // XTVERSION
        case (nil, _, "p"), ("?", _, "p"): return params.hasSuffix("$") ? .answeredHere : .none // DECRQM
        case (nil, _, "t"):
            // Window reports (state, position, sizes, labels); the rest of `t` are actions.
            let first = Int(params.split(separator: ";", omittingEmptySubsequences: false).first ?? "") ?? 0
            return [11, 13, 14, 15, 16, 18, 19, 20, 21].contains(first) ? .answeredHere : .none
        default: return .none
        }
    }

    /// An OSC string's body (after `ESC ]`, before its terminator).
    static func oscQuery(_ body: [UInt8]) -> Answer {
        let fields = String(decoding: body, as: UTF8.self).split(separator: ";", omittingEmptySubsequences: false)
        guard let code = Int(fields.first ?? ""), fields.dropFirst().contains("?") else { return .none }
        if [10, 11, 12].contains(code) && fields.count == 2 { return .daemon }
        return [4, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 52].contains(code) ? .answeredHere : .none
    }

    /// Whether an OSC body read so far could still be a query (digits, `;`, `?`, and `c`/`p`/`s` for OSC 52's selections).
    private static func mayBeOscQuery(_ body: ArraySlice<UInt8>) -> Bool {
        body.count <= 64 && body.allSatisfy { (0x30...0x39).contains($0) || [0x3b, 0x3f, 0x63, 0x70, 0x73].contains($0) }
    }

    /// Whether a DCS body read so far could still be XTGETTCAP (`+q` and hex names) or DECRQSS (`$q` and a short setting).
    private static func mayBeDcsQuery(_ body: ArraySlice<UInt8>) -> Bool {
        let bytes = Array(body)
        guard body.count <= 512 else { return false }
        guard let first = bytes.first else { return true }
        guard first == 0x2b || first == 0x24 else { return false }
        guard bytes.count > 1 else { return true }
        guard bytes[1] == 0x71 else { return false }
        return first == 0x24 ? bytes.count <= 8 : true
    }

    /// A shell-integration prompt mark: the command before it has finished.
    private static func isPrompt(_ body: ArraySlice<UInt8>) -> Bool {
        let text = String(decoding: body, as: UTF8.self)
        return text == "633;A" || text == "633;D" || text == "133;A" || text == "133;D"
    }

    /// Whether bytes SwiftTerm sent look like an answer to a query rather than a
    /// key (an arrow's `ESC [ A`, a mouse report's `ESC [ <`).
    static func isReply(_ bytes: ArraySlice<UInt8>) -> Bool {
        let text = String(decoding: bytes, as: UTF8.self)
        return text.range(of: #"^\x1b(\[[?>=]|\[[0-9;]*(\$y|[Rnt])$|\]|P|_)"#, options: .regularExpression) != nil
    }
}

/// A `TerminalSession`'s queries and SwiftTerm's answers to them: what it feeds
/// (`received`), and what becomes of what SwiftTerm sends (`sent`). Binary
/// frames are counted as the relay counts them, so an answer names the frame
/// its query came in; the relay drops it if a prompt mark has gone out since
/// (`web/server/api/terminals.ts`), and a mark in the same chunk after the
/// query, or in a later one already here, drops it at once.
struct TerminalAnswers {
    /// Between the relay's `replay` and `live` messages.
    var replaying = false
    private var filter = TerminalQueryFilter()
    private var frames = 0
    private var awaiting: [(frame: Int, at: Date, stale: Bool)] = []
    /// For checks: queries taken out, answers sent, answers dropped.
    private(set) var removed = 0, answered = 0, dropped = 0

    enum Outgoing: Equatable {
        /// Typed: sent as it is.
        case key
        /// SwiftTerm's answer to a query that came in frame `frame`.
        case reply(frame: Int)
        /// An answer for a program that has finished.
        case drop
    }

    /// A replay begins: an unfinished sequence from before it goes.
    mutating func beginReplay() {
        replaying = true
        filter.reset()
    }

    /// One binary frame from the relay: the bytes to feed SwiftTerm.
    mutating func received(_ bytes: [UInt8], now: Date = Date()) -> [UInt8] {
        let frame = frames
        frames += 1
        let out = filter.filter(bytes, replay: replaying)
        removed += out.removed
        if !out.prompts.isEmpty { for i in awaiting.indices { awaiting[i].stale = true } }
        for query in out.queries { awaiting.append((frame, now, out.prompts.contains { $0 > query })) }
        return out.bytes
    }

    /// Bytes SwiftTerm sent: a key, or the answer to the oldest query waiting (answers come in order, within moments).
    mutating func sent(_ bytes: ArraySlice<UInt8>, now: Date = Date()) -> Outgoing {
        awaiting.removeAll { now.timeIntervalSince($0.at) > 2 }
        guard !awaiting.isEmpty, TerminalQueryFilter.isReply(bytes) else { return .key }
        let query = awaiting.removeFirst()
        if query.stale { dropped += 1; return .drop }
        answered += 1
        return .reply(frame: query.frame)
    }

    var json: [String: Any] { ["removed": removed, "answered": answered, "dropped": dropped, "frames": frames] }
}
