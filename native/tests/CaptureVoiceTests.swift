// A screen capture's voice: what you said in sentences, its keyframe moments, and hearing a real recording's speech.
import AVFoundation
import Speech

func w(_ text: String, _ t: Double, _ end: Double? = nil) -> CaptureWord { CaptureWord(text: text, t: t, end: end ?? t + 0.2) }

// Sentences end at their punctuation or a long pause; the words are trimmed, empty ones dropped.
let words = [w(" Make", 0), w(" this", 0.3), w(" button", 0.5), w(" blue.", 0.7, 1.0), w(" ", 1.1),
             w(" And", 1.5), w(" move", 1.7), w(" the", 1.9), w(" menu", 2.1, 2.4),
             w("Then", 4.0), w("save", 4.2), w("it", 4.4, 4.6)]
let sentences = CaptureTranscript.sentences(words)
assert(sentences == [CaptureSpeech(t: 0, end: 1.0, text: "Make this button blue."),
                     CaptureSpeech(t: 1.5, end: 2.4, text: "And move the menu"),
                     CaptureSpeech(t: 4.0, end: 4.6, text: "Then save it")], "\(sentences)")
// A moment each: a pointing word's (a moment after it), else the sentence's end.
let moments = CaptureTranscript.moments(words).map { ($0 * 100).rounded() / 100 }
assert(moments == [0.6, 2.4, 4.6], "\(moments)")
assert(CaptureTranscript.moments([w("Over", 1), w("HERE,", 1.2)]).map { ($0 * 100).rounded() / 100 } == [1.5])
assert(CaptureTranscript.sentences([]).isEmpty && CaptureTranscript.moments([w("  ", 1)]).isEmpty)
// Keyframes take what you said as a reason of its own.
let frames = CaptureKeyframes.choose([CaptureEvent(kind: .said, t: 2), CaptureEvent(kind: .stroke, t: 5)], duration: 8)
assert(frames.map(\.reasons) == [["start"], ["said"], ["marked"], ["end"]], "\(frames)")

// Hearing real speech, as a recording's sound is heard (macOS 26, with the language's model on this Mac).
if #available(macOS 26, *), let locale = await CaptureVoice.locale(),
   await SpeechTranscriber.installedLocales.contains(where: { $0.identifier == locale.identifier }) {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("paseo-voice-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let audio = dir.appendingPathComponent("voice.m4a")
    let say = Process()
    say.executableURL = URL(fileURLWithPath: "/usr/bin/say")
    say.arguments = ["-o", audio.path, "--file-format=m4af", "--data-format=aac", "Make this button blue. [[slnc 1800]] Then move that menu over here."]
    try! say.run()
    say.waitUntilExit()
    let heard = try! await CaptureVoice.words(in: audio)
    let text = CaptureTranscript.sentences(heard).map(\.text).joined(separator: " ").lowercased()
    assert(text.contains("button") && text.contains("blue") && text.contains("menu"), "heard: \(text)")
    assert(heard.allSatisfy { $0.t >= 0 && $0.end >= $0.t } && zip(heard, heard.dropFirst()).allSatisfy { $0.t <= $1.t }, "\(heard)")
    let points = CaptureTranscript.moments(heard)
    // Two sentences (the pause between them), each a moment at its pointing word ("this", "that").
    assert(points.count == 2 && points[0] < 1.2 && points[1] > 1.8, "\(points): \(heard.map { "\($0.text)@\($0.t)" })")
    print("Capture voice checks passed (heard: \(text)).")
} else {
    print("Capture voice checks passed (hearing skipped: needs macOS 26 and the language's speech model).")
}

// Tidying on this Mac: the reply cleaned up as a message; and the on-device model's tidy, when Apple Intelligence is on.
assert(CaptureVoice.cleanTidy("  “Make  this blue.”  ") == "Make this blue.")
assert(CaptureVoice.cleanTidy("\"A\n\n\n\nB\"") == "A\n\nB")
assert(CaptureVoice.cleanTidy(String(repeating: "x", count: 9000)) == nil)
// "Nothing" (nothing was for the agent) is an empty message; a "Message:" lead-in goes.
assert(CaptureVoice.cleanTidy("Nothing.") == "" && CaptureVoice.cleanTidy("nothing") == "")
assert(CaptureVoice.cleanTidy("Message: Make it blue.") == "Make it blue.")
if CaptureVoice.tidiesHere {
    let started = Date()
    let tidied = await CaptureVoice.tidy([CaptureSpeech(t: 0, end: 4, text: "So, uh, this button here, like, it should be, um, blue."),
                                          CaptureSpeech(t: 5, end: 7, text: "And move that menu over here, please.")])
    let text = (tidied ?? "").lowercased()
    assert(text.contains("blue") && text.contains("menu") && !text.contains(" uh") && !text.contains(" um"), "tidied: \(tidied ?? "nil")")
    print("Capture tidy checks passed (on this Mac in \(String(format: "%.1f", Date().timeIntervalSince(started))) s: \(tidied!)).")
} else {
    print("Capture tidy checks passed (the on-device model skipped: Apple Intelligence isn't available).")
}
