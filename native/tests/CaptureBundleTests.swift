// Screen captures: which moments become keyframes, and a bundle made from a real (generated) recording.
import AVFoundation

func keyframes(_ events: [CaptureEvent], _ duration: Double, limit: Int = CaptureKeyframes.limit) -> [(Double, [String])] {
    CaptureKeyframes.choose(events, duration: duration, limit: limit).map { (($0.t * 100).rounded() / 100, $0.reasons) }
}
func same(_ a: [(Double, [String])], _ b: [(Double, [String])], _ line: Int = #line) {
    assert(a.count == b.count && zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }, "line \(line): \(a)")
}

// Nothing happened: the first moment and the last.
same(keyframes([], 10), [(0.5, ["start"]), (9.9, ["end"])])
// A short one: only the last.
same(keyframes([], 1), [(0.9, ["end"])])
// A stroke a moment after it ends (its ink drawn), a click as it lands; no "start" once something happens early.
same(keyframes([CaptureEvent(kind: .click, t: 0.4, x: 0.5, y: 0.5), CaptureEvent(kind: .stroke, t: 3)], 8),
     [(0.4, ["clicked"]), (3.2, ["marked"]), (7.9, ["end"])])
// Close moments are one keyframe (the later), with both reasons and every click; the end merges into a late mark.
let merged = CaptureKeyframes.choose([CaptureEvent(kind: .click, t: 2, x: 0.1, y: 0.2), CaptureEvent(kind: .stroke, t: 2.3),
                                      CaptureEvent(kind: .click, t: 2.6, x: 0.3, y: 0.4), CaptureEvent(kind: .stroke, t: 5.75)], duration: 6)
assert(merged.count == 3, "\(merged)")
assert(merged[0].reasons == ["start"])
assert(merged[1].reasons == ["clicked", "marked"] && merged[1].clicks.count == 2 && merged[1].t == 2.6, "\(merged[1])")
assert(merged[2].reasons == ["marked"] && abs(merged[2].t - 5.9) < 0.001, "\(merged[2])")
assert(merged.map(\.n) == [1, 2, 3])
// Past the limit: thinned evenly, the first and last kept.
let many = CaptureKeyframes.choose((0..<40).map { CaptureEvent(kind: .stroke, t: Double($0) * 2) }, duration: 82)
assert(many.count == CaptureKeyframes.limit && many.first!.t == 0.2 && many.last!.reasons == ["end"], "\(many.map(\.t))")
assert(zip(many, many.dropFirst()).allSatisfy { $0.t < $1.t })

// A recording: 3 s of frames whose colour changes each second, written as the recorder writes them.
let folder = FileManager.default.temporaryDirectory.appendingPathComponent("paseo-capture-test-\(UUID().uuidString)")
try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: folder) }
let video = folder.appendingPathComponent("recording.mp4")
let size = CaptureRecorder.pixelSize(points: CGSize(width: 1512, height: 982), scale: 2)
assert(size == CGSize(width: 2560, height: 1662), "\(size)")
let writer = try! AVAssetWriter(outputURL: video, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 640, AVVideoHeightKey: 400])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
for i in 0..<90 {
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(nil, 640, 400, kCVPixelFormatType_32BGRA, nil, &buffer)
    CVPixelBufferLockBaseAddress(buffer!, [])
    let base = CVPixelBufferGetBaseAddress(buffer!)!.assumingMemoryBound(to: UInt8.self)
    let shade: [UInt8] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]][i / 30]
    for p in 0..<(CVPixelBufferGetBytesPerRow(buffer!) * 400 / 4) { base[p * 4] = shade[0]; base[p * 4 + 1] = shade[1]; base[p * 4 + 2] = shade[2]; base[p * 4 + 3] = 255 }
    CVPixelBufferUnlockBaseAddress(buffer!, [])
    while !input.isReadyForMoreMediaData { usleep(1000) }
    adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: 30))
}
input.markAsFinished()
writer.endSession(atSourceTime: CMTime(value: 90, timescale: 30))
let wrote = DispatchSemaphore(value: 0)
writer.finishWriting { wrote.signal() }
wrote.wait()
assert(writer.status == .completed)

let bundle = CaptureBundle(folder: folder, id: "cap-20261120-181341", created: Date(timeIntervalSince1970: 1_795_198_421),
                           duration: 3, app: "Safari", size: CGSize(width: 640, height: 400),
                           events: [CaptureEvent(kind: .click, t: 1.5, x: 0.25, y: 0.75), CaptureEvent(kind: .stroke, t: 0.2)])
let chosen = try! await bundle.build()
assert(chosen.map(\.reasons) == [["marked"], ["clicked"], ["end"]], "\(chosen)")
for n in 1...3 { assert(FileManager.default.fileExists(atPath: folder.appendingPathComponent(String(format: "frames/frame-%02d.png", n)).path)) }
let sheet = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(bundle.sheet as CFURL, nil)!, 0, nil)!
// Three tiles of 640×400 in two columns, 6 px apart.
assert(sheet.width == 2 * 640 + 18 && sheet.height == 2 * 400 + 18, "\(sheet.width)×\(sheet.height)")
let manifest = try! JSONSerialization.jsonObject(with: Data(contentsOf: folder.appendingPathComponent("capture.json"))) as! [String: Any]
assert(manifest["id"] as? String == "cap-20261120-181341" && manifest["app"] as? String == "Safari" && manifest["clicks"] as? Int == 1)
assert((manifest["frames"] as? [[String: Any]])?.map { $0["file"] as! String } == ["frames/frame-01.png", "frames/frame-02.png", "frames/frame-03.png"])
// Each frame shows its moment: the second (1.5 s) is green, with the click's ring drawn in red.
func pixel(_ url: URL, _ x: Int, _ y: Int) -> [UInt8] {
    let image = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(url as CFURL, nil)!, 0, nil)!
    let context = CaptureImages.context(width: image.width, height: image.height)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let data = context.data!.assumingMemoryBound(to: UInt8.self)
    // A bitmap context keeps its rows top first.
    let i = y * context.bytesPerRow + x * 4
    return [data[i], data[i + 1], data[i + 2]]
}
let green = pixel(folder.appendingPathComponent("frames/frame-02.png"), 600, 20)
assert(green[1] > 200 && green[0] < 110 && green[2] < 60, "\(green)")
let ring = pixel(folder.appendingPathComponent("frames/frame-02.png"), 160, 300)
assert(ring[0] > 200 && ring[1] < 120, "the click's dot: \(ring)")
let gifWritten = await bundle.writeGIF(fps: 5, width: 320)
assert(gifWritten)
let gif = CGImageSourceCreateWithURL(bundle.gif as CFURL, nil)!
assert(CGImageSourceGetCount(gif) == 15, "\(CGImageSourceGetCount(gif)) GIF frames")
assert(CaptureBundle.newID(at: Date(), in: folder).hasPrefix("cap-"))
print("Capture bundle checks passed.")
