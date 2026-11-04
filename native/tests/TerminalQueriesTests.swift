// A terminal's queries: SwiftTerm answers none in a replay, none the daemon answers itself (DA1, cursor
// position, OSC 10/11/12, kitty flags), and none for a program that has finished; it still answers the
// rest live. Everything else passes byte for byte, however the stream is cut into chunks.
import AppKit
import SwiftTerm

_ = NSApplication.shared
let esc = "\u{1b}", bel = "\u{7}", st = "\u{1b}\\"
func bytes(_ s: String) -> [UInt8] { Array(s.utf8) }
func text(_ b: [UInt8]) -> String { String(decoding: b, as: UTF8.self) }

// ── The filter ──
let daemons = ["\(esc)[c", "\(esc)[0c", "\(esc)[5n", "\(esc)[6n", "\(esc)[?6n", "\(esc)]10;?\(bel)", "\(esc)]11;?\(st)", "\(esc)]12;?\(bel)", "\(esc)[?u"]
let swiftTerms = ["\(esc)[>c", "\(esc)[=c", "\(esc)[>0q", "\(esc)[>q", "\(esc)[?2026$p", "\(esc)[4$p", "\(esc)[14t", "\(esc)[16t", "\(esc)[18t", "\(esc)[?996n",
                  "\(esc)]4;1;?\(st)", "\(esc)]10;?;?\(bel)", "\(esc)]52;c;?\(bel)", "\(esc)P+q544e;636f6c6f7273\(st)", "\(esc)P$qm\(st)"]
let plain = ["hello ", "\(esc)[1;32m", "\(esc)[?1049h", "\(esc)[8;24;80t", "\(esc)[!p", "\(esc)]2;title\(bel)", "\(esc)]8;;https://example.com\(st)link\(esc)]8;;\(st)",
             "\(esc)]11;rgb:0000/0000/0000\(bel)", "\(esc)Pq#0;2;0;0;0#0~~\(st)", "\(esc)(B", "\(esc)7", "漢 😀", "\(esc)]633;C\(bel)", "\(esc)[3;4H", "\r\n"]

do {
    // A replay: every query goes, nothing else changes.
    var f = TerminalQueryFilter()
    let replay = (plain + daemons + swiftTerms + plain).joined()
    let out = f.filter(bytes(replay), replay: true)
    assert(text(out.bytes) == (plain + plain).joined(), text(out.bytes).debugDescription)
    assert(out.removed == daemons.count + swiftTerms.count && out.queries.isEmpty)
}
do {
    // Live: the daemon's go, SwiftTerm's stay (noted where they fall).
    var f = TerminalQueryFilter()
    let out = f.filter(bytes((daemons + ["x"] + swiftTerms).joined()), replay: false)
    assert(text(out.bytes) == "x" + swiftTerms.joined(), text(out.bytes).debugDescription)
    assert(out.removed == daemons.count && out.queries.count == swiftTerms.count)
    assert(out.queries.first == 1, "a query is noted where it starts in what's fed")
}
do {
    // Cut anywhere, the stream reads the same.
    let stream = (plain + daemons + swiftTerms + ["\(esc)]633;D;0\(bel)\(esc)]633;A\(bel)$ "] + plain).joined()
    var whole = TerminalQueryFilter()
    let expected = whole.filter(bytes(stream), replay: false)
    for cut in 1..<bytes(stream).count {
        var f = TerminalQueryFilter()
        let a = f.filter(Array(bytes(stream)[..<cut]), replay: false), b = f.filter(Array(bytes(stream)[cut...]), replay: false)
        assert(a.bytes + b.bytes == expected.bytes, "cut at \(cut)")
        assert(a.removed + b.removed == expected.removed && a.queries.count + b.queries.count == expected.queries.count, "cut at \(cut)")
    }
    var g = TerminalQueryFilter(), oneByOne: [UInt8] = []
    for b in bytes(stream) { oneByOne += g.filter([b], replay: false).bytes }
    assert(oneByOne == expected.bytes, "a byte at a time")
    // Prompt marks are noted and kept.
    assert(expected.prompts.count == 2 && text(expected.bytes).contains("\(esc)]633;D;0\(bel)\(esc)]633;A\(bel)"))
}
do {
    // Plain text, colour and strings arrive unchanged whatever the chunking.
    let stream = plain.joined()
    for size in 1...7 {
        var f = TerminalQueryFilter(), got: [UInt8] = []
        var rest = bytes(stream)[...]
        while !rest.isEmpty { got += f.filter(Array(rest.prefix(size)), replay: false).bytes; rest = rest.dropFirst(size) }
        assert(got == bytes(stream), "chunks of \(size)")
    }
}
assert(TerminalQueryFilter.isReply(bytes("\(esc)[?65;1c")[...]) && TerminalQueryFilter.isReply(bytes("\(esc)[>0;276;0c")[...]))
assert(TerminalQueryFilter.isReply(bytes("\(esc)[4;100;200t")[...]) && TerminalQueryFilter.isReply(bytes("\(esc)P>|SwiftTerm\(st)")[...]))
for key in ["a", "\(esc)[A", "\(esc)OP", "\(esc)[<0;3;4M", "\r", "\(esc)[200~paste"] { assert(!TerminalQueryFilter.isReply(bytes(key)[...]), key.debugDescription) }

// ── With SwiftTerm: what it would send back ──
final class Probe: NSObject, TerminalViewDelegate {
    let view = TerminalView(frame: CGRect(x: 0, y: 0, width: 640, height: 240))
    var answers = TerminalAnswers()
    var sent: [String] = [], outgoing: [TerminalAnswers.Outgoing] = []
    override init() { super.init(); view.terminalDelegate = self }
    func feed(_ s: String, filtered: Bool = true) {
        view.feed(byteArray: (filtered ? answers.received(bytes(s)) : bytes(s))[...])
    }
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        sent.append(String(decoding: data, as: UTF8.self))
        outgoing.append(answers.sent(data))
    }
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func bell(source: TerminalView) {}
    func clipboardCopy(source: TerminalView, content: Data) {}
    func clipboardRead(source: TerminalView) -> Data? { nil }
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}
/// Runs the main loop until `done` (SwiftTerm parses and answers asynchronously), or for `seconds`.
@MainActor func settle(_ seconds: Double = 0.4, until done: () -> Bool = { false }) {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end && !done() { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
}

MainActor.assumeIsolated {
    // Unfiltered, SwiftTerm answers each of them: the probe sees what it would type.
    let raw = Probe()
    raw.feed("\(esc)[c\(esc)[6n\(esc)]11;?\(bel)", filtered: false)
    settle(2) { raw.sent.count >= 3 }
    assert(raw.sent.contains { $0.hasPrefix("\(esc)[?65;") && $0.hasSuffix("c") }, "SwiftTerm answers DA1: \(raw.sent)")
    assert(raw.sent.contains { $0.hasSuffix("R") } && raw.sent.contains { $0.hasPrefix("\(esc)]11;") }, "\(raw.sent)")

    let probe = Probe()
    // A replay with queries in it: nothing is sent back, its text is drawn.
    probe.answers.beginReplay()
    probe.feed("old prompt$ \(esc)[c\(esc)[6n\(esc)]11;?\(bel)\(esc)[>c\(esc)[>q\(esc)P+q544e\(st)")
    probe.answers.replaying = false
    settle()
    assert(probe.sent.isEmpty, "a replay's queries go unanswered: \(probe.sent)")
    assert(String(decoding: probe.view.getBufferAsData(), as: UTF8.self).contains("old prompt$"))
    // Live, the daemon's queries go unanswered here (it answered them already)…
    probe.feed("\(esc)[c\(esc)[6n\(esc)]11;?\(bel)\(esc)[?u")
    settle()
    assert(probe.sent.isEmpty, "the daemon's queries aren't answered twice: \(probe.sent)")
    // …and SwiftTerm's own are answered, each naming the frame its query came in.
    probe.feed("\(esc)[>c")
    settle(2) { probe.sent.count >= 1 }
    assert(probe.sent.count == 1 && probe.sent[0].hasPrefix("\(esc)[>") && probe.outgoing == [.reply(frame: 2)], "\(probe.sent) \(probe.outgoing)")
    probe.feed("\(esc)[>q")
    settle(2) { probe.sent.count >= 2 }
    assert(probe.sent.count == 2 && probe.sent[1].hasPrefix("\(esc)P>|") && probe.outgoing[1] == .reply(frame: 3), "XTVERSION: \(probe.sent)")
    // A program that asks and quits: the shell's prompt mark arrives before SwiftTerm's answer goes, so it's dropped.
    probe.feed("\(esc)[>c\(esc)[?1049l")
    probe.feed("\(esc)]633;D;0\(bel)\(esc)]633;A\(bel)$ ")
    settle(2) { probe.sent.count >= 3 }
    assert(probe.outgoing.count == 3 && probe.outgoing[2] == .drop, "\(probe.outgoing)")
    // The same in one chunk, the mark after the query.
    probe.feed("\(esc)[18t\(esc)]633;D;0\(bel)$ ")
    settle(2) { probe.sent.count >= 4 }
    assert(probe.outgoing.count == 4 && probe.outgoing[3] == .drop, "\(probe.outgoing)")
    // A query after the prompt (the shell's own) is answered.
    probe.feed("\(esc)]633;A\(bel)$ \(esc)[>c")
    settle(2) { probe.sent.count >= 5 }
    assert(probe.outgoing.count == 5 && probe.outgoing[4] == .reply(frame: 7), "\(probe.outgoing)")
    // Keys are keys, a query waiting or not.
    probe.feed("\(esc)[>c")
    assert(probe.answers.sent(bytes("\(esc)[A")[...]) == .key && probe.answers.sent(bytes("ls\r")[...]) == .key)
    settle(2) { probe.sent.count >= 6 }
    assert(probe.answers.json["removed"] as? Int == 10 && probe.answers.json["dropped"] as? Int == 2, "\(probe.answers.json)")
    // An answer long after its query isn't taken for one.
    var late = TerminalAnswers()
    _ = late.received(bytes("\(esc)[>c"))
    assert(late.sent(bytes("\(esc)[>0;276;0c")[...], now: Date().addingTimeInterval(5)) == .key)

}

print("Terminal query checks passed.")
