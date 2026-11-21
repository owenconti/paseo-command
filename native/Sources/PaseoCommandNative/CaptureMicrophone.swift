import AVFoundation
import CoreMedia
import Foundation

/// A screen capture's microphone, recorded with an `AVCaptureSession` rather than ScreenCaptureKit's own
/// (`captureMicrophone`), which went silent a second in when the input was Bluetooth (AirPods switch to their headset
/// profile as recording starts, and the device it had opened changed under it). The session asks for one format
/// whatever the device gives (48 kHz mono float), so a device that changes its rate mid-recording still writes, and
/// its buffers come on the host clock, as the screen's frames do. The device is the one chosen in the menu bar's
/// Microphone menu (`CaptureVoice.chosenMicrophone`), else the system's default input.
final class CaptureMicrophone: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    /// The device's name, for the capsule and for why a recording has no sound.
    let name: String
    private let session = AVCaptureSession()
    private let output = AVCaptureAudioDataOutput()
    private let queue: DispatchQueue
    private let onBuffer: (CMSampleBuffer) -> Void

    /// The microphones on this Mac, by their unique ids and names (the menu bar's Microphone menu).
    static func devices() -> [(id: String, name: String)] {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
            .devices.map { ($0.uniqueID, $0.localizedName) }
    }

    /// The device to record: the chosen one while it's connected, else the system's default input.
    static func device(chosen: String?) -> AVCaptureDevice? {
        if let chosen, let device = AVCaptureDevice(uniqueID: chosen) { return device }
        return AVCaptureDevice.default(for: .audio)
    }

    /// Opens the microphone; its buffers go to `onBuffer` on `queue`. Throws when it can't be opened.
    init(chosen: String?, queue: DispatchQueue, onBuffer: @escaping (CMSampleBuffer) -> Void) throws {
        guard let device = Self.device(chosen: chosen) else { throw CaptureError("No microphone is connected") }
        name = device.localizedName
        self.queue = queue
        self.onBuffer = onBuffer
        super.init()
        let input = try AVCaptureDeviceInput(device: device)
        session.beginConfiguration()
        guard session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            throw CaptureError("\(device.localizedName) can't be recorded")
        }
        session.addInput(input)
        output.audioSettings = [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        output.setSampleBufferDelegate(self, queue: queue)
        session.addOutput(output)
        session.commitConfiguration()
    }

    /// Starts it (it blocks while the device opens, so off the main thread).
    func start() async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                self.session.startRunning()
                done.resume()
            }
        }
    }

    func stop() {
        output.setSampleBufferDelegate(nil, queue: nil)
        if session.isRunning { session.stopRunning() }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput buffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        onBuffer(Self.onHostClock(buffer, from: session.synchronizationClock))
    }

    /// The buffer timed on the host clock (the screen's frames' clock), copied with new timing when the session's
    /// clock is another.
    static func onHostClock(_ buffer: CMSampleBuffer, from clock: CMClock?) -> CMSampleBuffer {
        let host = CMClockGetHostTimeClock()
        guard let clock, !CFEqual(clock, host) else { return buffer }
        var count: CMItemCount = 0
        CMSampleBufferGetSampleTimingInfoArray(buffer, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
        guard count > 0 else { return buffer }
        var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
        CMSampleBufferGetSampleTimingInfoArray(buffer, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count)
        for i in timing.indices {
            timing[i].presentationTimeStamp = CMSyncConvertTime(timing[i].presentationTimeStamp, from: clock, to: host)
            if timing[i].decodeTimeStamp.isValid { timing[i].decodeTimeStamp = CMSyncConvertTime(timing[i].decodeTimeStamp, from: clock, to: host) }
        }
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: buffer, sampleTimingEntryCount: count, sampleTimingArray: &timing,
                                              sampleBufferOut: &copy)
        return copy ?? buffer
    }
}
