import AppKit
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What happened while recording, in seconds from the recording's first frame. Points are fractions of the
/// display from its top left.
struct CaptureEvent: Equatable {
    /// `said`: a moment of what you said (`CaptureTranscript.moments`).
    enum Kind: String { case stroke, click, said }
    var kind: Kind
    var t: Double
    var x: Double = 0
    var y: Double = 0
}

/// A frame chosen for the contact sheet: when, why, and the clicks to ring on it.
struct CaptureKeyframe: Equatable {
    var n: Int
    var t: Double
    var reasons: [String]
    var clicks: [CGPoint]
}

/// Which moments of a recording an agent sees (pure: `CaptureBundleTests`). Each stroke's end (a moment later, so
/// its ink is in the frame) and each click (as it lands, showing what was clicked), then the last frame; and the
/// first when nothing happens in the first second. Moments closer than `mergeWithin` are one keyframe (the later
/// one, keeping both reasons and every click); past `limit`, the first and last stay and the rest are thinned
/// evenly.
enum CaptureKeyframes {
    static let strokeDelay = 0.2
    static let mergeWithin = 0.75
    static let limit = 12

    static func choose(_ events: [CaptureEvent], duration: Double, limit: Int = limit) -> [CaptureKeyframe] {
        let end = max(0, duration - 0.1)
        var moments: [(t: Double, reason: String, click: CGPoint?)] = events.map { e in
            switch e.kind {
            case .stroke: return (min(end, e.t + strokeDelay), "marked", nil)
            case .click: return (min(end, max(0, e.t)), "clicked", CGPoint(x: e.x, y: e.y))
            case .said: return (min(end, max(0, e.t)), "said", nil)
            }
        }
        if !events.contains(where: { $0.t < 1 }), duration > 1.5 { moments.append((0.5, "start", nil)) }
        moments.append((end, "end", nil))
        moments.sort { $0.t < $1.t }
        var merged: [CaptureKeyframe] = []
        for m in moments {
            if let last = merged.last, m.t - last.t < mergeWithin {
                var k = last
                k.t = m.t
                if !k.reasons.contains(m.reason) { k.reasons.append(m.reason) }
                if let c = m.click { k.clicks.append(c) }
                merged[merged.count - 1] = k
            } else {
                merged.append(CaptureKeyframe(n: 0, t: m.t, reasons: [m.reason], clicks: m.click.map { [$0] } ?? []))
            }
        }
        // A first or last frame merged into a mark or click is that frame: "start" or "end" says nothing more.
        for i in merged.indices where merged[i].reasons.count > 1 {
            let kept = merged[i].reasons.filter { $0 != "end" && $0 != "start" }
            merged[i].reasons = kept.isEmpty ? ["end"] : kept
        }
        if merged.count > limit, limit >= 2 {
            let step = Double(merged.count - 1) / Double(limit - 1)
            merged = (0..<limit).map { merged[Int((Double($0) * step).rounded())] }
        }
        return merged.enumerated().map { i, k in var k = k; k.n = i + 1; return k }
    }
}

/// A word you said while recording, timed in seconds from the recording's start (`CaptureVoice` hears them).
struct CaptureWord: Equatable {
    var text: String
    var t: Double
    var end: Double
}

/// A sentence of what you said, as the agent reads it.
struct CaptureSpeech: Equatable {
    var t: Double
    var end: Double
    var text: String
}

/// What you said, made readable and turned into keyframe moments (pure: `CaptureBundleTests`).
enum CaptureTranscript {
    /// A pause this long ends a sentence the recognizer ran on.
    static let pause = 1.2
    /// Words that point at the screen ("this", "here"): their moment is a keyframe, as what they name is under the pointer.
    static let pointing: Set<String> = ["this", "that", "these", "those", "here", "there"]
    /// How long after a pointing word its frame is taken (the pointer lands as you say it).
    static let pointDelay = 0.3

    /// The words in sentences: a sentence ends at its full stop, question or exclamation mark, or at a long pause.
    static func sentences(_ words: [CaptureWord]) -> [CaptureSpeech] {
        groups(words).map { CaptureSpeech(t: $0[0].t, end: $0[$0.count - 1].end, text: $0.map(\.text).joined(separator: " ")) }
    }

    /// One moment a sentence: its first pointing word's (a moment later), else its end.
    static func moments(_ words: [CaptureWord]) -> [Double] {
        groups(words).map { sentence in
            sentence.first(where: { pointing.contains(bare($0.text)) }).map { $0.t + pointDelay } ?? sentence[sentence.count - 1].end
        }
    }

    /// The words, trimmed (empty ones gone), in sentences; none is empty.
    static func groups(_ words: [CaptureWord]) -> [[CaptureWord]] {
        var out: [[CaptureWord]] = []
        var current: [CaptureWord] = []
        for raw in words {
            let word = CaptureWord(text: raw.text.trimmingCharacters(in: .whitespacesAndNewlines), t: raw.t, end: max(raw.t, raw.end))
            guard !word.text.isEmpty else { continue }
            if let last = current.last, word.t - last.end >= pause { out.append(current); current = [] }
            current.append(word)
            if let c = word.text.last, ".?!…".contains(c) { out.append(current); current = [] }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    /// A word without its punctuation, in lower case.
    static func bare(_ word: String) -> String {
        word.lowercased().trimmingCharacters(in: .punctuationCharacters.union(.symbols))
    }
}

/// Drawing a bundle's images: keyframes with their click rings, the numbered contact sheet, the GIF.
enum CaptureImages {
    static let ink = NSColor(srgbRed: 0.96, green: 0.2, blue: 0.2, alpha: 1)

    /// A frame with a thin ring (and a dot) at each click, so the clicked thing stays readable.
    static func ringed(_ image: CGImage, clicks: [CGPoint]) -> CGImage {
        guard !clicks.isEmpty, let context = context(width: image.width, height: image.height) else { return image }
        let w = CGFloat(image.width), h = CGFloat(image.height)
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let r = max(10, min(w, h) * 0.018)
        for c in clicks {
            let p = CGPoint(x: c.x * w, y: (1 - c.y) * h)
            context.setStrokeColor(ink.withAlphaComponent(0.85).cgColor)
            context.setLineWidth(max(2, r * 0.16))
            context.strokeEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
            context.setFillColor(ink.withAlphaComponent(0.9).cgColor)
            let d = max(3, r * 0.22)
            context.fillEllipse(in: CGRect(x: p.x - d / 2, y: p.y - d / 2, width: d, height: d))
        }
        return context.makeImage() ?? image
    }

    /// The keyframes in time order, left to right and top to bottom, in rows of equal tiles 6 px apart on a dark
    /// canvas at most `longEdge` px long, each with its number in a white chip inset in its top-left corner.
    static func contactSheet(_ frames: [CGImage], longEdge: CGFloat = 1600) -> CGImage? {
        guard let first = frames.first else { return nil }
        let n = frames.count
        let columns = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4
        let rows = Int(ceil(Double(n) / Double(columns)))
        let aspect = CGFloat(first.height) / CGFloat(max(1, first.width))
        let gutter: CGFloat = 6
        // The tiles' width so the sheet's longer side is `longEdge`.
        let byWidth = (longEdge - gutter * CGFloat(columns + 1)) / CGFloat(columns)
        let byHeight = (longEdge - gutter * CGFloat(rows + 1)) / CGFloat(rows) / aspect
        let tileW = floor(min(byWidth, byHeight, CGFloat(first.width)))
        let tileH = floor(tileW * aspect)
        let width = Int(CGFloat(columns) * tileW + gutter * CGFloat(columns + 1))
        let height = Int(CGFloat(rows) * tileH + gutter * CGFloat(rows + 1))
        guard let context = context(width: width, height: height) else { return nil }
        context.setFillColor(NSColor(white: 0.07, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        for (i, frame) in frames.enumerated() {
            let col = i % columns, row = i / columns
            let x = gutter + CGFloat(col) * (tileW + gutter)
            // CoreGraphics counts up from the bottom.
            let y = CGFloat(height) - gutter - CGFloat(row + 1) * tileH - CGFloat(row) * gutter
            let tile = CGRect(x: x, y: y, width: tileW, height: tileH)
            context.draw(frame, in: tile)
            chip(i + 1, in: context, at: CGPoint(x: tile.minX + 5, y: tile.maxY - 5))
        }
        return context.makeImage()
    }

    /// The number in bold black on a small white rounded square with a thin dark ring, its top left at `corner`.
    static func chip(_ number: Int, in context: CGContext, at corner: CGPoint) {
        let text = NSAttributedString(string: "\(number)", attributes: [
            .font: NSFont.systemFont(ofSize: 15, weight: .bold), .foregroundColor: NSColor.black,
        ])
        let size = text.size()
        let side = max(24, ceil(size.width) + 10)
        let box = CGRect(x: corner.x, y: corner.y - 24, width: side, height: 24)
        let path = CGPath(roundedRect: box, cornerWidth: 5, cornerHeight: 5, transform: nil)
        context.addPath(path)
        context.setFillColor(NSColor.white.cgColor)
        context.fillPath()
        context.addPath(path)
        context.setStrokeColor(NSColor(white: 0.1, alpha: 0.8).cgColor)
        context.setLineWidth(1)
        context.strokePath()
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        text.draw(at: CGPoint(x: box.midX - size.width / 2, y: box.midY - size.height / 2))
        NSGraphicsContext.restoreGraphicsState()
    }

    static func context(width: Int, height: Int) -> CGContext? {
        CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    }

    @discardableResult
    static func writePNG(_ image: CGImage, to url: URL) -> Bool {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return false }
        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination)
    }

    /// An animated GIF that loops, `delay` seconds a frame.
    @discardableResult
    static func writeGIF(_ frames: [CGImage], delay: Double, to url: URL) -> Bool {
        guard !frames.isEmpty,
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, frames.count, nil) else { return false }
        CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        let props = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: delay, kCGImagePropertyGIFUnclampedDelayTime: delay]] as CFDictionary
        for frame in frames { CGImageDestinationAddImage(destination, frame, props) }
        return CGImageDestinationFinalize(destination)
    }
}

/// Turns a finished recording into its bundle: the keyframes decoded from `recording.mp4` at their moments, the
/// contact sheet, `capture.json`; then the GIF, which the send panel needn't wait for.
struct CaptureBundle {
    let folder: URL
    let id: String
    let created: Date
    let duration: Double
    let app: String?
    let size: CGSize
    let events: [CaptureEvent]
    /// The microphone was recorded (and something reached the file).
    var voice = false
    /// What you said, in sentences.
    var speech: [CaptureSpeech] = []
    /// Why there's no transcript though there was a voice ("Nothing was said", a failure).
    var transcriptNote: String?
    /// What you said as the message you meant, by the on-device model ("" when nothing was for the agent); nil when it
    /// didn't tidy it (the panel asks the host's metadata model).
    var tidied: String?

    var video: URL { folder.appendingPathComponent("recording.mp4") }
    var sheet: URL { folder.appendingPathComponent("contact-sheet.png") }
    var gif: URL { folder.appendingPathComponent("capture.gif") }

    /// A new capture's id and folder name: `cap-20261120-181341`, `-2` and on if that's taken.
    static func newID(at date: Date, in parent: URL) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyyMMdd-HHmmss"
        let base = "cap-" + format.string(from: date)
        var id = base, n = 2
        while FileManager.default.fileExists(atPath: parent.appendingPathComponent(id).path) { id = "\(base)-\(n)"; n += 1 }
        return id
    }

    /// The keyframes, the sheet and the manifest. Throws when the video can't be read.
    func build() async throws -> [CaptureKeyframe] {
        let keyframes = CaptureKeyframes.choose(events, duration: duration)
        let asset = AVURLAsset(url: video)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
        let frames = folder.appendingPathComponent("frames")
        try FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
        var images: [CGImage] = []
        for k in keyframes {
            let image = try await generator.image(at: CMTime(seconds: k.t, preferredTimescale: 600)).image
            let ringed = CaptureImages.ringed(image, clicks: k.clicks)
            CaptureImages.writePNG(ringed, to: frames.appendingPathComponent(String(format: "frame-%02d.png", k.n)))
            images.append(ringed)
        }
        guard let sheetImage = CaptureImages.contactSheet(images), CaptureImages.writePNG(sheetImage, to: sheet) else {
            throw CaptureError("Couldn't draw the contact sheet")
        }
        try manifest(keyframes).write(to: folder.appendingPathComponent("capture.json"))
        return keyframes
    }

    func manifest(_ keyframes: [CaptureKeyframe]) throws -> Data {
        let iso = ISO8601DateFormatter()
        var body: [String: Any] = [
            "id": id, "created": iso.string(from: created), "duration": (duration * 100).rounded() / 100,
            "width": Int(size.width), "height": Int(size.height),
            "frames": keyframes.map { ["n": $0.n, "t": ($0.t * 100).rounded() / 100, "file": String(format: "frames/frame-%02d.png", $0.n), "reasons": $0.reasons] },
            "strokes": events.filter { $0.kind == .stroke }.count, "clicks": events.filter { $0.kind == .click }.count,
            "video": "recording.mp4", "sheet": "contact-sheet.png", "gif": "capture.gif",
            "voice": voice,
            "transcript": speech.map { ["t": ($0.t * 100).rounded() / 100, "end": ($0.end * 100).rounded() / 100, "text": $0.text] },
        ]
        if let app { body["app"] = app }
        if let transcriptNote { body["transcriptNote"] = transcriptNote }
        if let tidied { body["tidied"] = tidied }
        return try JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys])
    }

    /// The GIF: `fps` frames a second at most `width` px wide, at most `maxFrames` (fewer a second past that).
    func writeGIF(fps: Double = 5, width: CGFloat = 800, maxFrames: Int = 300) async -> Bool {
        let rate = min(fps, Double(maxFrames) / max(duration, 0.1))
        let count = max(1, Int(duration * rate))
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: video))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: width, height: width * 4)
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
        var images: [CGImage] = []
        for i in 0..<count {
            if let image = try? await generator.image(at: CMTime(seconds: Double(i) / rate, preferredTimescale: 600)).image { images.append(image) }
        }
        // Written beside, then moved into place, so the server never names a half-written file.
        let partial = folder.appendingPathComponent(".capture.gif.partial")
        guard CaptureImages.writeGIF(images, delay: 1 / rate, to: partial) else { return false }
        try? FileManager.default.removeItem(at: gif)
        return (try? FileManager.default.moveItem(at: partial, to: gif)) != nil
    }
}

struct CaptureError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
