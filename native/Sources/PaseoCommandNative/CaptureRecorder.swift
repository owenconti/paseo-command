import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Records one display to an H.264 `.mp4` with ScreenCaptureKit (macOS 14), the frames going straight to an
/// `AVAssetWriter`: nothing is kept in memory. Its clock is the host's (`CACurrentMediaTime`), as ScreenCaptureKit
/// stamps its frames, so the capture's events are timed against `firstFrame`. With `voice` (macOS 15, the Microphone
/// permission given) the microphone is an AAC track of the same file, on the same clock; `muted` drops its sound
/// meanwhile, and `onLevel` gives its loudness (0…1) for the capsule's meter.
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
    private var audio: AVAssetWriterInput?
    /// The microphone is being recorded (asked for, and its stream started).
    private(set) var recordsVoice = false
    /// Whether the file has any sound (the microphone was recorded and not muted throughout).
    private(set) var voiced = false
    /// Read on the frames' queue; set from anywhere.
    var muted: Bool {
        get { queue.sync { _muted } }
        set { queue.async { self._muted = newValue } }
    }
    private var _muted = false
    /// The microphone's loudness, about 10 times a second, on the main queue.
    var onLevel: ((Float) -> Void)?
    private var lastLevel = 0.0
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
    /// With `voice`, the microphone too; if its stream won't start, the screen alone (the capture matters more).
    func start(display: SCDisplay, scale: CGFloat, excluding: [SCWindow], voice: Bool = false) async throws {
        guard voice else { return try await begin(display: display, scale: scale, excluding: excluding, voice: false) }
        do {
            try await begin(display: display, scale: scale, excluding: excluding, voice: true)
        } catch {
            Log.line("capture: couldn't record the microphone, recording the screen alone: \(error.localizedDescription)")
            if let stream { try? await stream.stopCapture() }
            stream = nil
            queue.sync {
                if writer?.status == .writing { writer?.cancelWriting() }
                writer = nil
                input = nil
                audio = nil
                firstFrame = nil
            }
            try? FileManager.default.removeItem(at: url)
            try await begin(display: display, scale: scale, excluding: excluding, voice: false)
        }
    }

    private func begin(display: SCDisplay, scale: CGFloat, excluding: [SCWindow], voice: Bool) async throws {
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
        var microphone = false
        if voice, #available(macOS 15, *) {
            let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: 48_000, AVEncoderBitRateKey: 96_000,
            ])
            audio.expectsMediaDataInRealTime = true
            if writer.canAdd(audio) {
                writer.add(audio)
                self.audio = audio
                config.captureMicrophone = true
                microphone = true
            }
        }
        let filter = SCContentFilter(display: display, excludingWindows: excluding)
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if microphone, #available(macOS 15, *) { try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue) }
        self.stream = stream
        try await stream.startCapture()
        recordsVoice = microphone
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if #available(macOS 15, *), type == .microphone { return heard(buffer) }
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

    /// A microphone buffer: written once the video has begun (its first frame is the file's start), unless muted.
    private func heard(_ buffer: CMSampleBuffer) {
        guard !stopped, buffer.isValid, let writer, let audio else { return }
        let level = _muted ? 0 : Self.level(buffer)
        let now = CACurrentMediaTime()
        if now - lastLevel > 0.1, let onLevel {
            lastLevel = now
            DispatchQueue.main.async { onLevel(level) }
        }
        guard !_muted, writer.status == .writing, let first = firstFrame, buffer.presentationTimeStamp.seconds >= first,
              audio.isReadyForMoreMediaData else { return }
        if audio.append(buffer) { voiced = true }
    }

    /// A buffer's loudness for a meter: its RMS (over every channel) in decibels, -50…0 dB as 0…1.
    static func level(_ buffer: CMSampleBuffer) -> Float {
        guard let format = CMSampleBufferGetFormatDescription(buffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return 0 }
        var needed = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: &needed, bufferListOut: nil, bufferListSize: 0,
                                                                blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        guard needed > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: needed, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
        var block: CMBlockBuffer?
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: needed,
                                                                      blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0,
                                                                      blockBufferOut: &block) == noErr else { return 0 }
        var sum: Double = 0, count = 0
        for b in UnsafeMutableAudioBufferListPointer(list) {
            guard let data = b.mData else { continue }
            let bytes = Int(b.mDataByteSize)
            if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0, asbd.mBitsPerChannel == 32 {
                let samples = data.assumingMemoryBound(to: Float.self)
                for i in 0..<(bytes / 4) { sum += Double(samples[i] * samples[i]) }
                count += bytes / 4
            } else if asbd.mBitsPerChannel == 16 {
                let samples = data.assumingMemoryBound(to: Int16.self)
                for i in 0..<(bytes / 2) { let v = Double(samples[i]) / 32768; sum += v * v }
                count += bytes / 2
            }
        }
        guard count > 0 else { return 0 }
        let db = 20 * log10(max(sqrt(sum / Double(count)), 1e-6))
        return Float(min(1, max(0, (db + 50) / 50)))
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
                self.audio?.markAsFinished()
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
