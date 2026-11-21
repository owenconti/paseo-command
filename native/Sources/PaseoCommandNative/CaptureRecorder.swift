import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Records one display to an H.264 `.mp4` with ScreenCaptureKit (macOS 14), the frames going straight to an
/// `AVAssetWriter`: nothing is kept in memory. Its clock is the host's (`CACurrentMediaTime`), as ScreenCaptureKit
/// stamps its frames, so the capture's events are timed against `firstFrame`.
final class CaptureRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let url: URL
    /// The recording's size in pixels: the display's, its long edge at most `maxEdge`.
    private(set) var size: CGSize = .zero
    /// The host time (seconds) of the first frame written; events are timed from it.
    private(set) var firstFrame: Double?
    /// The stream stopped by itself (the display went away, permission was taken back).
    var onFailure: ((String) -> Void)?

    static let maxEdge: CGFloat = 2560
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private let queue = DispatchQueue(label: "paseo.capture.frames")
    private var stopped = false

    init(url: URL) { self.url = url }

    static func pixelSize(points: CGSize, scale: CGFloat) -> CGSize {
        var w = points.width * scale, h = points.height * scale
        let long = max(w, h)
        if long > maxEdge { w *= maxEdge / long; h *= maxEdge / long }
        // H.264 wants even sides.
        return CGSize(width: floor(w / 2) * 2, height: floor(h / 2) * 2)
    }

    /// Starts recording `display`, leaving out `excluding` (the capture's own controls).
    func start(display: SCDisplay, scale: CGFloat, excluding: [SCWindow]) async throws {
        size = Self.pixelSize(points: CGSize(width: display.width, height: display.height), scale: scale)
        let config = SCStreamConfiguration()
        config.width = Int(size.width)
        config.height = Int(size.height)
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = true
        config.queueDepth = 6
        config.capturesAudio = false
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: Int(size.width * size.height * 2.5),
                AVVideoExpectedSourceFrameRateKey: 30,
                AVVideoMaxKeyFrameIntervalKey: 60,
            ] as [String: Any],
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw CaptureError("Couldn't make the video") }
        writer.add(input)
        self.writer = writer
        self.input = input
        let filter = SCContentFilter(display: display, excludingWindows: excluding)
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        self.stream = stream
        try await stream.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !stopped, buffer.isValid, let writer, let input,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete
        else { return }
        let time = buffer.presentationTimeStamp
        if writer.status == .unknown {
            guard writer.startWriting() else { return }
            writer.startSession(atSourceTime: time)
            firstFrame = time.seconds
        }
        if writer.status == .writing, input.isReadyForMoreMediaData { input.append(buffer) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.line("capture: the stream stopped: \(error.localizedDescription)")
        DispatchQueue.main.async { self.onFailure?(error.localizedDescription) }
    }

    /// Stops and finishes the file; the duration in seconds, or nil when nothing was recorded.
    func stop() async -> Double? {
        if let stream { try? await stream.stopCapture() }
        stream = nil
        return await withCheckedContinuation { (done: CheckedContinuation<Double?, Never>) in
            queue.async {
                self.stopped = true
                guard let writer = self.writer, let input = self.input, writer.status == .writing, let first = self.firstFrame else {
                    if self.writer?.status == .writing { self.writer?.cancelWriting() }
                    return done.resume(returning: nil)
                }
                // The file lasts until now, though the screen may not have changed since its last frame.
                let now = CMClockGetTime(CMClockGetHostTimeClock())
                input.markAsFinished()
                writer.endSession(atSourceTime: now)
                writer.finishWriting {
                    done.resume(returning: writer.status == .completed ? now.seconds - first : nil)
                }
            }
        }
    }

    /// Stops without keeping anything.
    func cancel() async {
        if let stream { try? await stream.stopCapture() }
        stream = nil
        queue.sync {
            stopped = true
            if writer?.status == .writing { writer?.cancelWriting() }
        }
        try? FileManager.default.removeItem(at: url)
    }
}
